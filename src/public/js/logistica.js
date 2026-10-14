// Logística: o que entrou, o que saiu, o saldo e o preço de cada produto,
// com o histórico de preço e as compras nota a nota na ficha do produto.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => (valor === null || valor === undefined ? '—' : moeda.format(Number(valor) || 0));
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (valor) => (valor ? `${dataBR(valor)} ${String(valor).slice(11, 16)}` : '—');
const mesBR = (mes) => {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [ano, numero] = String(mes).split('-');
  return `${nomes[Number(numero) - 1]}/${ano}`;
};
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

const ALERTAS = {
  NEGATIVO: { titulo: 'Estoque negativo', campo: 'negativos', nota: 'vendem mais do que entrou' },
  SOBRA: { titulo: 'Entrou o dobro ou mais do que saiu', campo: 'sobras', nota: 'compra acima da venda no período' },
  PRECO_ALTERADO: { titulo: 'Preço alterado', campo: 'precos_alterados', nota: 'mudança de preço no período', informativo: true },
  PRECO_FORA: { titulo: 'Preço alterado fora do sistema', campo: 'precos_fora', nota: 'alterado direto no banco' },
};

// ===== Estado =====
let lista = [];
let resumo = {};
let alertaAtual = null;
let ordem = { coluna: 'valor_vendido', direcao: 'desc' };

const TEMPO_LIMITE_MS = 60000;

async function buscar(rota, parametros = {}) {
  const url = new URL(`/logistica/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta;
  try {
    resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' }, signal: controle.signal });
  } catch (erro) {
    if (erro.name === 'AbortError') {
      throw new Error(`A API não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos. Tente um período menor.`);
    }
    throw new Error('Não foi possível falar com a API. Confira se ela está rodando.');
  } finally {
    clearTimeout(limite);
  }
  if (resposta.status === 401) {
    chave.apagar();
    window.location.reload();
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Este acesso não tem a tela de logística liberada.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

const filtrosAtuais = () => ({
  inicio: el('inicio').value || null,
  fim: el('fim').value || null,
  busca: el('pesquisa-termo').value.trim() || null,
  empresa: el('filtro-empresa').value || null,
});

function mostrarStatus(texto, erro = false, id = 'status') {
  el(id).textContent = texto;
  el(id).classList.toggle('status--erro', erro);
}

function span(texto, classe) {
  const s = document.createElement('span');
  s.textContent = texto;
  if (classe) s.className = classe;
  return s;
}

function td(conteudo, classe) {
  const celula = document.createElement('td');
  if (classe) celula.className = classe;
  if (conteudo instanceof Node) celula.append(conteudo);
  else celula.textContent = conteudo ?? '—';
  return celula;
}

function comAuxiliar(texto, auxiliar, classe, classeAuxiliar = 'qtd') {
  const celula = td(texto, classe);
  if (auxiliar) celula.append(span(auxiliar, classeAuxiliar));
  return celula;
}

function periodoPronto(nome) {
  const hoje = new Date();
  if (nome === 'mes') {
    return { inicio: formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: formatarData(hoje) };
  }
  const dias = Number(nome);
  return {
    inicio: formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - Math.max(0, dias - 1))),
    fim: formatarData(hoje),
  };
}

function marcarAtalho() {
  const inicio = el('inicio').value;
  const fim = el('fim').value;
  let marcado = false;
  for (const botao of el('atalhos').querySelectorAll('[data-dias]')) {
    const periodo = periodoPronto(botao.dataset.dias);
    const igual = !marcado && periodo.inicio === inicio && periodo.fim === fim;
    botao.classList.toggle('atalho--ativo', igual);
    botao.setAttribute('aria-pressed', String(igual));
    if (igual) marcado = true;
  }
}

// ===== Carregar =====
async function carregar() {
  estado.salvar('logistica', { ...filtrosAtuais(), alerta: alertaAtual });
  mostrarStatus('Carregando os produtos…');
  const inicioCarga = Date.now();
  try {
    const dados = await buscar('produtos', { ...filtrosAtuais(), alerta: alertaAtual });
    lista = dados.lista;
    resumo = dados.resumo;
    mostrarResumo();
    mostrarAlertas();
    mostrarLista();
    el('painel').hidden = false;
    const segundos = ((Date.now() - inicioCarga) / 1000).toFixed(1).replace('.', ',');
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      + ` · carregou em ${segundos} s`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

async function carregarEmpresas() {
  try {
    const empresas = await buscar('empresas');
    const escolhida = el('filtro-empresa').value;
    el('filtro-empresa').replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: 'Todas' }),
      ...empresas.map((e) => Object.assign(document.createElement('option'), {
        value: String(e.empresa),
        textContent: e.nome || `Empresa ${e.empresa}`,
      })),
    );
    el('filtro-empresa').value = escolhida;
  } catch {
    // sem a lista de empresas a tela funciona igual, mostrando todas
  }
}

function mostrarResumo() {
  el('total-vendido').textContent = dinheiro(resumo.valor_vendido);
  el('total-explica').textContent = `${plural(resumo.produtos, 'produto', 'produtos')} com movimento no período`;
  el('ind-comprado').replaceChildren(dinheiro(resumo.valor_comprado),
    span('notas de compra do período'));
  el('ind-negativos').replaceChildren(inteiro(resumo.negativos), span('produtos vendendo sem entrada'));
  el('ind-negativos').classList.toggle('negativo', Number(resumo.negativos) > 0);
  el('ind-precos').replaceChildren(inteiro(resumo.precos_alterados),
    span(`produtos${Number(resumo.precos_fora) ? ` · ${inteiro(resumo.precos_fora)} fora do sistema` : ''}`));
  el('ind-precos').classList.toggle('negativo', Number(resumo.precos_fora) > 0);
}

// Cartões de alerta: cada um filtra a lista (clicar de novo tira o filtro)
function mostrarAlertas() {
  el('alertas').replaceChildren(...Object.entries(ALERTAS).map(([id, a]) => {
    const qtd = Number(resumo[a.campo]) || 0;
    const ativo = alertaAtual === id;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const titulo = document.createElement('h3');
    titulo.textContent = a.titulo;
    const valor = document.createElement('p');
    valor.className = `cartao-valor${qtd > 0 && !a.informativo ? ' negativo' : ''}`;
    valor.textContent = inteiro(qtd);
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = qtd > 0 ? a.nota : 'nada encontrado';
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      alertaAtual = ativo ? null : id;
      carregar();
    });
    return botao;
  }));
}

function mostrarMarcadores() {
  const itens = [];
  if (alertaAtual) itens.push({ texto: ALERTAS[alertaAtual].titulo, remover: () => { alertaAtual = null; } });
  const termo = el('pesquisa-termo').value.trim();
  if (termo) {
    itens.push({
      texto: `Pesquisa: ${termo}`,
      remover: () => { el('pesquisa-termo').value = ''; el('limpar-pesquisa').hidden = true; },
    });
  }
  const empresa = el('filtro-empresa');
  if (empresa.value) {
    itens.push({
      texto: `Empresa: ${empresa.options[empresa.selectedIndex].textContent}`,
      remover: () => { empresa.value = ''; },
    });
  }
  const area = el('marcadores');
  area.hidden = itens.length === 0;
  area.replaceChildren(...itens.map((item) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'marcador';
    botao.append(item.texto, span('×'));
    botao.addEventListener('click', () => {
      item.remover();
      carregar();
    });
    return botao;
  }));
}

// ===== Lista de produtos =====
const COLUNAS = [
  ['Produto', 'descricao', true],
  ['Comprado', 'comprado'],
  ['Vendido', 'vendido'],
  ['Saldo hoje', 'saldo'],
  ['Valor unitário', 'valor_unitario'],
  ['Custo médio', 'custo_medio'],
  ['Varejo', 'varejo'],
  ['Atacado', 'atacado'],
  ['Valor vendido', 'valor_vendido'],
  ['Últimas mudanças de preço (R$)', 'ultima_alteracao_texto', true],
];

function cabecalhoOrdenavel(tabela, colunas, aoOrdenar) {
  const cab = document.createElement('tr');
  for (const [texto, campo, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (esquerda) th.className = 'esquerda';
    const ativa = ordem.coluna === campo;
    const crescente = ordem.direcao === 'asc';
    if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
    const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
    seta.setAttribute('aria-hidden', 'true');
    botao.append(texto, seta);
    botao.addEventListener('click', () => {
      ordem = { coluna: campo, direcao: ativa && !crescente ? 'asc' : 'desc' };
      aoOrdenar();
    });
    th.append(botao);
    cab.append(th);
  }
  tabela.tHead.replaceChildren(cab);
}

// Primeiro nome de quem alterou ("ANDREZA NARA COSTA" ou "andreza.costa" viram "Andreza")
function primeiroNome(nome) {
  const primeiro = String(nome).trim().split(/[\s.]+/)[0].toLowerCase();
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1);
}

// As últimas mudanças de preço do produto, uma por linha: data, tabela, de → para e quem
function mudancasDePreco(mudancas = []) {
  if (!mudancas.length) return span('sem mudança desde mai/2026', 'qtd');
  const lista = document.createElement('div');
  for (const m of mudancas) {
    const linha = document.createElement('div');
    const valor = (v) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    linha.title = `${dataHoraBR(m.quando)} · ${m.nome_tabela}: ${dinheiro(m.antes)} → ${dinheiro(m.depois)}`
      + `${m.quem ? ` · por ${m.quem}` : ''}${m.fora_do_sistema ? ' · alterado fora do sistema' : ''}`;
    linha.append(
      `${dataBR(m.quando).slice(0, 6)}${dataBR(m.quando).slice(8)} `,
      span(m.nome_tabela, m.tabela === 4 ? 'tabela-preco tabela-preco--atacado' : 'tabela-preco tabela-preco--varejo'),
      ` ${valor(m.antes)} → ${valor(m.depois)}`,
    );
    const autor = [m.quem ? `por ${m.fora_do_sistema ? m.quem : primeiroNome(m.quem)}` : null, m.fora_do_sistema ? 'fora do sistema' : null]
      .filter(Boolean).join(' · ');
    if (autor) linha.append(span(autor, m.fora_do_sistema ? 'qtd negativo' : 'qtd'));
    lista.append(linha);
  }
  return lista;
}

function mostrarLista() {
  mostrarMarcadores();
  const fator = ordem.direcao === 'asc' ? 1 : -1;
  const itens = [...lista].sort((a, b) => {
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  el('titulo-lista').textContent = `Produtos (${inteiro(itens.length)})`;

  const tabela = el('tabela-produtos');
  cabecalhoOrdenavel(tabela, COLUNAS, mostrarLista);

  const linhas = [];
  if (!itens.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum produto com esses filtros.', 'vazio');
    vazio.colSpan = COLUNAS.length;
    linha.append(vazio);
    linhas.push(linha);
  }
  const MAXIMO = 500;
  for (const p of itens.slice(0, MAXIMO)) {
    const linha = document.createElement('tr');
    linha.className = 'linha-dia';
    linha.tabIndex = 0;
    linha.title = 'Ver a ficha do produto';
    const saldoNegativo = Number(p.saldo) < 0;
    const fornecedor = p.fornecedor ? `${p.produto} · ${p.fornecedor}` : String(p.produto);
    linha.append(
      comAuxiliar(p.descricao, fornecedor, 'esquerda'),
      comAuxiliar(inteiro(p.comprado), Number(p.entrou) !== Number(p.comprado) ? `entrou ${inteiro(p.entrou)}` : null),
      comAuxiliar(inteiro(p.vendido), Number(p.saiu) !== Number(p.vendido) ? `saiu ${inteiro(p.saiu)}` : null),
      td(inteiro(p.saldo), saldoNegativo ? 'negativo' : null),
      comAuxiliar(dinheiro(p.valor_unitario), p.ultima_compra ? `em ${dataBR(p.ultima_compra)}` : null),
      td(dinheiro(p.custo_medio)),
      td(dinheiro(p.varejo)),
      td(dinheiro(p.atacado)),
      td(dinheiro(p.valor_vendido), 'coluna-final'),
      td(mudancasDePreco(p.ultimas_mudancas), 'esquerda sem-quebra'),
    );
    linha.addEventListener('click', () => abrirFicha(p.produto));
    linha.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') abrirFicha(p.produto);
    });
    linhas.push(linha);
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const soma = (campo) => itens.reduce((t, p) => t + (Number(p[campo]) || 0), 0);
  const rodape = document.createElement('tr');
  const rotulo = td(itens.length > MAXIMO
    ? `Total (${plural(itens.length, 'produto', 'produtos')}; mostrando os ${MAXIMO} primeiros)`
    : `Total (${plural(itens.length, 'produto', 'produtos')})`, 'esquerda');
  rotulo.colSpan = COLUNAS.length - 2;
  rodape.append(rotulo, td(dinheiro(soma('valor_vendido'))), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Ficha do produto =====
function tabelaSimples(colunas, linhas, vazio, classe = 'tabela') {
  const rolagem = document.createElement('div');
  rolagem.className = 'tabela-rolagem';
  const tabela = document.createElement('table');
  tabela.className = classe;
  const cab = document.createElement('tr');
  for (const [texto, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = texto;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  tabela.createTHead().append(cab);
  const corpo = tabela.createTBody();
  if (!linhas.length) {
    const linha = corpo.insertRow();
    const celula = td(vazio, 'vazio');
    celula.colSpan = colunas.length;
    linha.append(celula);
  }
  for (const celulas of linhas) {
    const linha = corpo.insertRow();
    linha.append(...celulas);
  }
  rolagem.append(tabela);
  return rolagem;
}

function titulo(texto, explica) {
  const partes = [Object.assign(document.createElement('h3'), { textContent: texto })];
  if (explica) partes.push(Object.assign(document.createElement('p'), { className: 'explica', textContent: explica }));
  return partes;
}

function etiquetaTabela(tabela, nome) {
  const classe = { 1: 'tabela-preco tabela-preco--varejo', 4: 'tabela-preco tabela-preco--atacado' }[tabela] ?? 'tabela-preco';
  return span(nome, classe);
}

function variacao(antes, depois) {
  const a = Number(antes);
  if (!a) return null;
  const pct = ((Number(depois) - a) / a) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`;
}

async function abrirFicha(codigo) {
  const dialogo = el('ficha');
  el('ficha-titulo').textContent = `Produto ${codigo}`;
  el('ficha-resumo').textContent = '';
  el('ficha-corpo').replaceChildren();
  mostrarStatus('Carregando a ficha…', false, 'ficha-status');
  if (!dialogo.open) dialogo.showModal();
  try {
    const empresa = el('filtro-empresa').value || null;
    const f = await buscar(`produtos/${codigo}`, { empresa });
    const saldo = f.estoque.reduce((t, e) => t + (Number(e.saldo) || 0), 0);
    const nomeEmpresa = empresa ? el('filtro-empresa').selectedOptions[0].textContent : 'todas as empresas';
    el('ficha-titulo').textContent = f.produto.descricao;
    el('ficha-resumo').textContent = `código ${f.produto.produto} · saldo hoje ${inteiro(saldo)} (${nomeEmpresa})`;
    mostrarStatus('', false, 'ficha-status');

    // Preço atual
    const precos = document.createElement('dl');
    precos.className = 'numeros';
    for (const p of f.precos) {
      const bloco = document.createElement('div');
      bloco.className = 'numero';
      const dt = Object.assign(document.createElement('dt'), { textContent: `Preço ${p.nome_tabela.toLowerCase()}` });
      const dd = Object.assign(document.createElement('dd'), { textContent: dinheiro(p.preco) });
      const nota = document.createElement('div');
      nota.className = 'nota';
      nota.textContent = ([
        p.custo_medio != null ? `custo médio ${dinheiro(p.custo_medio)}` : null,
        p.margem_pct != null ? `margem ${String(p.margem_pct).replace('.', ',')}%` : null,
        p.atualizado_por ? `salvo por ${p.atualizado_por} em ${dataHoraBR(p.atualizado_em)}` : null,
      ].filter(Boolean).join(' · '));
      dd.append(nota);
      bloco.append(dt, dd);
      precos.append(bloco);
    }

    // Histórico de preço
    const historico = tabelaSimples(
      [['Quando', true], ['Tabela', true], ['Antes'], ['Depois'], ['Variação'], ['Quem', true]],
      f.historico.map((h) => {
        const quem = h.fora_do_sistema
          ? comAuxiliar(h.quem ?? 'direto no banco', `fora do sistema${h.computador ? ` · ${h.computador}` : ''}`,
            'esquerda', 'qtd negativo')
          : comAuxiliar(h.quem ?? 'não registrado', h.login && h.login !== h.quem ? `login ${h.login}` : 'pelo PROCFIT',
            'esquerda');
        return [
          td(dataHoraBR(h.quando), 'esquerda sem-quebra'),
          td(etiquetaTabela(h.tabela, h.nome_tabela), 'esquerda'),
          td(dinheiro(h.antes)),
          td(dinheiro(h.depois)),
          td(variacao(h.antes, h.depois) ?? '—', Number(h.depois) < Number(h.antes) ? 'negativo' : null),
          quem,
        ];
      }),
      'Nenhuma mudança de preço desde mai/2026, quando o registro começou.',
    );

    // Mês a mês
    const meses = tabelaSimples(
      [['Mês', true], ['Comprado'], ['Entrou no estoque'], ['Vendido'], ['Saiu do estoque']],
      f.meses.map((m) => [
        td(mesBR(m.mes), 'esquerda'),
        td(inteiro(m.comprado)),
        td(inteiro(m.entrou), Number(m.entrou) < Number(m.comprado) ? 'negativo' : null),
        td(inteiro(m.vendido)),
        td(inteiro(m.saiu)),
      ]),
      'Sem movimento registrado.',
    );

    // Estoque por empresa
    const estoque = tabelaSimples(
      [['Empresa', true], ['Entradas'], ['Saídas'], ['Saldo hoje']],
      f.estoque.map((e) => [
        td(e.nome || `Empresa ${e.empresa}`, 'esquerda'),
        td(inteiro(e.entradas)),
        td(inteiro(e.saidas)),
        td(inteiro(e.saldo), Number(e.saldo) < 0 ? 'negativo' : 'coluna-final'),
      ]),
      'Sem lançamentos de estoque.',
    );

    // Compras nota a nota
    const compras = tabelaSimples(
      [['Data', true], ['Nota', true], ['Fornecedor', true], ['Quantidade na nota'], ['Entra no estoque'],
        ['Valor na nota'], ['Valor unitário'], ['Total']],
      f.compras.map((c) => [
        comAuxiliar(dataBR(c.data), `empresa ${c.empresa}`, 'esquerda sem-quebra'),
        td(String(c.nota), 'esquerda'),
        comAuxiliar(c.fornecedor ?? '—', c.cod_fornecedor ? `código ${c.cod_fornecedor}` : null, 'esquerda'),
        comAuxiliar(`${inteiro(c.quantidade)} ${c.unidade ?? ''}`.trim(),
          Number(c.embalagem) > 1 ? `com ${inteiro(c.embalagem)} cada` : null),
        td(inteiro(c.quantidade_estoque)),
        td(dinheiro(c.valor_nota)),
        td(dinheiro(c.valor_unitario), 'coluna-final'),
        td(dinheiro(c.total)),
      ]),
      'Nenhuma nota de compra deste produto.',
      'tabela tabela--detalhe',
    );

    el('ficha-corpo').replaceChildren(
      ...titulo('Preço de venda', 'Preço atual de cada tabela. A margem é a conta simples: (preço − custo médio) ÷ preço.'),
      precos,
      ...titulo('Histórico de preço', 'Cada mudança do preço de venda, com o valor de antes e o de depois.'),
      historico,
      ...titulo('Mês a mês', 'O que foi comprado e vendido, e o que o estoque registrou de entrada e saída.'),
      meses,
      ...titulo('Estoque por empresa'),
      estoque,
      ...titulo('Compras', 'Valor unitário = total da nota ÷ quantidade que entra no estoque.'),
      compras,
    );
  } catch (erro) {
    mostrarStatus(erro.message, true, 'ficha-status');
  }
}

// ===== Excel =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/logistica/produtos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({ ...filtrosAtuais(), alerta: alertaAtual })) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'logistica.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    mostrarStatus(`Excel: ${erro.message}`, true);
  } finally {
    botao.disabled = false;
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    const informada = window.prompt('Informe a chave de acesso da logística:');
    if (!informada) {
      mostrarStatus('É preciso informar a chave de acesso para ver esta tela.', true);
      return;
    }
    chave.guardar(informada.trim());
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'logistica');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.reload();
      return;
    }
  }

  const periodo = periodoPronto('30');
  el('inicio').value = periodo.inicio;
  el('fim').value = periodo.fim;
  await carregarEmpresas();
  const guardado = estado.aplicarCampos('logistica', {
    inicio: 'inicio', fim: 'fim', busca: 'pesquisa-termo', empresa: 'filtro-empresa',
  });
  if (guardado.alerta && ALERTAS[guardado.alerta]) alertaAtual = guardado.alerta;
  el('limpar-pesquisa').hidden = !el('pesquisa-termo').value.trim();
  marcarAtalho();

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    window.location.reload();
  });
  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregar();
  });
  el('atalhos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-dias]');
    if (!botao) return;
    const novo = periodoPronto(botao.dataset.dias);
    el('inicio').value = novo.inicio;
    el('fim').value = novo.fim;
    marcarAtalho();
    carregar();
  });
  el('inicio').addEventListener('change', marcarAtalho);
  el('fim').addEventListener('change', marcarAtalho);
  el('form-pesquisa').addEventListener('submit', (evento) => {
    evento.preventDefault();
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    carregar();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    carregar();
  });
  el('baixar-excel').addEventListener('click', baixarExcel);
  el('ficha-fechar').addEventListener('click', () => el('ficha').close());

  carregar();
});
