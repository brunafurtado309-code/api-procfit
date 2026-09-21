// Aba Despachos do financeiro: acertos de carga (notas entregues x parcelas geradas).
//
// A chave de acesso é a mesma do financeiro (fica no sessionStorage).
// Sem chave, volta para a página do financeiro, que pede a chave.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (texto) => {
  if (!texto) return '—';
  const [data, hora] = String(texto).split(' ');
  return `${dataBR(data)}${hora ? ` ${hora}` : ''}`;
};
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

// Situação do despacho em linguagem simples (a ordem importa: a primeira que valer)
//   Não processado: o acerto ainda não gerou títulos no contas a receber
//   Falta receber:  alguma nota foi entregue sem pagamento completo
//   Conferir:       os títulos gerados não batem com o que foi recebido
//   Ok:             tudo recebido e processado
const SITUACOES = {
  SEM_PARCELAS: { texto: 'Não processado', classe: 'situacao--sem' },
  SEM_NOTAS: { texto: 'Sem notas', classe: 'situacao--cancelada' },
  DESCOBERTO: { texto: 'Falta receber', classe: 'situacao--devolucao' },
  DIFERENCA: { texto: 'Conferir', classe: 'situacao--devolucao' },
  CONFERIDO: { texto: 'Ok', classe: 'situacao--faturada' },
};
const FILTRO_TEXTO = Object.fromEntries(Object.entries(SITUACOES).map(([k, v]) => [k, v.texto]));

function situacaoDoDespacho(a) {
  if (a.situacao === 'SEM_PARCELAS' || a.situacao === 'SEM_NOTAS') return a.situacao;
  if (Number(a.a_descoberto) > 0.01) return 'DESCOBERTO';
  return a.situacao;
}

// Nome da forma de pagamento pelo código (quando o PROCFIT não trouxer a descrição)
const FORMAS = {
  0: 'Carteira', 1: 'Boleto', 2: 'Depósito', 3: 'Cheque', 4: 'Dinheiro',
  6: 'Cartão de crédito', 11: 'PIX', 12: 'Cartão de débito',
};
const nomeForma = (codigo, descricao) =>
  (descricao && descricao.trim()) || FORMAS[codigo] || (codigo != null ? `Forma ${codigo}` : 'Não informada');

// ===== Estado da tela =====
let acertos = [];          // lista do período (já filtrada pela situação na API)
let situacaoAtual = null;  // cartão clicado
let ordem = { coluna: 'acerto', direcao: 'desc' };

// ===== API =====
async function buscar(rota, parametros = {}) {
  const url = new URL(`/financeiro/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.href = 'financeiro.html';
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Esta chave não tem acesso ao financeiro.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

function filtrosAtuais() {
  return {
    inicio: el('inicio').value || null,
    fim: el('fim').value || null,
    busca: el('pesquisa-termo').value.trim() || null,
    situacao: situacaoAtual,
  };
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// ===== Períodos prontos =====
function periodoPronto(nome) {
  const hoje = new Date();
  const diasAtras = (dias) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias);
  const periodos = {
    hoje: [hoje, hoje],
    '7dias': [diasAtras(6), hoje],
    '30dias': [diasAtras(29), hoje],
    mes: [new Date(hoje.getFullYear(), hoje.getMonth(), 1), hoje],
    'mes-passado': [new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), new Date(hoje.getFullYear(), hoje.getMonth(), 0)],
    tudo: [null, null],
  };
  const [inicio, fim] = periodos[nome] ?? [null, null];
  return { inicio: inicio ? formatarData(inicio) : '', fim: fim ? formatarData(fim) : '' };
}

function marcarAtalho(ativo) {
  for (const item of el('atalhos').querySelectorAll('[data-periodo]')) {
    item.classList.toggle('atalho--ativo', item === ativo);
  }
}

// ===== Carregar =====
async function carregar() {
  mostrarStatus('Carregando os acertos…');
  try {
    const { resumo, lista } = await buscar('despachos', filtrosAtuais());
    acertos = lista;
    mostrarResumo(resumo);
    mostrarCartoes(resumo);
    mostrarMarcadores();
    mostrarLista();
    el('painel').hidden = false;
    mostrarStatus(`${situacaoAtual ? `${FILTRO_TEXTO[situacaoAtual]} · ` : ''}atualizado às ${
      new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarResumo(r) {
  el('total-notas').textContent = dinheiro(r.total_notas);
  el('total-explica').textContent = `${plural(r.acertos, 'despacho', 'despachos')} · ${plural(r.notas, 'nota', 'notas')}`;
  el('ind-informado').replaceChildren(dinheiro(r.total_informado), span('pago pelos clientes'));
  el('ind-descoberto').replaceChildren(dinheiro(r.a_descoberto),
    span(`${plural(r.com_descoberto, 'despacho', 'despachos')} com nota paga em parte`));
  el('ind-parcelas').replaceChildren(inteiro(r.sem_parcelas), span('sem títulos no contas a receber'));
  el('ind-diferenca').replaceChildren(inteiro(r.com_diferenca), span('títulos diferentes do recebido'));
  el('ind-descoberto').classList.toggle('negativo', r.a_descoberto > 0.01);
  el('ind-parcelas').classList.toggle('negativo', r.sem_parcelas > 0);
  el('ind-diferenca').classList.toggle('negativo', r.com_diferenca > 0);
}

function span(texto) {
  const s = document.createElement('span');
  s.textContent = texto;
  return s;
}

// Cartões-filtro: clicar mostra só os acertos daquela situação
function mostrarCartoes(r) {
  const cartoes = [
    { situacao: null, titulo: 'Todos', valor: r.acertos, nota: 'despachos no período' },
    { situacao: 'DESCOBERTO', titulo: 'Falta receber', valor: r.com_descoberto, nota: 'nota paga em parte' },
    { situacao: 'SEM_PARCELAS', titulo: 'Não processados', valor: r.sem_parcelas, nota: 'sem títulos gerados' },
    { situacao: 'DIFERENCA', titulo: 'Para conferir', valor: r.com_diferenca, nota: 'títulos ≠ recebido' },
  ];
  el('cartoes').replaceChildren(...cartoes.map((c) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `cartao${situacaoAtual === c.situacao ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(situacaoAtual === c.situacao));
    const titulo = document.createElement('h3');
    titulo.textContent = c.titulo;
    const valor = document.createElement('p');
    valor.className = 'cartao-valor';
    valor.textContent = inteiro(c.valor);
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = c.nota;
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      situacaoAtual = c.situacao;
      carregar();
    });
    return botao;
  }));
}

function mostrarMarcadores() {
  const area = el('marcadores');
  if (!situacaoAtual) {
    area.hidden = true;
    area.replaceChildren();
    return;
  }
  const marcador = document.createElement('button');
  marcador.type = 'button';
  marcador.className = 'marcador';
  marcador.append(`Filtro: ${FILTRO_TEXTO[situacaoAtual]}`, span('×'));
  marcador.addEventListener('click', () => {
    situacaoAtual = null;
    carregar();
  });
  area.replaceChildren(marcador);
  area.hidden = false;
}

// ===== Lista de acertos (ordenável clicando no nome da coluna) =====
const COLUNAS = [
  { titulo: 'Despacho', chave: 'carga', esquerda: true },
  { titulo: 'Data', chave: 'data_recebimento', esquerda: true },
  { titulo: 'Notas', chave: 'notas' },
  { titulo: 'Valor das notas', chave: 'total_notas' },
  { titulo: 'Recebido', chave: 'total_informado' },
  { titulo: 'Falta receber', chave: 'a_descoberto' },
  { titulo: 'Situação', chave: 'situacao_tela', esquerda: true },
];

function ordenados() {
  const { coluna, direcao } = ordem;
  const fator = direcao === 'asc' ? 1 : -1;
  return [...acertos].sort((a, b) => {
    const x = a[coluna];
    const y = b[coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
}

function cabecalho() {
  const linha = document.createElement('tr');
  for (const coluna of COLUNAS) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (coluna.esquerda) th.className = 'esquerda';
    const ativa = ordem.coluna === coluna.chave;
    const crescente = ordem.direcao === 'asc';
    if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
    const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕');
    seta.className = 'ordenar__seta';
    seta.setAttribute('aria-hidden', 'true');
    botao.append(coluna.titulo, seta);
    botao.addEventListener('click', () => {
      ordem = { coluna: coluna.chave, direcao: ativa && crescente ? 'desc' : 'asc' };
      mostrarLista();
    });
    th.append(botao);
    linha.append(th);
  }
  return linha;
}

function td(conteudo, classe) {
  const celula = document.createElement('td');
  if (classe) celula.className = classe;
  if (conteudo instanceof Node) celula.append(conteudo);
  else celula.textContent = conteudo ?? '—';
  return celula;
}

function comAuxiliar(texto, auxiliar, classe) {
  const celula = td(texto, classe);
  if (auxiliar) {
    const extra = span(auxiliar);
    extra.className = 'qtd';
    celula.append(extra);
  }
  return celula;
}

function etiquetaSituacao(situacao) {
  const info = SITUACOES[situacao] ?? { texto: situacao, classe: '' };
  const etiqueta = span(info.texto);
  etiqueta.className = `situacao ${info.classe}`;
  return etiqueta;
}

function mostrarLista() {
  const tabela = el('tabela-acertos');
  tabela.tHead.replaceChildren(cabecalho());
  for (const a of acertos) a.situacao_tela = SITUACOES[situacaoDoDespacho(a)]?.texto ?? '';
  el('titulo-lista').textContent = situacaoAtual ? `Despachos · ${FILTRO_TEXTO[situacaoAtual]}` : 'Despachos';

  const corpo = tabela.tBodies[0];
  if (acertos.length === 0) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum despacho encontrado com esses filtros.', 'vazio');
    vazio.colSpan = COLUNAS.length;
    linha.append(vazio);
    corpo.replaceChildren(linha);
  } else {
    corpo.replaceChildren(...ordenados().map((a) => {
      const linha = document.createElement('tr');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'link-pedido';
      botao.textContent = a.carga ? `Despacho ${a.carga}` : `Acerto ${a.acerto}`;
      botao.title = 'Ver as notas e como cada uma foi paga';
      botao.addEventListener('click', () => abrirAcerto(a.acerto));
      const falta = Number(a.a_descoberto) || 0;
      linha.append(
        comAuxiliar(botao, `acerto ${a.acerto}`, 'esquerda sem-quebra'),
        comAuxiliar(dataBR(a.data_recebimento), `usuário ${a.usuario ?? '—'}`, 'esquerda sem-quebra'),
        td(inteiro(a.notas)),
        td(dinheiro(a.total_notas)),
        td(dinheiro(a.total_informado)),
        td(falta > 0.01 ? dinheiro(falta) : '—', falta > 0.01 ? 'negativo' : null),
        td(etiquetaSituacao(situacaoDoDespacho(a)), 'esquerda'),
      );
      return linha;
    }));
  }

  // Rodapé: soma do que está na lista
  const soma = (campo) => acertos.reduce((t, a) => t + (Number(a[campo]) || 0), 0);
  const rodape = document.createElement('tr');
  const rotulo = td(`Total (${plural(acertos.length, 'despacho', 'despachos')})`, 'esquerda');
  rotulo.colSpan = 2;
  rodape.append(rotulo, td(inteiro(soma('notas'))), td(dinheiro(soma('total_notas'))),
    td(dinheiro(soma('total_informado'))), td(dinheiro(soma('a_descoberto'))), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Janela do acerto =====
function janelaAcerto() {
  let dialogo = el('janela-acerto');
  if (dialogo) return dialogo;
  dialogo = document.createElement('dialog');
  dialogo.id = 'janela-acerto';
  dialogo.className = 'detalhe';
  dialogo.innerHTML = `
    <header class="detalhe__topo">
      <div>
        <h2 id="acerto-titulo">Acerto</h2>
        <p id="acerto-resumo" class="detalhe__resumo"></p>
      </div>
      <div class="detalhe__acoes">
        <button type="button" class="botao-secundario" id="acerto-fechar">Fechar</button>
      </div>
    </header>
    <p id="acerto-status" class="status" role="status"></p>
    <div id="acerto-corpo" class="detalhe__corpo pedido-corpo"></div>`;
  document.body.append(dialogo);
  el('acerto-fechar').addEventListener('click', () => dialogo.close());
  return dialogo;
}

function tabelaSimples(colunas, linhas, rodape) {
  const rolagem = document.createElement('div');
  rolagem.className = 'tabela-rolagem';
  const tabela = document.createElement('table');
  tabela.className = 'tabela tabela--pedido';
  const cab = document.createElement('tr');
  for (const [titulo, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = titulo;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  tabela.createTHead().append(cab);
  const corpo = tabela.createTBody();
  for (const linha of linhas) corpo.append(linha);
  if (rodape) tabela.createTFoot().append(rodape);
  rolagem.append(tabela);
  return rolagem;
}

function linhaDe(...celulas) {
  const linha = document.createElement('tr');
  linha.append(...celulas);
  return linha;
}

function aviso(texto) {
  const p = document.createElement('p');
  p.className = 'pedido-obs';
  p.textContent = texto;
  return p;
}

async function abrirAcerto(numero) {
  const dialogo = janelaAcerto();
  el('acerto-titulo').textContent = `Acerto ${numero}`;
  el('acerto-resumo').textContent = '';
  el('acerto-status').textContent = 'Carregando o acerto…';
  el('acerto-status').classList.remove('status--erro');
  el('acerto-corpo').replaceChildren();
  if (!dialogo.open) dialogo.showModal();

  try {
    const { acerto: a, notas, parcelas, cartoes } = await buscar(`despachos/${numero}`);
    el('acerto-status').textContent = '';
    el('acerto-titulo').textContent = a.carga ? `Despacho ${a.carga}` : `Acerto ${numero}`;
    el('acerto-resumo').textContent = [
      `acerto ${numero}`,
      `recebido em ${dataBR(a.data_recebimento)}`,
      `lançado ${dataHoraBR(a.digitado_em)} pelo usuário ${a.usuario ?? '—'}`,
    ].join(' · ');

    const partes = [];
    const titulo = (texto) => {
      const h3 = document.createElement('h3');
      h3.textContent = texto;
      return h3;
    };

    // Junta as linhas de cada nota (pagamento dividido vem em mais de uma linha)
    const cartoesPorNota = new Map();
    for (const c of cartoes) {
      if (!cartoesPorNota.has(c.nota)) cartoesPorNota.set(c.nota, []);
      cartoesPorNota.get(c.nota).push(c);
    }
    const porNota = new Map();
    for (const linha of notas) {
      const chaveNota = linha.nota ?? `sem-nota-${linha.detalhe}`;
      if (!porNota.has(chaveNota)) {
        porNota.set(chaveNota, { ...linha, valor_nota: null, pago: 0, formas: [] });
      }
      const nota = porNota.get(chaveNota);
      if (linha.copia_de == null || nota.valor_nota == null) nota.valor_nota = Number(linha.valor_nota) || nota.valor_nota;
      if (!nota.pedido && linha.pedido) nota.pedido = linha.pedido;
      const valor = Number(linha.valor_informado) || 0;
      if (valor > 0.001) {
        nota.pago += valor;
        nota.formas.push({ nome: nomeForma(linha.modalidade, linha.forma), valor });
      }
    }
    // Cartão: acrescenta bandeira e parcelas ao nome da forma
    for (const nota of porNota.values()) {
      const lista = cartoesPorNota.get(nota.nota) ?? [];
      const complemento = lista.map((c) => [c.bandeira, c.parcelas > 1 ? `${c.parcelas}x` : null].filter(Boolean).join(' '))
        .filter(Boolean).join(', ');
      if (complemento) {
        const cartao = nota.formas.find((f) => /cart|créd|cred|déb|deb/i.test(f.nome));
        if (cartao) cartao.nome += ` (${complemento})`;
      }
    }
    const listaNotas = [...porNota.values()];
    const totalNotas = listaNotas.reduce((t, n) => t + (Number(n.valor_nota) || 0), 0);
    const totalPago = listaNotas.reduce((t, n) => t + n.pago, 0);
    const totalFalta = Math.max(0, totalNotas - totalPago);

    // Resumo do despacho: quanto veio em cada forma (confere com o dinheiro e os comprovantes)
    const porForma = new Map();
    for (const nota of listaNotas) {
      for (const f of nota.formas) {
        const nome = f.nome.replace(/\s*\(.*\)$/, '');
        porForma.set(nome, (porForma.get(nome) ?? 0) + f.valor);
      }
    }
    const dados = document.createElement('dl');
    dados.className = 'pedido-dados';
    const item = (rotulo, valor, alerta = false) => {
      const bloco = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      if (valor instanceof Node) dd.append(valor); else dd.textContent = valor ?? '—';
      if (alerta) dd.className = 'negativo';
      bloco.append(dt, dd);
      dados.append(bloco);
    };
    item('Situação', etiquetaSituacao(situacaoDoDespacho(a)));
    item('Valor das notas', dinheiro(totalNotas));
    item('Recebido', dinheiro(totalPago));
    item('Falta receber', totalFalta > 0.01 ? dinheiro(totalFalta) : 'nada', totalFalta > 0.01);
    for (const [nome, valor] of [...porForma.entries()].sort((x, y) => y[1] - x[1])) {
      item(nome, dinheiro(valor));
    }
    partes.push(dados);

    // Aviso só quando o processamento não bate com o recebido
    const diferenca = Number(a.diferenca) || 0;
    if (a.situacao === 'SEM_PARCELAS') {
      partes.push(aviso('Este acerto ainda não foi processado: as notas abaixo não viraram títulos no contas a receber.'));
    } else if (Math.abs(diferenca) > 0.01) {
      partes.push(aviso(`Atenção: os títulos gerados somam ${dinheiro(a.total_parcelas)}, `
        + `${dinheiro(Math.abs(diferenca))} ${diferenca > 0 ? 'a menos' : 'a mais'} que o recebido.`));
    }

    // Notas, uma por linha, com todas as formas de pagamento
    partes.push(titulo(`Notas (${listaNotas.length})`));
    const rotuloTotal = td('Total', 'esquerda');
    rotuloTotal.colSpan = 4;
    partes.push(tabelaSimples(
      [['Nota', true], ['Cliente', true], ['Pedido', true], ['Como foi pago', true], ['Valor da nota'], ['Pago'], ['Falta pagar']],
      listaNotas.map((n) => {
        const falta = (Number(n.valor_nota) || 0) - n.pago;
        const formas = n.formas.length
          ? n.formas.map((f) => `${f.nome} ${dinheiro(f.valor)}`).join(' + ')
          : 'nenhum pagamento informado';
        return linhaDe(
          td(n.nota ? `NF ${n.nota}` : '—', 'esquerda sem-quebra'),
          td([n.codigo_cliente, n.cliente].filter(Boolean).join(' · ') || '—', 'esquerda'),
          td(pedidoJanela.link(n.pedido), 'esquerda'),
          td(formas, n.formas.length ? 'esquerda' : 'esquerda negativo'),
          td(dinheiro(n.valor_nota)),
          td(dinheiro(n.pago)),
          td(falta > 0.01 ? dinheiro(falta) : '—', falta > 0.01 ? 'negativo' : null),
        );
      }),
      linhaDe(rotuloTotal, td(dinheiro(totalNotas)), td(dinheiro(totalPago)),
        td(totalFalta > 0.01 ? dinheiro(totalFalta) : '—', totalFalta > 0.01 ? 'negativo' : null)),
    ));

    // Títulos gerados: fechado, para quem quiser conferir
    if (parcelas.length) {
      const detalhes = document.createElement('details');
      detalhes.className = 'mais-detalhes';
      const resumo = document.createElement('summary');
      resumo.textContent = `Ver os títulos gerados no contas a receber (${parcelas.length} · ${dinheiro(a.total_parcelas)})`;
      detalhes.append(resumo, tabelaSimples(
        [['Título', true], ['Cliente', true], ['Forma', true], ['Vencimento', true], ['Valor']],
        parcelas.map((p) => linhaDe(
          td(p.titulo ?? '—', 'esquerda sem-quebra'),
          td([p.codigo_cliente, p.cliente].filter(Boolean).join(' · ') || '—', 'esquerda'),
          td(p.forma ?? '—', 'esquerda'),
          td(dataBR(p.vencimento), 'esquerda'),
          td(dinheiro(p.valor)),
        )),
      ));
      partes.push(detalhes);
    }

    el('acerto-corpo').replaceChildren(...partes);
  } catch (erro) {
    el('acerto-status').textContent = erro.message;
    el('acerto-status').classList.add('status--erro');
  }
}

// ===== Excel: a mesma lista da tela =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/despachos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries(filtrosAtuais())) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const cabecalhoArquivo = resposta.headers.get('Content-Disposition') || '';
    const nome = (cabecalhoArquivo.match(/filename="([^"]+)"/) || [])[1] || 'acertos-despacho.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    window.location.href = 'financeiro.html';
    return;
  }
  pedidoJanela.configurar({ setor: 'financeiro' });

  // Menu de módulos (Vendas | Financeiro) para quem tem mais de um setor
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'financeiro');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.href = 'financeiro.html';
      return;
    }
  }

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    window.location.href = 'financeiro.html';
  });

  // Período inicial: últimos 30 dias
  const inicial = periodoPronto('30dias');
  el('inicio').value = inicial.inicio;
  el('fim').value = inicial.fim;

  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregar();
  });
  el('atalhos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-periodo]');
    if (!botao) return;
    const periodo = periodoPronto(botao.dataset.periodo);
    el('inicio').value = periodo.inicio;
    el('fim').value = periodo.fim;
    marcarAtalho(botao);
    carregar();
  });
  for (const id of ['inicio', 'fim']) {
    el(id).addEventListener('input', () => marcarAtalho(null));
  }

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

  carregar();
});
