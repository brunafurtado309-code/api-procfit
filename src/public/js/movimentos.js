// Entradas e saídas: o que entrou e saiu do estoque, só em quantidade.
// Na ficha do produto, cada movimento com o documento e quem lançou a nota de compra.

const el = (id) => document.getElementById(id);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (valor) => (valor ? `${dataBR(valor)} ${String(valor).slice(11, 16)}` : '—');
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

let lista = [];
let resumo = {};
let ordem = { coluna: 'saiu', direcao: 'desc' };

const TEMPO_LIMITE_MS = 60000;

async function buscar(rota, parametros = {}) {
  const url = new URL(`/movimentos/${rota}`, window.location.origin);
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
  if (resposta.status === 403) throw new Error('Este acesso não tem a tela de entradas e saídas liberada.');
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
  mostrarStatus('Carregando os movimentos…');
  const inicioCarga = Date.now();
  try {
    const dados = await buscar('produtos', filtrosAtuais());
    lista = dados.lista;
    resumo = dados.resumo;
    mostrarResumo();
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
    el('filtro-empresa').replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: 'Todas' }),
      ...empresas.map((e) => Object.assign(document.createElement('option'), {
        value: String(e.empresa),
        textContent: e.nome || `Empresa ${e.empresa}`,
      })),
    );
  } catch {
    // sem a lista de empresas a tela funciona igual, mostrando todas
  }
}

function mostrarResumo() {
  el('total-saiu').textContent = inteiro(resumo.saiu);
  el('total-explica').textContent = `unidades · ${plural(resumo.produtos, 'produto', 'produtos')} com movimento`;
  el('ind-entrou').replaceChildren(inteiro(resumo.entrou), span('unidades'));
  el('ind-negativos').replaceChildren(inteiro(resumo.negativos), span('produtos com saldo abaixo de zero'));
  el('ind-negativos').classList.toggle('negativo', Number(resumo.negativos) > 0);
}

// ===== Lista de produtos =====
const COLUNAS = [
  ['Produto', 'descricao', true],
  ['Entrou', 'entrou'],
  ['Saiu', 'saiu'],
  ['Saldo hoje', 'saldo'],
  ['Movimentos', 'movimentos'],
  ['Último movimento', 'ultimo', true],
];

function mostrarLista() {
  const fator = ordem.direcao === 'asc' ? 1 : -1;
  const itens = [...lista].sort((a, b) => {
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  el('titulo-lista').textContent = `Produtos (${inteiro(itens.length)})`;

  const tabela = el('tabela-produtos');
  const cab = document.createElement('tr');
  for (const [texto, campo, esquerda] of COLUNAS) {
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
      mostrarLista();
    });
    th.append(botao);
    cab.append(th);
  }
  tabela.tHead.replaceChildren(cab);

  const linhas = [];
  if (!itens.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum movimento com esses filtros.', 'vazio');
    vazio.colSpan = COLUNAS.length;
    linha.append(vazio);
    linhas.push(linha);
  }
  const MAXIMO = 500;
  for (const p of itens.slice(0, MAXIMO)) {
    const linha = document.createElement('tr');
    linha.className = 'linha-dia';
    linha.tabIndex = 0;
    linha.title = 'Ver os movimentos do produto';
    linha.append(
      comAuxiliar(p.descricao, String(p.produto), 'esquerda'),
      td(inteiro(p.entrou)),
      td(inteiro(p.saiu)),
      td(inteiro(p.saldo), Number(p.saldo) < 0 ? 'negativo' : 'coluna-final'),
      td(inteiro(p.movimentos)),
      td(dataHoraBR(p.ultimo), 'esquerda sem-quebra'),
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
  rodape.append(rotulo, td(inteiro(soma('entrou'))), td(inteiro(soma('saiu'))), td(''), td(inteiro(soma('movimentos'))), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Ficha: movimento a movimento =====
function tabelaSimples(colunas, linhas, vazio) {
  const rolagem = document.createElement('div');
  rolagem.className = 'tabela-rolagem';
  const tabela = document.createElement('table');
  tabela.className = 'tabela tabela--detalhe';
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
  for (const celulas of linhas) corpo.insertRow().append(...celulas);
  rolagem.append(tabela);
  return rolagem;
}

// Nota de compra: quem lançou no PROCFIT e quando; o processamento (entrada no estoque) embaixo
function quemLancou(m) {
  if (!m.nota_compra && !m.nota_lancada_por) return td('—', 'esquerda');
  const texto = `${m.nota_lancada_por ?? 'usuário não encontrado'} em ${dataHoraBR(m.nota_lancada_em)}`;
  const auxiliar = m.nota_processada_em ? `processada em ${dataHoraBR(m.nota_processada_em)}` : null;
  return comAuxiliar(texto, auxiliar, 'esquerda');
}

// Os grupos de entrada da ficha, cada um com as colunas do seu detalhe
const GRUPOS_DE_ENTRADA = [
  {
    id: 'nota',
    titulo: 'Notas fiscais de entrada',
    colunas: [['Data e hora', true], ['Empresa', true], ['Fornecedor', true], ['Nota', true],
      ['Quantidade no estoque'], ['Tipo', true], ['Nota registrada por', true]],
    linha: (m) => [
      td(dataHoraBR(m.quando), 'esquerda sem-quebra'),
      td(m.nome_empresa || `Empresa ${m.empresa}`, 'esquerda'),
      td(m.fornecedor || '—', 'esquerda'),
      td(m.documento ? String(m.documento) : '—', 'esquerda'),
      td(inteiro(m.entrada), 'coluna-final'),
      td(m.nome, 'esquerda'),
      quemLancou(m),
    ],
  },
  {
    id: 'transferencia',
    titulo: 'Transferências',
    colunas: [['Data e hora', true], ['Recebida em', true], ['Veio de', true], ['Nota de transferência', true],
      ['Quantidade no estoque']],
    linha: (m) => [
      td(dataHoraBR(m.quando), 'esquerda sem-quebra'),
      td(m.nome_empresa || `Empresa ${m.empresa}`, 'esquerda'),
      td(m.fornecedor || '—', 'esquerda'),
      td(m.documento ? String(m.documento) : '—', 'esquerda'),
      td(inteiro(m.entrada), 'coluna-final'),
    ],
  },
  {
    id: 'devolucao',
    titulo: 'Devoluções',
    colunas: [['Data e hora', true], ['Empresa', true], ['Cliente', true], ['Nota original', true],
      ['Nota de devolução', true], ['Quantidade no estoque'], ['Devolução lançada por', true]],
    linha: (m) => [
      td(dataHoraBR(m.quando), 'esquerda sem-quebra'),
      td(m.nome_empresa || `Empresa ${m.empresa}`, 'esquerda'),
      comAuxiliar(m.cliente || '—', m.nome, 'esquerda'),
      td(m.documento ? String(m.documento) : '—', 'esquerda'),
      td(m.devolucao_nota ? String(m.devolucao_nota) : '—', 'esquerda'),
      td(inteiro(m.entrada), 'coluna-final'),
      td(m.devolucao_lancada_por ? `${m.devolucao_lancada_por} em ${dataHoraBR(m.devolucao_lancada_em)}` : '—', 'esquerda'),
    ],
  },
  {
    id: 'cancelada',
    titulo: 'Notas de venda canceladas',
    colunas: [['Data e hora', true], ['Empresa', true], ['Cliente', true], ['Nota cancelada', true],
      ['Quantidade que voltou'], ['Motivo', true], ['Cancelada por', true]],
    linha: (m) => [
      td(dataHoraBR(m.quando), 'esquerda sem-quebra'),
      td(m.nome_empresa || `Empresa ${m.empresa}`, 'esquerda'),
      td(m.cliente || '—', 'esquerda'),
      td(m.documento ? String(m.documento) : '—', 'esquerda'),
      td(inteiro(m.entrada), 'coluna-final'),
      td(m.motivo_cancelamento || '—', 'esquerda'),
      td(m.cancelada_por ? `${m.cancelada_por} em ${dataHoraBR(m.cancelada_em)}` : '—', 'esquerda'),
    ],
  },
];

async function abrirFicha(codigo) {
  const dialogo = el('ficha');
  el('ficha-titulo').textContent = `Produto ${codigo}`;
  el('ficha-resumo').textContent = '';
  el('ficha-corpo').replaceChildren();
  mostrarStatus('Carregando os movimentos…', false, 'ficha-status');
  if (!dialogo.open) dialogo.showModal();
  try {
    const f = await buscar(`produtos/${codigo}`, filtrosAtuais());
    const saldo = f.estoque.reduce((t, e) => t + (Number(e.saldo) || 0), 0);
    el('ficha-titulo').textContent = f.produto.descricao;
    el('ficha-resumo').textContent = `código ${f.produto.produto} · saldo hoje ${inteiro(saldo)}`
      + ` · ${dataBR(el('inicio').value)} a ${dataBR(el('fim').value)}`;
    mostrarStatus(f.entradas.length >= 500 ? 'Mostrando as 500 entradas mais recentes do período.' : '',
      false, 'ficha-status');

    // Saldo por empresa
    const saldos = document.createElement('dl');
    saldos.className = 'numeros';
    for (const e of f.estoque) {
      const bloco = document.createElement('div');
      bloco.className = 'numero';
      const dd = document.createElement('dd');
      dd.append(Number(e.saldo) < 0 ? span(inteiro(e.saldo), 'negativo') : inteiro(e.saldo));
      bloco.append(Object.assign(document.createElement('dt'), { textContent: e.nome || `Empresa ${e.empresa}` }), dd);
      saldos.append(bloco);
    }

    // Entradas em cards: notas fiscais, transferências, devoluções e notas canceladas (só os que
    // tiverem movimento).
    // Clicar no card abre o detalhe embaixo.
    const detalhe = document.createElement('div');
    const cartoes = document.createElement('div');
    cartoes.className = 'cartoes';
    const grupos = GRUPOS_DE_ENTRADA
      .map((g) => ({ ...g, itens: f.entradas.filter((m) => m.grupo === g.id) }))
      .filter((g) => g.itens.length);
    let aberto = null;
    const mostrarGrupo = (g) => {
      aberto = aberto === g.id ? null : g.id;
      for (const botao of cartoes.children) {
        const ativo = botao.dataset.grupo === aberto;
        botao.classList.toggle('cartao--ativo', ativo);
        botao.setAttribute('aria-pressed', String(ativo));
      }
      detalhe.replaceChildren(...(aberto
        ? [Object.assign(document.createElement('h3'), { textContent: g.titulo }),
          tabelaSimples(g.colunas, g.itens.map(g.linha), '')]
        : []));
    };
    for (const g of grupos) {
      const quantidade = g.itens.reduce((t, m) => t + (Number(m.entrada) || 0), 0);
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'cartao';
      botao.dataset.grupo = g.id;
      botao.setAttribute('aria-pressed', 'false');
      botao.append(
        Object.assign(document.createElement('h3'), { textContent: g.titulo }),
        Object.assign(document.createElement('p'), { className: 'cartao-valor', textContent: inteiro(quantidade) }),
        Object.assign(document.createElement('p'), {
          className: 'cartao-nota',
          textContent: `${plural(g.itens.length, 'entrada', 'entradas')} · última em ${dataBR(g.itens[0].quando)}`,
        }),
      );
      botao.addEventListener('click', () => mostrarGrupo(g));
      cartoes.append(botao);
    }
    const semEntradas = Object.assign(document.createElement('p'), {
      className: 'explica',
      textContent: 'Nenhuma entrada no período.',
    });

    // Saídas: só o total, e os 3 clientes que mais compraram
    const saida = document.createElement('dl');
    saida.className = 'numeros';
    const blocoSaida = document.createElement('div');
    blocoSaida.className = 'numero';
    blocoSaida.append(
      Object.assign(document.createElement('dt'), { textContent: 'Saiu no período' }),
      Object.assign(document.createElement('dd'), { textContent: inteiro(f.saida) }),
    );
    saida.append(blocoSaida);
    const clientes = tabelaSimples(
      [['', true], ['Cliente', true], ['Quantidade comprada']],
      f.clientes.map((c, i) => [
        td(`${i + 1}º`, 'esquerda'),
        comAuxiliar(c.nome || `Cliente ${c.cliente}`, `código ${c.cliente}`, 'esquerda'),
        td(inteiro(c.quantidade), 'coluna-final'),
      ]),
      'Nenhuma venda com cliente identificado no período.',
    );

    el('ficha-corpo').replaceChildren(
      Object.assign(document.createElement('h3'), { textContent: 'Saldo hoje por empresa' }),
      saldos,
      Object.assign(document.createElement('h3'), { textContent: 'Entradas do período' }),
      Object.assign(document.createElement('p'), {
        className: 'explica',
        textContent: 'Clique num card para ver cada entrada, com data, hora, nota e quantidade.',
      }),
      grupos.length ? cartoes : semEntradas,
      detalhe,
      Object.assign(document.createElement('h3'), { textContent: 'Saídas do período' }),
      saida,
      Object.assign(document.createElement('h3'), { textContent: 'Clientes que mais compraram' }),
      Object.assign(document.createElement('p'), {
        className: 'explica',
        textContent: 'Os 3 que mais compraram este produto no período (vendas no caixa sem cliente identificado ficam de fora).',
      }),
      clientes,
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
    const url = new URL('/movimentos/produtos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries(filtrosAtuais())) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'entradas_e_saidas.xlsx';
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
    const informada = window.prompt('Informe a chave de acesso:');
    if (!informada) {
      mostrarStatus('É preciso entrar no painel para ver esta tela.', true);
      return;
    }
    chave.guardar(informada.trim());
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'movimentos');
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
