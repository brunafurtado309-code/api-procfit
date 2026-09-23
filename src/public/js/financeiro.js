// Painel financeiro: contas a receber.
// A chave fica guardada na aba (sessionStorage), igual ao painel de vendas.

const el = (id) => document.getElementById(id);

// Valor de um campo que pode não existir na página (evita quebrar a tela
// quando o HTML está numa versão diferente da do JavaScript).
const valorCampo = (id) => document.getElementById(id)?.value || null;

const dinheiro = (valor) =>
  valor === null || valor === undefined
    ? '—'
    : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const numero = (valor) => (valor === null || valor === undefined ? '—' : Number(valor).toLocaleString('pt-BR'));

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

// ===== Chave de acesso =====
// Mesma chave guardada pelo painel de vendas: quem tem acesso aos dois
// troca de módulo sem informar a chave de novo.
const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

class ChaveInvalida extends Error {}
class SemAcesso extends Error {}

async function buscar(rota, parametros = {}) {
  const url = new URL(`/financeiro/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }

  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });

  if (resposta.status === 401) throw new ChaveInvalida();
  if (resposta.status === 403) throw new SemAcesso('Esta chave não tem acesso ao financeiro.');
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  }
  return resposta.json();
}

// ===== Estado da tela =====
const ABAS = {
  titulos:  { situacao: 'aberto',  modalidade: null, titulo: 'Títulos em aberto' },
  parciais: { situacao: 'parcial', modalidade: null, titulo: 'Títulos com baixa parcial' },
  boletos:  { situacao: 'aberto',  modalidade: 1,    titulo: 'Boletos em aberto, por vencimento' },
  cobranca: { situacao: 'aberto',  modalidade: null, titulo: 'Títulos vencidos', somenteVencidos: true },
};

let abaAtual = 'titulos';
// Cartão clicado (filtra a lista). null = o que a aba já traz.
let cartaoAtual = null;
// O que está digitado nos filtros de coluna (vai para a API)
const filtrosColuna = {};
// Faixa de atraso escolhida no gráfico
let faixaAtual = null;
let pagina = 1;
let totalPaginas = 1;
// Ordem da lista ao clicar no nome da coluna. null = ordem padrão (vencimento)
let ordem = null; // ex.: { coluna: 'devedor', direcao: 'asc' }
const LIMITE = 50;

// Cada cartão é um recorte dos títulos
const CARTOES = {
  aberto:   { situacao: 'aberto',  atraso: null },
  vencido:  { situacao: 'aberto',  atraso: 'vencidos' },
  a_vencer: { situacao: 'aberto',  atraso: 'a_vencer' },
  parcial:  { situacao: 'parcial', atraso: null },
  quitado:  { situacao: 'quitado', atraso: null },
  clientes:    { situacao: 'aberto', atraso: null, porCliente: true },
  de_clientes: { situacao: 'aberto', atraso: null },
  adquirentes: { situacao: 'aberto', atraso: null },
};

function filtrosAtuais() {
  const aba = ABAS[abaAtual];
  const cartao = cartaoAtual ? CARTOES[cartaoAtual] : null;
  return {
    situacao: cartao ? cartao.situacao : aba.situacao,
    atraso: cartao ? cartao.atraso : (aba.somenteVencidos ? 'vencidos' : null),
    inicio: valorCampo('inicio'),
    // Na aba de cobrança, mostra só o que já venceu: "até ontem"
    fim: aba.somenteVencidos ? ontem() : valorCampo('fim'),
    modalidade: aba.modalidade ?? valorCampo('modalidade'),
    origem: valorCampo('origem'),
    devedor: cartaoAtual === 'adquirentes' ? 'adquirente'
           : cartaoAtual === 'de_clientes' ? 'cliente'
           : valorCampo('devedor'),
    busca: (valorCampo('pesquisa-termo') ?? '').trim() || null,
    ...filtrosColuna,
    ...faixaEmFiltro(),
    ...(ordem ? { ordem: ordem.coluna, direcao: ordem.direcao } : {}),
    limite: LIMITE,
    pagina,
  };
}

// Atalhos de período: preenchem os campos De/Até sem abrir o calendário
function aplicarAtalho(periodo) {
  const hoje = new Date();
  const iso = (data) => data.toISOString().slice(0, 10);
  const somar = (dias) => {
    const nova = new Date(hoje);
    nova.setDate(nova.getDate() + dias);
    return iso(nova);
  };

  const periodos = {
    tudo:     { inicio: '', fim: '' },
    vencidos: { inicio: '', fim: ontem() },
    mes:      { inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
                fim: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)) },
    '7dias':  { inicio: iso(hoje), fim: somar(7) },
    '30dias': { inicio: iso(hoje), fim: somar(30) },
  };

  const escolhido = periodos[periodo];
  if (!escolhido) return;
  el('inicio').value = escolhido.inicio;
  el('fim').value = escolhido.fim;
  pagina = 1;
  carregar();
}

// Converte a faixa clicada no gráfico em filtro de dias de atraso
function faixaEmFiltro() {
  const faixa = faixaAtual ? DIAS_DA_FAIXA[faixaAtual] : null;
  if (!faixa) return {};
  if (faixa.atraso) return { atraso: faixa.atraso };
  return { atraso_min: faixa.min, atraso_max: faixa.max ?? null };
}

function ontem() {
  const data = new Date();
  data.setDate(data.getDate() - 1);
  return data.toISOString().slice(0, 10);
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// ===== Desenho da tela =====
function mostrarIndicadores(ind) {
  const inadimplencia = ind.pendente ? (100 * ind.vencido) / ind.pendente : 0;
  const itens = [
    ['Inadimplência', `${inadimplencia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
      'do que está em aberto já venceu'],
    ['Atraso médio', ind.atraso_medio ? `${numero(Math.round(ind.atraso_medio))} dias` : '—',
      'ponderado pelo valor'],
    ['Ticket médio', dinheiro(ind.ticket_medio), 'por título'],
    ['Mais antigo', dataBR(ind.vencimento_mais_antigo), 'vencimento em aberto'],
  ];

  el('indicadores').replaceChildren(
    ...itens.flatMap(([rotulo, valor, nota]) => {
      const dt = document.createElement('dt');
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      dd.textContent = valor;
      const span = document.createElement('span');
      span.textContent = nota;
      dd.append(span);
      return [dt, dd];
    }),
  );
}

// Barras horizontais proporcionais (sem biblioteca: só HTML e CSS)
function desenharBarras(area, itens, { aoClicar = null, cor = 'verde' } = {}) {
  const maior = Math.max(...itens.map((i) => Number(i.valor) || 0), 1);

  area.replaceChildren(
    ...itens.map((item) => {
      const linha = document.createElement(aoClicar ? 'button' : 'div');
      linha.className = `barra barra--${cor}${item.ativo ? ' barra--ativa' : ''}`;
      if (aoClicar) {
        linha.type = 'button';
        linha.addEventListener('click', () => aoClicar(item));
      }

      const rotulo = document.createElement('span');
      rotulo.className = 'barra-rotulo';
      rotulo.textContent = item.rotulo;

      const trilho = document.createElement('span');
      trilho.className = 'barra-trilho';
      const preenchida = document.createElement('span');
      preenchida.className = 'barra-preenchida';
      preenchida.style.width = `${Math.max(2, (100 * (Number(item.valor) || 0)) / maior)}%`;
      trilho.append(preenchida);

      const valor = document.createElement('span');
      valor.className = 'barra-valor';
      valor.textContent = dinheiro(item.valor);
      if (item.nota) {
        const nota = document.createElement('small');
        nota.textContent = item.nota;
        valor.append(nota);
      }

      linha.append(rotulo, trilho, valor);
      return linha;
    }),
  );
}

function mostrarResumo(resumo) {
  el('total-pendente').textContent = dinheiro(resumo.pendente);
  el('resumo-linha').textContent =
    `${numero(resumo.titulos)} títulos de ${numero(resumo.clientes)} clientes · ` +
    `valor original ${dinheiro(resumo.valor_original)} · já recebido ${dinheiro(resumo.recebido)}`;
}

// Cada cartão filtra a lista quando clicado. Clicar de novo tira o filtro.
function mostrarCartoes(totais) {
  const cartoes = [
    { id: 'aberto',   titulo: 'Em aberto',       valor: dinheiro(totais.aberto),   nota: `${numero(totais.aberto_titulos)} títulos` },
    { id: 'vencido',  titulo: 'Vencido',         valor: dinheiro(totais.vencido),  nota: `${numero(totais.vencido_titulos)} títulos vencidos` },
    { id: 'a_vencer', titulo: 'A vencer',        valor: dinheiro(totais.a_vencer), nota: `${numero(totais.a_vencer_titulos)} títulos no prazo` },
    { id: 'parcial',  titulo: 'Baixa parcial',   valor: dinheiro(totais.parcial),  nota: `${numero(totais.parcial_titulos)} títulos` },
    { id: 'quitado',  titulo: 'Títulos baixados', valor: dinheiro(totais.quitado), nota: `${numero(totais.quitado_titulos)} títulos quitados` },
    { id: 'de_clientes',  titulo: 'Devido por clientes',
      valor: dinheiro(totais.de_clientes),     nota: `${numero(totais.de_clientes_titulos)} títulos` },
    { id: 'adquirentes',  titulo: 'Devido por adquirentes',
      valor: dinheiro(totais.de_adquirentes),  nota: `${numero(totais.de_adquirentes_titulos)} títulos de cartão` },
    { id: 'clientes', titulo: 'Clientes',        valor: numero(totais.clientes),   nota: 'com valor em aberto' },
  ];

  el('cartoes').replaceChildren(
    ...cartoes.map((c) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = c.id === cartaoAtual ? 'cartao cartao--ativo' : 'cartao';
      botao.dataset.cartao = c.id;
      const titulo = document.createElement('h3');
      titulo.textContent = c.titulo;
      const valor = document.createElement('p');
      valor.className = 'cartao-valor';
      valor.textContent = c.valor;
      const nota = document.createElement('p');
      nota.className = 'cartao-nota';
      nota.textContent = c.nota;
      botao.append(titulo, valor, nota);
      botao.addEventListener('click', () => {
        cartaoAtual = cartaoAtual === c.id ? null : c.id;
        pagina = 1;
        carregar();
      });
      return botao;
    }),
  );
}

// Cada faixa vira uma barra clicável que filtra a lista pelo atraso
const DIAS_DA_FAIXA = {
  '1. A vencer': { atraso: 'a_vencer' },
  '2. 1 a 30 dias': { min: 1, max: 30 },
  '3. 31 a 60 dias': { min: 31, max: 60 },
  '4. 61 a 90 dias': { min: 61, max: 90 },
  '5. Mais de 90 dias': { min: 91 },
};

function mostrarFaixas(faixas) {
  desenharBarras(
    el('grafico-faixas'),
    faixas.map((f) => ({
      rotulo: f.faixa.replace(/^\d+\.\s*/, ''),
      valor: f.pendente,
      nota: `${numero(f.titulos)} títulos · ${numero(f.clientes)} clientes`,
      ativo: faixaAtual === f.faixa,
      faixa: f.faixa,
    })),
    {
      cor: 'atraso',
      aoClicar: (item) => {
        faixaAtual = faixaAtual === item.faixa ? null : item.faixa;
        pagina = 1;
        carregar();
      },
    },
  );
}

function mostrarRanking(clientes) {
  desenharBarras(
    el('ranking'),
    clientes.slice(0, 6).map((c) => ({
      rotulo: c.cliente ?? `Cliente ${c.cod_cliente}`,
      valor: c.pendente,
      nota: `${numero(c.titulos)} títulos · vencido ${dinheiro(c.vencido)}`,
      cod: c.cod_cliente,
      nome: c.cliente,
    })),
    { aoClicar: (item) => abrirFicha(item.cod, item.nome) },
  );
}

function mostrarPrevisao(semanas) {
  if (semanas.length === 0) {
    el('previsao').replaceChildren(Object.assign(document.createElement('p'), {
      className: 'explica', textContent: 'Nenhum título a vencer no filtro atual.',
    }));
    return;
  }
  graficos.colunas(el('previsao'), {
    titulo: 'Recebimentos previstos por semana',
    rotulos: semanas.map((s) => dataBR(s.semana).slice(0, 5)),
    series: [{ nome: 'Vence na semana', valores: semanas.map((s) => s.pendente) }],
  });
}

// Do que já venceu em cada mês, quanto foi baixado. Mês ruim = recebimento sem baixa no PROCFIT.
const MESES_NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
async function carregarBaixasReceber(filtrosDaTela) {
  try {
    const lista = (await buscar('baixas-mes', filtrosDaTela))
      .map((m) => {
        const venceu = Number(m.ja_venceu) || 0;
        const semBaixa = Number(m.vencido_sem_baixa) || 0;
        return { ...m, venceu, semBaixa, pct: venceu > 0 ? 1 - semBaixa / venceu : null };
      })
      .filter((m) => m.venceu > 0);
    const nome = (mes) => `${MESES_NOMES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
    graficos.colunas(el('grafico-baixas-receber'), {
      titulo: 'Vencido × baixado por mês',
      rotulos: lista.map((m) => nome(m.mes)),
      series: [
        { nome: 'Já venceu', valores: lista.map((m) => m.venceu), cor: 'var(--verde-claro)' },
        { nome: 'Baixado como recebido', valores: lista.map((m) => m.venceu - m.semBaixa), cor: 'var(--verde)' },
      ],
      vazio: 'Nenhum vencimento nos últimos meses.',
    });
    const resumo = el('baixas-receber-resumo');
    resumo.replaceChildren();
    lista.forEach((m, k) => {
      const parte = document.createElement('span');
      parte.textContent = `${nome(m.mes)} ${Math.round((m.pct ?? 0) * 100)}% baixado`;
      if (m.pct !== null && m.pct < 0.8) parte.className = 'negativo';
      if (k) resumo.append(' · ');
      resumo.append(parte);
    });
    const ruins = lista.filter((m) => m.pct !== null && m.pct < 0.8);
    const aviso = el('aviso-baixas-receber');
    aviso.hidden = ruins.length === 0;
    if (ruins.length) {
      const total = ruins.reduce((t, m) => t + m.semBaixa, 0);
      aviso.textContent = `Atenção: ${ruins.map((m) => nome(m.mes)).join(', ')} com menos de 80% baixado `
        + `(${dinheiro(total)} vencidos sem baixa). Se esses valores já entraram no banco, a inadimplência acima `
        + 'está maior do que a realidade: é preciso lançar as baixas no PROCFIT.';
    }
  } catch (erro) {
    el('grafico-baixas-receber').textContent = 'Não foi possível carregar este gráfico agora.';
  }
}

// Nome do cliente clicável: abre a ficha com tudo dele
function celulaCliente(titulo) {
  const td = document.createElement('td');
  td.className = 'esquerda';
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'link-cliente';
  botao.textContent = `${titulo.cod_cliente} · ${titulo.cliente ?? 'sem nome'}`;
  botao.addEventListener('click', () => abrirFicha(titulo.cod_cliente, titulo.cliente));
  td.append(botao);

  if (titulo.tipo_devedor) {
    const marca = document.createElement('span');
    marca.className = titulo.tipo_devedor === 'ADQUIRENTE' ? 'marca marca--adquirente' : 'marca';
    marca.textContent = titulo.tipo_devedor === 'ADQUIRENTE'
      ? `adquirente${titulo.adquirente ? ` · ${titulo.adquirente}` : ''} — não é o cliente da venda`
      : 'cliente';
    td.append(marca);
  }
  return td;
}

// Nº do pedido clicável: abre a janela com os produtos do pedido (js/pedido.js)
function celulaPedido(numero) {
  const td = document.createElement('td');
  td.append(pedidoJanela.link(numero));
  return td;
}

function celula(texto, classe = null) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (classe) td.className = classe;
  return td;
}

// Colunas da lista. A visão de baixa parcial mostra os valores da NOTA
// (soma das parcelas), além dos valores da parcela em si.
const COLUNAS_TITULO = [
  { titulo: 'Vencimento', ordem: 'vencimento', valor: (t) => dataBR(t.vencimento),
    nota: (t) => (t.dias_atraso > 0 ? `${numero(t.dias_atraso)} dias de atraso` : 'em dia'),
    classeNota: (t) => (t.dias_atraso > 0 ? 'atraso' : null) },
  { titulo: 'Nota / pedido', ordem: 'nota', valor: (t) => (t.nota ? `NF ${t.nota}` : 'sem nota'),
    nota: (t) => (t.pedido ? pedidoJanela.link(t.pedido, 'pedido') : t.origem),
    filtros: [{ campo: 'f_nota', dica: 'nota' }, { campo: 'f_pedido', dica: 'pedido' }] },
  { titulo: 'Título', ordem: 'titulo', valor: (t) => t.titulo ?? '—',
    filtros: [{ campo: 'f_titulo', dica: 'título' }] },
  { titulo: 'Devedor', ordem: 'devedor', cliente: true,
    filtros: [{ campo: 'f_cliente', dica: 'nome ou código' }] },
  { titulo: 'Forma', ordem: 'forma', valor: (t) => t.modalidade ?? '—', nota: (t) => t.origem,
    filtroSelect: 'modalidade' },
  { titulo: 'Valor', ordem: 'valor', valor: (t) => dinheiro(t.valor) },
  { titulo: 'Recebido', ordem: 'recebido', valor: (t) => dinheiro(t.recebido) },
  { titulo: 'Pendente', ordem: 'pendente', valor: (t) => dinheiro(t.pendente),
    filtros: [{ campo: 'f_valor_min', dica: 'de R$' }, { campo: 'f_valor_max', dica: 'até R$' }] },
];

const COLUNAS_NOTA = [
  { titulo: 'Vencimento', ordem: 'vencimento', valor: (t) => dataBR(t.vencimento),
    nota: (t) => (t.dias_atraso > 0 ? `${numero(t.dias_atraso)} dias de atraso` : 'em dia'),
    classeNota: (t) => (t.dias_atraso > 0 ? 'atraso' : null) },
  { titulo: 'Nota / pedido', ordem: 'nota', valor: (t) => (t.nota ? `NF ${t.nota}` : 'sem nota'),
    nota: (t) => (t.pedido ? pedidoJanela.link(t.pedido, 'pedido') : t.origem),
    filtros: [{ campo: 'f_nota', dica: 'nota' }, { campo: 'f_pedido', dica: 'pedido' }] },
  { titulo: 'Devedor', ordem: 'devedor', cliente: true,
    filtros: [{ campo: 'f_cliente', dica: 'nome ou código' }] },
  { titulo: 'Valor da nota', ordem: 'nota_valor', valor: (t) => dinheiro(t.nota_valor),
    nota: (t) => (t.nota_parcelas > 1 ? `${numero(t.nota_parcelas)} parcelas` : '1 parcela') },
  { titulo: 'Pago da nota', ordem: 'nota_recebido', valor: (t) => dinheiro(t.nota_recebido),
    nota: (t) => (t.ultimo_recebimento ? `última baixa ${dataBR(t.ultimo_recebimento)}` : null) },
  { titulo: 'A pagar da nota', ordem: 'nota_pendente', valor: (t) => dinheiro(t.nota_pendente) },
  { titulo: 'Parcela', ordem: 'titulo', valor: (t) => t.titulo ?? '—', nota: (t) => t.modalidade ?? null },
  { titulo: 'Pago na parcela', ordem: 'recebido', valor: (t) => dinheiro(t.recebido) },
  { titulo: 'Falta na parcela', ordem: 'pendente', valor: (t) => dinheiro(t.pendente) },
];

// A visão da nota entra quando o assunto é baixa parcial
const colunasAtuais = () =>
  (abaAtual === 'parciais' || cartaoAtual === 'parcial') ? COLUNAS_NOTA : COLUNAS_TITULO;

// Nome da coluna clicável: 1º clique = crescente (A→Z, menor→maior), 2º = decrescente
function cabecalhoOrdenavel(coluna) {
  const th = document.createElement('th');
  th.scope = 'col';
  if (coluna.cliente) th.className = 'esquerda';
  if (!coluna.ordem) {
    th.textContent = coluna.titulo;
    return th;
  }

  const ativa = ordem?.coluna === coluna.ordem;
  const crescente = !ativa || ordem.direcao === 'asc';
  if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
  botao.title = ativa && crescente ? 'Clique para inverter a ordem' : 'Clique para ordenar';
  const seta = document.createElement('span');
  seta.className = 'ordenar__seta';
  seta.setAttribute('aria-hidden', 'true');
  seta.textContent = ativa ? (crescente ? '▲' : '▼') : '↕';
  botao.append(coluna.titulo, seta);

  botao.addEventListener('click', () => {
    ordem = { coluna: coluna.ordem, direcao: ativa && crescente ? 'desc' : 'asc' };
    pagina = 1;
    carregar();
  });
  th.append(botao);
  return th;
}

function mostrarTitulos({ total, lista }) {
  const colunas = colunasAtuais();
  const tabela = el('tabela-titulos');

  const cabecalho = document.createElement('tr');
  for (const coluna of colunas) {
    cabecalho.append(cabecalhoOrdenavel(coluna));
  }
  tabela.querySelector('thead').replaceChildren(cabecalho);

  const corpo = el('tabela-titulos').querySelector('tbody');

  if (lista.length === 0) {
    const linha = document.createElement('tr');
    const td = celula('Nenhum título encontrado com esses filtros.');
    td.colSpan = colunas.length;
    linha.append(td);
    corpo.replaceChildren(linha);
  } else {
    corpo.replaceChildren(
      ...lista.map((t) => {
        const linha = document.createElement('tr');
        for (const coluna of colunas) {
          if (coluna.cliente) {
            linha.append(celulaCliente(t));
            continue;
          }
          const td = celula(coluna.valor(t), coluna.classe ? coluna.classe(t) : null);
          const auxiliar = coluna.nota ? coluna.nota(t) : null;
          if (auxiliar) {
            const extra = document.createElement('span');
            extra.className = coluna.classeNota?.(t) ? `origem ${coluna.classeNota(t)}` : 'origem';
            // Texto simples ou um elemento (ex.: o nº do pedido clicável)
            if (auxiliar instanceof Node) extra.append(auxiliar);
            else extra.textContent = auxiliar;
            td.append(extra);
          }
          linha.append(td);
        }
        return linha;
      }),
    );
  }

  // Rodapé com os totais do filtro inteiro (não só da página)
  const rodape = el('tabela-titulos').querySelector('tfoot');
  const linha = document.createElement('tr');
  const rotulo = celula(`Total do filtro (${numero(total.total)} títulos)`);
  rotulo.colSpan = colunas.length - 3; // os três últimos são sempre valores
  linha.append(rotulo, celula(dinheiro(total.valor_original)), celula(dinheiro(total.recebido)), celula(dinheiro(total.pendente)));
  rodape.replaceChildren(linha);

  totalPaginas = Math.max(1, Math.ceil(Number(total.total) / LIMITE));
  el('pagina-atual').textContent = `Página ${pagina} de ${numero(totalPaginas)}`;
  el('anterior').disabled = pagina <= 1;
  el('proxima').disabled = pagina >= totalPaginas;
}

function mostrarClientes(lista) {
  const corpo = el('tabela-clientes').querySelector('tbody');
  corpo.replaceChildren(
    ...lista.map((c) => {
      const linha = document.createElement('tr');
      linha.append(
        celulaCliente({ cod_cliente: c.cod_cliente, cliente: c.cliente }),
        celula(numero(c.titulos)),
        celula(dataBR(c.vencimento_mais_antigo)),
        celula(c.maior_atraso ? `${numero(c.maior_atraso)} dias` : 'em dia', c.maior_atraso ? 'atraso' : null),
        celula(dinheiro(c.vencido)),
        celula(dinheiro(c.pendente)),
      );
      return linha;
    }),
  );
}

// Mostra a lista de títulos ou a de clientes, conforme o cartão escolhido
function trocarVisao(porCliente) {
  el('bloco-titulos').hidden = porCliente;
  el('bloco-clientes').hidden = !porCliente;
}

// Mostra em marcadores tudo que está filtrando a lista, com "x" para remover
const ROTULOS_FILTRO = {
  f_nota: 'Nota', f_pedido: 'Pedido', f_titulo: 'Título', f_cliente: 'Devedor',
  f_valor_min: 'Pendente de R$', f_valor_max: 'Pendente até R$',
};

function mostrarMarcadores() {
  const area = el('marcadores');
  const itens = [];

  for (const [campo, valor] of Object.entries(filtrosColuna)) {
    itens.push({ texto: `${ROTULOS_FILTRO[campo] ?? campo}: ${valor}`, remover: () => {
      delete filtrosColuna[campo];
      const campoTela = el(campo);
      if (campoTela) campoTela.value = '';
    } });
  }

  // Seletores do painel "Mais filtros" (forma, quem deve, origem)
  const SELETORES = { modalidade: 'Forma', devedor: 'Quem deve', origem: 'Origem' };
  let extrasAtivos = Object.keys(filtrosColuna).length;
  for (const [id, rotulo] of Object.entries(SELETORES)) {
    const campo = el(id);
    if (!campo || campo.disabled || campo.value === '') continue;
    extrasAtivos += 1;
    const opcao = campo.options[campo.selectedIndex]?.textContent ?? campo.value;
    itens.push({ texto: `${rotulo}: ${opcao}`, remover: () => { campo.value = ''; } });
  }
  el('abrir-filtros').textContent = extrasAtivos ? `Mais filtros (${extrasAtivos})` : 'Mais filtros';

  if (faixaAtual) {
    itens.push({ texto: `Atraso: ${faixaAtual.replace(/^\d+\.\s*/, '')}`, remover: () => { faixaAtual = null; } });
  }

  if (cartaoAtual) {
    const nomes = {
      aberto: 'Em aberto', vencido: 'Vencidos', a_vencer: 'A vencer', parcial: 'Baixa parcial',
      quitado: 'Títulos baixados', clientes: 'Por cliente', de_clientes: 'Devido por clientes',
      adquirentes: 'Devido por adquirentes',
    };
    itens.push({ texto: nomes[cartaoAtual] ?? cartaoAtual, remover: () => { cartaoAtual = null; } });
  }

  area.hidden = itens.length === 0;
  area.replaceChildren(
    ...itens.map((item) => {
      const marcador = document.createElement('button');
      marcador.type = 'button';
      marcador.className = 'marcador';
      marcador.textContent = item.texto;
      const x = document.createElement('span');
      x.textContent = '×';
      x.setAttribute('aria-hidden', 'true');
      marcador.append(x);
      marcador.title = 'Remover este filtro';
      marcador.addEventListener('click', () => {
        item.remover();
        pagina = 1;
        carregar();
      });
      return marcador;
    }),
  );
}

// ===== Carregamento =====
let carregando = false;

// Guarda os filtros desta tela para quando você voltar de um cliente ou pedido
function guardarEstado() {
  estado.salvar('financeiro', {
    aba: abaAtual,
    cartao: cartaoAtual,
    inicio: valorCampo('inicio'),
    fim: valorCampo('fim'),
    busca: valorCampo('busca') ?? el('busca')?.value,
    modalidade: valorCampo('modalidade'),
    origem: valorCampo('origem'),
    devedor: valorCampo('devedor'),
    pagina,
  });
}

async function carregar() {
  guardarEstado();
  if (carregando) return;
  carregando = true;
  mostrarStatus('Carregando…');

  try {
    const filtros = filtrosAtuais();
    const porCliente = CARTOES[cartaoAtual]?.porCliente === true;

    // Cartões e faixas usam o período, a modalidade e a pesquisa da tela,
    // mas NÃO o recorte do cartão clicado: senão cada cartão filtraria a si mesmo.
    const { inicio, fim, modalidade, busca, origem } = filtros;
    const filtrosDaTela = { inicio, fim, modalidade, busca, origem, devedor: valorCampo('devedor') };

    const [resumo, totais, indicadores, faixas, previsaoSemanas, ranking, dados] = await Promise.all([
      buscar('resumo', filtros),
      buscar('cartoes', filtrosDaTela),
      buscar('indicadores', filtrosDaTela),
      buscar('faixas-atraso', filtrosDaTela),
      buscar('previsao', filtrosDaTela),
      buscar('clientes', { ...filtrosDaTela, situacao: 'aberto' }),
      buscar(porCliente ? 'clientes' : 'titulos', filtros),
    ]);

    mostrarMarcadores();
    mostrarResumo(resumo);
    mostrarCartoes(totais);
    mostrarIndicadores(indicadores);
    mostrarFaixas(faixas);
    mostrarPrevisao(previsaoSemanas);
    carregarBaixasReceber(filtrosDaTela);
    mostrarRanking(ranking);
    trocarVisao(porCliente);
    if (porCliente) mostrarClientes(dados);
    else mostrarTitulos(dados);
    const nomeCartao = {
      aberto: 'todos em aberto', vencido: 'somente vencidos', a_vencer: 'somente a vencer',
      parcial: 'somente baixa parcial', quitado: 'somente títulos baixados', clientes: 'agrupado por cliente',
      de_clientes: 'somente o que os clientes devem', adquirentes: 'somente o que as adquirentes devem',
    }[cartaoAtual];
    mostrarStatus(`${ABAS[abaAtual].titulo}${nomeCartao ? ` · ${nomeCartao}` : ''} · atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    if (erro instanceof ChaveInvalida) {
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    if (erro instanceof SemAcesso) {
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Esta chave não abre o financeiro. Peça a chave do setor financeiro.');
      return;
    }
    console.error(erro);
    mostrarStatus(erro.message, true);
  } finally {
    carregando = false;
  }
}

// ===== Ficha do cliente =====
const SITUACAO_TEXTO = { ABERTO: 'Em aberto', PARCIAL: 'Baixa parcial', QUITADO: 'Quitado' };

// ===== Ficha do cliente: filtros e ordenação das três listas =====
let fichaAtual = null;
const ordemFicha = {
  titulos: { coluna: 'vencimento', direcao: 'desc' },
  pedidos: { coluna: 'dia', direcao: 'desc' },
  recebimentos: { coluna: 'dia', direcao: 'desc' },
};
// Data e valor que cada lista usa nos filtros
const DATA_DA_LISTA = { titulos: 'vencimento', pedidos: 'dia', recebimentos: 'dia' };
const VALOR_DA_LISTA = { titulos: 'valor', pedidos: 'valor', recebimentos: 'recebido' };

const filtrosDaFicha = () => ({
  inicio: el('ficha-inicio').value || null,
  fim: el('ficha-fim').value || null,
  valor: el('ficha-valor').value ? Number(el('ficha-valor').value) : null,
});

function aplicarFiltrosDaFicha(lista, tipo) {
  const { inicio, fim, valor } = filtrosDaFicha();
  return lista
    .filter((item) => {
      const data = String(item[DATA_DA_LISTA[tipo]] ?? '').slice(0, 10);
      if (inicio && data && data < inicio) return false;
      if (fim && data && data > fim) return false;
      if (valor != null && (Number(item[VALOR_DA_LISTA[tipo]]) || 0) < valor) return false;
      return true;
    })
    .sort((a, b) => {
      const { coluna, direcao } = ordemFicha[tipo];
      const fator = direcao === 'asc' ? 1 : -1;
      const x = a[coluna];
      const y = b[coluna];
      if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
      return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
    });
}

// Seta na coluna ativa e clique para ordenar
function prepararCabecalho(idTabela, tipo) {
  for (const th of el(idTabela).querySelectorAll('thead th[data-ordem]')) {
    const chaveColuna = th.dataset.ordem;
    const ativa = ordemFicha[tipo].coluna === chaveColuna;
    const crescente = ordemFicha[tipo].direcao === 'asc';
    th.setAttribute('aria-sort', ativa ? (crescente ? 'ascending' : 'descending') : 'none');
    if (!th.dataset.ligado) {
      th.dataset.ligado = '1';
      th.dataset.texto = th.textContent;
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const eraAtiva = ordemFicha[tipo].coluna === chaveColuna;
        ordemFicha[tipo] = {
          coluna: chaveColuna,
          direcao: eraAtiva && ordemFicha[tipo].direcao === 'asc' ? 'desc' : (eraAtiva ? 'asc' : 'desc'),
        };
        desenharListasDaFicha();
      });
    }
    th.textContent = `${th.dataset.texto}${ativa ? (crescente ? ' ▲' : ' ▼') : ''}`;
  }
}

function linhaVaziaFicha(colunas, texto) {
  const linha = document.createElement('tr');
  const vazio = celula(texto, 'vazio');
  vazio.colSpan = colunas;
  linha.append(vazio);
  return linha;
}

function desenharListasDaFicha() {
  if (!fichaAtual) return;
  const { codigo, ficha } = fichaAtual;
  const titulos = aplicarFiltrosDaFicha(ficha.titulos ?? [], 'titulos');
  const pedidos = aplicarFiltrosDaFicha(ficha.pedidos ?? [], 'pedidos');
  const recebimentos = aplicarFiltrosDaFicha(ficha.recebimentos ?? [], 'recebimentos');

  const { inicio, fim, valor } = filtrosDaFicha();
  el('ficha-filtro-aviso').textContent = (inicio || fim || valor != null)
    ? `${numero(titulos.length)} títulos · ${numero(pedidos.length)} pedidos · `
      + `${numero(recebimentos.length)} recebimentos com esses filtros`
    : '';

  prepararCabecalho('ficha-titulos', 'titulos');
  prepararCabecalho('ficha-pedidos', 'pedidos');
  prepararCabecalho('ficha-recebimentos', 'recebimentos');

  // Títulos do cliente
  el('ficha-titulos').querySelector('tbody').replaceChildren(
    ...(titulos.length ? titulos.map((t) => {
      const linha = document.createElement('tr');
      // Sem nota: a origem do título aparece embaixo da situação (lançado, importado, cartão...)
      const situacao = celula(SITUACAO_TEXTO[t.situacao] ?? t.situacao);
      if (!t.nota && t.origem) {
        const origem = document.createElement('span');
        origem.className = 'qtd';
        origem.textContent = t.origem;
        situacao.append(origem);
      }
      linha.append(
        celula(dataBR(t.vencimento)),
        situacao,
        celula(t.nota ?? '—'),
        celulaPedido(t.pedido),
        celula(t.titulo ?? '—'),
        celula(dinheiro(t.valor)),
        celula(dinheiro(t.recebido)),
        celula(dinheiro(t.pendente)),
      );
      return linha;
    }) : [linhaVaziaFicha(8, 'Nenhum título com esses filtros.')]),
  );

  // Pedidos do cliente, inclusive os que ainda não viraram nota
  el('ficha-pedidos').querySelector('tbody').replaceChildren(
    ...(pedidos.length ? pedidos.map((p) => {
      const linha = document.createElement('tr');
      linha.append(
        celula(dataBR(p.dia)),
        celulaPedido(p.pedido),
        celula(p.vendedor ?? '—', 'esquerda'),
        celula(p.situacao, 'esquerda'),
        celula(p.nota ? `NF ${p.nota}` : '—'),
        celula(Number(p.desconto) > 0.009 ? dinheiro(p.desconto) : '—'),
        celula(dinheiro(p.valor)),
      );
      return linha;
    }) : [linhaVaziaFicha(7, 'Nenhum pedido com esses filtros.')]),
  );

  // Recebimentos do cliente: tudo o que ele pagou e por qual caminho
  el('ficha-recebimentos').querySelector('tbody').replaceChildren(
    ...(recebimentos.length ? recebimentos.map((r) => {
      const linha = document.createElement('tr');
      const parcial = Number(r.recebido) + 0.009 < Number(r.valor_titulo);
      const notaPedido = celula(r.nota ? `NF ${r.nota}` : 'sem nota', 'esquerda');
      if (r.pedido) notaPedido.append(' · ', pedidoJanela.link(r.pedido));
      const recebido = celula(dinheiro(r.recebido));
      if (parcial) {
        const nota = document.createElement('span');
        nota.className = 'qtd negativo';
        nota.textContent = `parcial de ${dinheiro(r.valor_titulo)}`;
        recebido.append(nota);
      }
      linha.append(
        celula(dataBR(r.dia)),
        celula(r.origem ?? '—', 'esquerda'),
        celula(r.usuario_nome ?? 'Não identificado', 'esquerda'),
        celula(r.titulo ?? '—'),
        notaPedido,
        celula(r.forma ?? '—', 'esquerda'),
        recebido,
      );
      return linha;
    }) : [linhaVaziaFicha(7, 'Nenhum recebimento com esses filtros.')]),
  );

  // Excel dos recebimentos deste cliente, respeitando o período da ficha
  el('ficha-excel-recebimentos').onclick = () => {
    const hoje = new Date();
    const umAnoAtras = new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate());
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const url = new URL('/financeiro/recebimentos/excel', window.location.origin);
    url.searchParams.set('busca', String(codigo));
    url.searchParams.set('inicio', inicio ?? iso(umAnoAtras));
    url.searchParams.set('fim', fim ?? iso(hoje));
    baixarArquivo(url, `recebimentos-cliente-${codigo}.xlsx`, el('ficha-excel-recebimentos'));
  };
}

// Baixa um arquivo da API (a chave vai no cabeçalho, por isso não dá para usar link comum)
async function baixarArquivo(url, nomePadrao, botao) {
  if (botao) botao.disabled = true;
  try {
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const cabecalho = resposta.headers.get('Content-Disposition') || '';
    const nomeArquivo = (cabecalho.match(/filename="([^"]+)"/) || [])[1] || nomePadrao;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nomeArquivo;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    el('ficha-status').textContent = erro.message;
  } finally {
    if (botao) botao.disabled = false;
  }
}

async function abrirFicha(codigo, nome) {
  el('ficha-nome').textContent = nome ?? `Cliente ${codigo}`;
  el('ficha-sub').textContent = `Código ${codigo}`;
  el('ficha-corpo').hidden = true;
  el('ficha-status').textContent = 'Carregando a ficha…';
  el('ficha').showModal();

  try {
    const ficha = await buscar(`clientes/${codigo}`);
    const { financeiro, compras } = ficha;

    el('ficha-cartoes').replaceChildren(
      ...[
        { titulo: 'Pendente', valor: dinheiro(financeiro.pendente), nota: `${numero(financeiro.titulos_abertos)} títulos em aberto` },
        { titulo: 'Vencido', valor: dinheiro(financeiro.vencido), nota: financeiro.maior_atraso ? `maior atraso: ${numero(financeiro.maior_atraso)} dias` : 'nada vencido' },
        { titulo: 'Já comprou', valor: dinheiro(compras.total_comprado), nota: `${numero(compras.documentos)} documentos nos últimos 12 meses` },
        { titulo: 'Último recebimento', valor: dataBR(financeiro.ultimo_recebimento), nota: `última compra em ${dataBR(compras.ultima_compra)}` },
      ].map((c) => {
        const caixa = document.createElement('article');
        caixa.className = 'cartao';
        const titulo = document.createElement('h3');
        titulo.textContent = c.titulo;
        const valor = document.createElement('p');
        valor.className = 'cartao-valor';
        valor.textContent = c.valor;
        const nota = document.createElement('p');
        nota.className = 'cartao-nota';
        nota.textContent = c.nota;
        caixa.append(titulo, valor, nota);
        return caixa;
      }),
    );

    el('ficha-produtos').querySelector('tbody').replaceChildren(
      ...ficha.produtos.map((p) => {
        const linha = document.createElement('tr');
        linha.append(
          celula(p.produto),
          celula(p.descricao ?? '—', 'esquerda'),
          celula(numero(p.quantidade)),
          celula(dinheiro(p.valor)),
        );
        return linha;
      }),
    );

    // Guarda os dados e desenha as três listas com os filtros e a ordem escolhidos
    fichaAtual = { codigo, ficha };
    desenharListasDaFicha();

    el('ficha-status').textContent = '';
    el('ficha-corpo').hidden = false;
  } catch (erro) {
    console.error(erro);
    el('ficha-status').textContent = erro.message ?? 'Não foi possível carregar a ficha.';
  }
}

// ===== Entrada e saída =====
function mostrarEntrada() {
  el('form-chave').hidden = false;
  el('painel').hidden = true;
  el('trocar-chave').hidden = true;
  document.getElementById('modulos').hidden = true;
  el('campo-chave').value = '';
  el('campo-chave').focus();
}

async function mostrarPainel() {
  // Antes de desenhar, pergunta à API o que esta chave abre
  let setores;
  try {
    setores = await modulos.setoresDaChave();
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      mostrarEntrada();
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    setores = ['financeiro']; // API fora do ar: segue e deixa a própria carga avisar
  }

  // Chave de outro setor: vai direto para o módulo dela, sem erro na cara do usuário
  if (!setores.includes('financeiro')) {
    modulos.irPara(setores[0]);
    return;
  }

  el('form-chave').hidden = true;
  el('painel').hidden = false;
  el('trocar-chave').hidden = false;
  modulos.desenharMenu(setores, 'financeiro');
  carregar();
}

document.addEventListener('DOMContentLoaded', () => {
  pedidoJanela.configurar({ setor: 'financeiro' });

  // Aba pedida no endereço (ex.: financeiro.html#boletos, vindo da página de Despachos)
  // Endereço com #cliente-123 (vindo da aba Recebimentos): abre a ficha desse cliente
  const clienteNoEndereco = window.location.hash.match(/^#cliente-(\d+)$/);
  if (clienteNoEndereco) {
    setTimeout(() => abrirFicha(Number(clienteNoEndereco[1])), 300);
  }
  // Volta a tela como estava antes de você entrar num cliente ou pedido
  const guardado = estado.aplicarCampos('financeiro', {
    inicio: 'inicio', fim: 'fim', busca: 'busca', modalidade: 'modalidade', origem: 'origem', devedor: 'devedor',
  });
  if (ABAS[guardado.aba]) {
    abaAtual = guardado.aba;
    for (const aba of el('abas').querySelectorAll('.aba[data-aba]')) {
      aba.classList.toggle('aba--ativa', aba.dataset.aba === abaAtual);
    }
    el('modalidade').disabled = ABAS[abaAtual].modalidade !== null;
  }
  if (guardado.cartao) cartaoAtual = guardado.cartao;

  const abaInicial = window.location.hash.slice(1);
  if (ABAS[abaInicial]) {
    abaAtual = abaInicial;
    for (const aba of el('abas').querySelectorAll('.aba[data-aba]')) {
      aba.classList.toggle('aba--ativa', aba.dataset.aba === abaInicial);
    }
    el('modalidade').disabled = ABAS[abaAtual].modalidade !== null;
  }

  el('form-chave').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const valor = el('campo-chave').value.trim();
    if (!valor) return;
    chave.guardar(valor);
    mostrarPainel();
  });

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    mostrarEntrada();
  });

  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    pagina = 1;
    carregar();
  });

  el('form-pesquisa').addEventListener('submit', (evento) => {
    evento.preventDefault();
    pagina = 1;
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    carregar();
  });

  el('limpar-pesquisa').addEventListener('click', () => {
    for (const chave of Object.keys(filtrosColuna)) delete filtrosColuna[chave];
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    pagina = 1;
    carregar();
  });

  el('atalhos')?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-periodo]');
    if (!botao) return;
    for (const item of el('atalhos').querySelectorAll('[data-periodo]')) {
      item.classList.toggle('atalho--ativo', item === botao);
    }
    aplicarAtalho(botao.dataset.periodo);
  });
  for (const id of ['inicio', 'fim']) {
    el(id).addEventListener('input', () => {
      for (const item of el('atalhos').querySelectorAll('[data-periodo]')) item.classList.remove('atalho--ativo');
    });
  }

  el('abas').addEventListener('click', (evento) => {
    const botao = evento.target.closest('.aba[data-aba]'); // "Despachos" é link para outra página
    if (!botao) return;
    abaAtual = botao.dataset.aba;
    cartaoAtual = null;
    ordem = null; // cada aba começa na ordem padrão
    pagina = 1;
    for (const aba of el('abas').querySelectorAll('.aba')) {
      aba.classList.toggle('aba--ativa', aba === botao);
    }
    // A modalidade fixa da aba (ex.: boletos) desabilita o seletor
    el('modalidade').disabled = ABAS[abaAtual].modalidade !== null;
    carregar();
  });

  el('abrir-filtros')?.addEventListener('click', () => {
    const painel = el('filtros-lista');
    painel.hidden = !painel.hidden;
    el('abrir-filtros').setAttribute('aria-expanded', String(!painel.hidden));
  });

  el('filtros-lista')?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    for (const campo of Object.keys(ROTULOS_FILTRO)) {
      const valor = (valorCampo(campo) ?? '').trim();
      if (valor === '') delete filtrosColuna[campo];
      else filtrosColuna[campo] = valor;
    }
    pagina = 1;
    carregar();
  });

  el('limpar-filtros')?.addEventListener('click', () => {
    for (const campo of Object.keys(ROTULOS_FILTRO)) {
      delete filtrosColuna[campo];
      const campoTela = el(campo);
      if (campoTela) campoTela.value = '';
    }
    for (const id of ['modalidade', 'devedor', 'origem']) {
      if (!el(id).disabled) el(id).value = '';
    }
    faixaAtual = null;
    pagina = 1;
    carregar();
  });

  // Botão ao lado do título da lista: faz o mesmo que o "Baixar Excel" do topo
  el('baixar-excel-lista')?.addEventListener('click', () => el('baixar-excel')?.click());

  // Filtros da ficha do cliente (valem para títulos, pedidos e recebimentos)
  for (const id of ['ficha-inicio', 'ficha-fim', 'ficha-valor']) {
    el(id)?.addEventListener('change', desenharListasDaFicha);
  }
  el('ficha-limpar')?.addEventListener('click', () => {
    el('ficha-inicio').value = '';
    el('ficha-fim').value = '';
    el('ficha-valor').value = '';
    desenharListasDaFicha();
  });

  el('baixar-excel')?.addEventListener('click', async () => {
    const botao = el('baixar-excel');
    botao.disabled = true;
    botao.textContent = 'Gerando…';
    try {
      const url = new URL('/financeiro/excel', window.location.origin);
      // Os MESMOS filtros da lista na tela (menos a página): o Excel sai igual ao que você vê
      for (const [nome, valor] of Object.entries(filtrosAtuais())) {
        if (valor !== null && valor !== undefined && valor !== '' && nome !== 'pagina' && nome !== 'limite') {
          url.searchParams.set(nome, valor);
        }
      }
      // Cartão "Clientes" ativo: a tela mostra um resumo por cliente, então o Excel também
      if (CARTOES[cartaoAtual]?.porCliente) url.searchParams.set('visao', 'clientes');

      // Busca com a chave no cabeçalho e salva o arquivo: a chave não aparece na URL
      const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
      }

      // Usa o nome que a API sugeriu (ex.: contas-a-receber_atacadao_2026-09-21.xlsx)
      const cabecalho = resposta.headers.get('Content-Disposition') || '';
      const nomeArquivo = (cabecalho.match(/filename="([^"]+)"/) || [])[1]
        || `contas-a-receber-${new Date().toISOString().slice(0, 10)}.xlsx`;

      const arquivo = await resposta.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(arquivo);
      link.download = nomeArquivo;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (erro) {
      mostrarStatus(erro.message, true);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Baixar Excel';
    }
  });

  // Fechar a ficha: se você veio de outra tela (Recebimentos, Clientes), volta para ela
  const fecharFicha = () => {
    const veioDeFora = window.location.hash.startsWith('#cliente-');
    el('ficha').close();
    if (veioDeFora && window.history.length > 1) window.history.back();
  };
  el('ficha-fechar').addEventListener('click', fecharFicha);
  el('ficha').addEventListener('cancel', (evento) => {
    // Esc também volta para a tela anterior
    if (window.location.hash.startsWith('#cliente-') && window.history.length > 1) {
      evento.preventDefault();
      fecharFicha();
    }
  });

  el('anterior').addEventListener('click', () => {
    if (pagina <= 1) return;
    pagina -= 1;
    carregar();
  });

  el('proxima').addEventListener('click', () => {
    if (pagina >= totalPaginas) return;
    pagina += 1;
    carregar();
  });

  if (chave.ler()) mostrarPainel();
  else mostrarEntrada();
});
