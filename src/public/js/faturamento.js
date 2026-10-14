// Faturamento: a análise do ciclo da venda, do orçamento ao pagamento,
// e as divergências entre as telas do PROCFIT.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (valor) => (valor ? `${dataBR(valor)} ${String(valor).slice(11, 16)}` : '—');
const compacto = (valor) => {
  const v = Number(valor) || 0;
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(2).replace('.', ',')} mi`;
  if (Math.abs(v) >= 1e4) return `R$ ${(v / 1e3).toFixed(1).replace('.', ',')} mil`;
  return dinheiro(v);
};
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

const ETAPAS = {
  ORCAMENTO: 'Orçamento',
  APROVACAO: 'Pendente de aprovação',
  PEDIDO: 'Pedido (sem checkout)',
  CHECKOUT: 'Checkout feito',
  FATURADO: 'Faturado (nota emitida)',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

// Devolução: não é etapa (o pedido pago continua "Pago"), é um fato a mais
const DEVOLUCAO = {
  TOTAL: 'devolvido (total)',
  PARCIAL: 'devolução parcial',
  SEM_VALOR: 'devolução sem valor encontrado',
};

// ===== Estado =====
let lista = [];
let resumo = {};
let filtroAtual = null;
let pedidoAberto = null;
let ordem = { coluna: 'dia', direcao: 'desc' };
// A lista mostra uma página de pedidos por vez, para a tela não virar uma rolagem sem fim
const POR_PAGINA = 25;
let pagina = 1;

// Quanto tempo esperar a API antes de desistir (em milissegundos)
const TEMPO_LIMITE_MS = 60000;

async function buscar(rota, parametros = {}) {
  const url = new URL(`/faturamento/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  // Tempo limite: se a API não responder, a tela avisa em vez de ficar carregando para sempre
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta;
  try {
    resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' }, signal: controle.signal });
  } catch (erro) {
    if (erro.name === 'AbortError') {
      throw new Error(`A API não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos (${rota}). `
        + 'Tente um período menor ou veja o terminal da API.');
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
  if (resposta.status === 403) throw new Error('Esta chave não tem acesso ao faturamento.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

const filtrosAtuais = () => ({
  inicio: el('inicio').value || null,
  fim: el('fim').value || null,
  busca: el('pesquisa-termo').value.trim() || null,
  vendedor: el('filtro-vendedor').value || null,
});

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
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

// Marca o botão de período que corresponde às datas escolhidas.
// Se as datas não baterem com nenhum atalho (datas livres ou guardadas de antes), nenhum fica marcado.
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
  estado.salvar('faturamento', { ...filtrosAtuais(), filtro: filtroAtual });
  mostrarStatus('Carregando os pedidos…');
  const inicioCarga = Date.now();
  try {
    const dados = await buscar('pedidos', { ...filtrosAtuais(), filtro: filtroAtual });
    lista = dados.lista;
    resumo = dados.resumo;
    pagina = 1; // dados novos (período, etapa ou busca): volta para a primeira página
    mostrarResumo();
    mostrarFunil();
    mostrarDivergencias();
    mostrarGrafico(dados.porDia);
    mostrarLista();
    el('painel').hidden = false;
    const segundos = ((Date.now() - inicioCarga) / 1000).toFixed(1).replace('.', ',');
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      + ` · carregou em ${segundos} s`);
    carregarVendedores();
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

async function carregarVendedores() {
  try {
    const vendedores = await buscar('pedidos/vendedores', filtrosAtuais());
    const escolhido = el('filtro-vendedor').value;
    el('filtro-vendedor').replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: 'Todos' }),
      ...vendedores.filter((v) => v.cod_vendedor != null).map((v) => Object.assign(document.createElement('option'), {
        value: String(v.cod_vendedor),
        textContent: `${v.vendedor ?? `Vendedor ${v.cod_vendedor}`} (${inteiro(v.pedidos)})`,
      })),
    );
    el('filtro-vendedor').value = escolhido;
  } catch {
    // o filtro de vendedor é um extra: se falhar, a tela segue funcionando
  }
}

// Nome de cada filtro (marcadores e título da lista)
const NOMES_FILTRO = {
  orcamento: 'Orçamentos', aprovacao: 'Pendentes de aprovação', pedido: 'Pedidos sem checkout',
  checkout: 'Com checkout', faturado: 'Faturados', pago: 'Pagos', cancelado: 'Cancelados',
  pago_com_titulo_aberto: 'Pago no caixa com título aberto', nota_sem_cobranca: 'Nota sem cobrança',
  cancelado_com_nota: 'Cancelado com nota', parado_sem_faturar: 'Parado sem faturar',
  devolvido: 'Com devolução',
};

// Clicar num filtro liga; clicar de novo no mesmo desliga
function alternarFiltro(id) {
  filtroAtual = filtroAtual === id ? null : id;
  pedidoAberto = null;
  carregar();
}

// 1. Total do período
function mostrarResumo() {
  el('total-pedidos').textContent = dinheiro(resumo.valor);
  const devolvido = Number(resumo.valor_devolvido) || 0;
  el('total-explica').textContent = `${plural(resumo.pedidos, 'pedido', 'pedidos')} no período`
    + (devolvido > 0.009 ? ` · ${dinheiro(Number(resumo.valor) - devolvido)} descontando as devoluções` : '');
}

// 1. O caminho do pedido: as etapas em ordem, numa linha só. Cancelado fica à parte, no fim.
function mostrarFunil() {
  const etapas = [
    { id: 'orcamento', nome: 'Orçamento', qtd: resumo.orcamentos, valor: resumo.valor_orcamentos },
    { id: 'aprovacao', nome: 'Aprovação', qtd: resumo.aprovacao, valor: resumo.valor_aprovacao },
    { id: 'pedido', nome: 'Pedido', dica: 'sem checkout', qtd: resumo.pedidos_abertos, valor: resumo.valor_pedidos_abertos },
    { id: 'checkout', nome: 'Checkout', dica: 'sem nota', qtd: resumo.checkouts, valor: resumo.valor_checkouts },
    { id: 'faturado', nome: 'Faturado', dica: 'sem pagamento', qtd: resumo.faturados, valor: resumo.valor_faturados },
    { id: 'pago', nome: 'Pago', qtd: resumo.pagos, valor: resumo.valor_pagos, final: true },
    { id: 'cancelado', nome: 'Cancelado', qtd: resumo.cancelados, valor: resumo.valor_cancelados, aParte: true },
  ];
  const total = Number(resumo.valor) || 0;
  el('funil').replaceChildren(...etapas.map((e) => {
    const item = document.createElement('li');
    item.className = `etapa${e.final ? ' etapa--final' : ''}${e.aParte ? ' etapa--a-parte' : ''}`
      + `${Number(e.qtd) ? '' : ' etapa--vazia'}`;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `etapa__botao${filtroAtual === e.id ? ' etapa__botao--ativa' : ''}`;
    botao.setAttribute('aria-pressed', String(filtroAtual === e.id));
    // Faixa no alto: o tamanho mostra quanto do valor do período está nesta etapa
    const faixa = span('', 'etapa__faixa');
    const parte = span('', 'etapa__parte');
    parte.style.width = `${total ? Math.min(100, ((Number(e.valor) || 0) / total) * 100) : 0}%`;
    faixa.append(parte);
    const nome = span(e.nome, 'etapa__nome');
    if (e.dica) nome.append(span(e.dica, 'etapa__dica'));
    botao.append(faixa, nome, span(dinheiro(e.valor), 'etapa__valor'),
      span(plural(e.qtd, 'pedido', 'pedidos'), 'etapa__qtd'));
    botao.addEventListener('click', () => alternarFiltro(e.id));
    item.append(botao);
    return item;
  }));
}

// 2. Precisa de atenção: só aparece o que tem pedido. Cada linha filtra a lista.
function mostrarDivergencias() {
  const devolvido = Number(resumo.valor_devolvido) || 0;
  const itens = [
    {
      id: 'pago_com_titulo_aberto',
      titulo: 'Pago no caixa, mas com título em aberto',
      explica: 'pode estar sendo cobrado duas vezes',
      qtd: resumo.div_pago_titulo,
      valor: resumo.valor_pago_titulo,
      alerta: true,
    },
    {
      id: 'nota_sem_cobranca',
      titulo: 'Nota emitida sem título e sem cupom',
      explica: 'saiu sem nenhuma cobrança',
      qtd: resumo.div_nota_sem_cobranca,
      valor: resumo.valor_nota_sem_cobranca,
      alerta: true,
    },
    {
      id: 'cancelado_com_nota',
      titulo: 'Cancelado, mas com nota ou título ativo',
      explica: 'o documento continua valendo',
      qtd: resumo.div_cancelado_com_nota,
      valor: resumo.valor_cancelado_com_nota,
      alerta: true,
    },
    {
      id: 'parado_sem_faturar',
      titulo: 'Processado há mais de 7 dias sem nota nem cupom',
      explica: 'pedido parado',
      qtd: resumo.div_parado,
      valor: resumo.valor_parado,
      alerta: true,
    },
    {
      id: 'devolvido',
      titulo: 'Pedidos com devolução',
      explica: Number(resumo.devolvidos_total)
        ? `${plural(resumo.devolvidos_total, 'devolvido por inteiro', 'devolvidos por inteiro')}`
        : (devolvido > 0.009 ? 'devolução de parte dos produtos' : 'valor da devolução não encontrado'),
      qtd: resumo.devolvidos,
      valor: devolvido,
    },
  ].filter((d) => Number(d.qtd) > 0);

  const area = el('divergencias');
  if (!itens.length) {
    area.replaceChildren(span('Nenhuma divergência no período. Tudo certo entre as telas.', 'atencao__vazio'));
    return;
  }
  area.replaceChildren(...itens.map((d) => {
    const ativo = filtroAtual === d.id;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `atencao__linha${d.alerta ? ' atencao__linha--alerta' : ''}${ativo ? ' atencao__linha--ativa' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const texto = span(d.titulo, 'atencao__titulo');
    texto.append(span(d.explica, 'atencao__explica'));
    botao.append(
      span('', 'atencao__marca'),
      texto,
      span(plural(d.qtd, 'pedido', 'pedidos'), 'atencao__qtd'),
      span(dinheiro(d.valor), 'atencao__valor'),
      span(ativo ? 'Mostrar todos' : 'Ver pedidos →', 'atencao__ver'),
    );
    botao.addEventListener('click', () => alternarFiltro(d.id));
    return botao;
  }));
}

function mostrarGrafico(porDia) {
  graficos.colunas(el('grafico-dias'), {
    titulo: 'Pedidos por dia',
    rotulos: porDia.map((p) => `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`),
    series: [
      { nome: 'Valor dos pedidos', valores: porDia.map((p) => p.valor), cor: 'var(--verde-claro)' },
      { nome: 'Já pago', valores: porDia.map((p) => p.pago), cor: 'var(--verde)' },
    ],
    vazio: 'Nenhum pedido no período.',
  });
}

// ===== Lista =====
function mostrarMarcadores() {
  const itens = [];
  if (filtroAtual) {
    itens.push({ texto: NOMES_FILTRO[filtroAtual] ?? filtroAtual, remover: () => { filtroAtual = null; } });
  }
  const termo = el('pesquisa-termo').value.trim();
  if (termo) {
    itens.push({
      texto: `Pesquisa: ${termo}`,
      remover: () => { el('pesquisa-termo').value = ''; el('limpar-pesquisa').hidden = true; },
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

function mostrarLista() {
  mostrarMarcadores();
  const fator = ordem.direcao === 'asc' ? 1 : -1;
  const itens = [...lista].sort((a, b) => {
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  el('titulo-lista').textContent = filtroAtual
    ? `Pedidos · ${NOMES_FILTRO[filtroAtual] ?? filtroAtual} (${inteiro(itens.length)})`
    : `Pedidos (${inteiro(itens.length)})`;

  const tabela = el('tabela-pedidos');
  const cab = document.createElement('tr');
  for (const [texto, campo, esquerda] of [['Pedido', 'pedido', true], ['Data', 'dia', true],
    ['Cliente', 'cliente', true], ['Vendedor', 'vendedor', true], ['Etapa', 'etapa', true],
    ['Documentos', null, true], ['Valor', 'valor'], ['Em aberto', 'pendente'], ['', null, true]]) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (esquerda) th.className = 'esquerda';
    if (!campo) {
      th.textContent = texto;
    } else {
      const ativa = ordem.coluna === campo;
      const crescente = ordem.direcao === 'asc';
      if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
      const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
      seta.setAttribute('aria-hidden', 'true');
      botao.append(texto, seta);
      botao.addEventListener('click', (evento) => {
        evento.stopPropagation();
        ordem = { coluna: campo, direcao: ativa && crescente ? 'desc' : 'asc' };
        pagina = 1;
        mostrarLista();
      });
      th.append(botao);
    }
    cab.append(th);
  }
  tabela.tHead.replaceChildren(cab);

  const linhas = [];
  if (!itens.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum pedido com esses filtros.', 'vazio');
    vazio.colSpan = 9;
    linha.append(vazio);
    linhas.push(linha);
  }
  const paginas = Math.max(1, Math.ceil(itens.length / POR_PAGINA));
  pagina = Math.min(Math.max(1, pagina), paginas);
  const primeiro = (pagina - 1) * POR_PAGINA;
  for (const p of itens.slice(primeiro, primeiro + POR_PAGINA)) {
    const aberto = pedidoAberto === p.pedido;
    const linha = document.createElement('tr');
    linha.className = `linha-dia${aberto ? ' linha-dia--aberta' : ''}`;
    const alertas = [
      p.pago_com_titulo_aberto ? 'pago com título aberto' : null,
      p.nota_sem_cobranca ? 'nota sem cobrança' : null,
      p.cancelado_com_nota ? 'cancelado com nota' : null,
      p.parado_sem_faturar ? 'parado sem faturar' : null,
      p.devolucao ? `${DEVOLUCAO[p.devolucao] ?? 'devolução'}${p.devolucao === 'PARCIAL' ? ` ${dinheiro(p.devolvido)}` : ''}` : null,
    ].filter(Boolean);
    const documentos = [
      p.nota ? `NF ${p.nota}` : null,
      p.cupom ? `cupom ${p.cupom}` : null,
      Number(p.titulos) ? `${inteiro(p.titulos)} título(s)` : null,
    ].filter(Boolean).join(' · ');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-expandir';
    botao.setAttribute('aria-expanded', String(aberto));
    botao.setAttribute('aria-label', aberto ? 'Fechar o pedido' : 'Ver a linha do tempo do pedido');
    botao.textContent = aberto ? '▾' : '▸';
    linha.append(
      td(pedidoJanela.link(p.pedido), 'esquerda sem-quebra'),
      comAuxiliar(dataBR(p.dia), p.status, 'esquerda sem-quebra'),
      comAuxiliar(p.cliente ?? `Cliente ${p.cod_cliente}`, `código ${p.cod_cliente}`, 'esquerda'),
      td(p.vendedor ?? '—', 'esquerda'),
      comAuxiliar(ETAPAS[p.etapa] ?? p.etapa, alertas.join(' · ') || null, 'esquerda',
        alertas.length ? 'qtd negativo' : 'qtd'),
      td(documentos || 'nenhum', 'esquerda'),
      td(dinheiro(p.valor), 'coluna-final'),
      td(Number(p.pendente) > 0.009 ? dinheiro(p.pendente) : '—', Number(p.pendente) > 0.009 ? 'negativo' : null),
      td(botao, 'esquerda'),
    );
    const alternar = async () => {
      pedidoAberto = aberto ? null : p.pedido;
      mostrarLista();
      if (!aberto) await abrirLinhaDoTempo(p.pedido);
    };
    botao.addEventListener('click', (evento) => { evento.stopPropagation(); alternar(); });
    linha.addEventListener('click', alternar);
    linhas.push(linha);
    if (aberto) {
      const detalhe = document.createElement('tr');
      detalhe.className = 'linha-itens';
      detalhe.id = `pedido-detalhe-${p.pedido}`;
      const celula = document.createElement('td');
      celula.colSpan = 9;
      celula.append(span('Carregando a linha do tempo…', 'explica'));
      detalhe.append(celula);
      linhas.push(detalhe);
    }
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const soma = (campo) => itens.reduce((t, p) => t + (Number(p[campo]) || 0), 0);
  const rodape = document.createElement('tr');
  // O total soma a lista inteira, não só a página que está na tela
  const rotulo = td(`Total (${plural(itens.length, 'pedido', 'pedidos')})`, 'esquerda');
  rotulo.colSpan = 6;
  rodape.append(rotulo, td(dinheiro(soma('valor'))), td(dinheiro(soma('pendente'))), td(''));
  tabela.tFoot.replaceChildren(rodape);

  // Navegação entre páginas (some quando tudo cabe numa página só)
  el('paginacao-pedidos').hidden = paginas <= 1;
  el('pagina-pedidos').textContent = itens.length
    ? `Pedidos ${inteiro(primeiro + 1)} a ${inteiro(Math.min(primeiro + POR_PAGINA, itens.length))}`
      + ` de ${inteiro(itens.length)} · página ${pagina} de ${paginas}`
    : '';
  el('pedidos-anterior').disabled = pagina <= 1;
  el('pedidos-proxima').disabled = pagina >= paginas;
}

// Troca de página e volta a tela para o começo da lista
function irParaPagina(nova) {
  pagina = nova;
  pedidoAberto = null;
  mostrarLista();
  el('titulo-lista').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Linha do tempo de um pedido: cada passo com data, valor e quem fez
async function abrirLinhaDoTempo(numero) {
  const linha = el(`pedido-detalhe-${numero}`);
  if (!linha) return;
  try {
    const { pedido: p, titulos, devolucoes = [] } = await buscar(`pedidos/${numero}`);
    const partes = [];

    const passos = [
      { quando: p.criado_em, o_que: 'Pedido criado', quem: p.usuario_nome, detalhe: p.vendedor ? `vendedor ${p.vendedor}` : null },
      p.processado_em ? { quando: p.processado_em, o_que: 'Pedido processado', quem: null, detalhe: p.status } : null,
      p.checkout_em ? { quando: p.checkout_em, o_que: 'Checkout', quem: p.usuario_checkout, detalhe: `checkout ${p.checkout}` } : null,
      p.nota ? { quando: p.nota_dia, o_que: 'Nota fiscal emitida', quem: null, detalhe: `NF ${p.nota}` } : null,
      p.cupom ? { quando: p.cupom_dia, o_que: 'Pago no caixa', quem: null, detalhe: `cupom ${p.cupom}${p.caixa ? ` · caixa ${p.caixa}` : ''}` } : null,
      Number(p.titulos) ? { quando: null, o_que: 'Títulos gerados', quem: null, detalhe: `${inteiro(p.titulos)} título(s) · ${dinheiro(p.valor_titulos)}` } : null,
      Number(p.recebido) > 0.009 ? { quando: null, o_que: 'Recebido', quem: null, detalhe: dinheiro(p.recebido) } : null,
      p.cancelado_em ? { quando: p.cancelado_em, o_que: 'Pedido cancelado', quem: null, detalhe: `cancelamento ${p.cancelamento}` } : null,
      ...devolucoes.map((d) => ({
        quando: d.dia,
        o_que: d.tipo === 'caixa' ? 'Devolução no caixa' : 'Devolução por nota',
        quem: d.usuario_nome,
        detalhe: `${d.tipo === 'caixa' ? `devolução ${d.documento}` : `NF de devolução ${d.documento ?? '—'}`}`
          + ` · ${d.valor === null ? 'valor não encontrado' : dinheiro(d.valor)}`,
      })),
    ].filter(Boolean);

    const tabela = document.createElement('table');
    tabela.className = 'tabela tabela--itens';
    const cab = document.createElement('tr');
    for (const texto of ['Quando', 'O que aconteceu', 'Quem', 'Detalhe']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'esquerda';
      th.textContent = texto;
      cab.append(th);
    }
    tabela.createTHead().append(cab);
    const corpo = tabela.createTBody();
    for (const passo of passos) {
      const tr = document.createElement('tr');
      tr.append(
        td(passo.quando ? (String(passo.quando).length > 10 ? dataHoraBR(passo.quando) : dataBR(passo.quando)) : '—',
          'esquerda sem-quebra'),
        td(passo.o_que, 'esquerda'),
        td(passo.quem ?? '—', 'esquerda'),
        td(passo.detalhe ?? '—', 'esquerda'),
      );
      corpo.append(tr);
    }
    partes.push(tabela);

    if (titulos.length) {
      const titulo = document.createElement('h4');
      titulo.className = 'caixa-subtitulo';
      titulo.textContent = `Títulos do pedido (${plural(titulos.length, 'título', 'títulos')})`;
      partes.push(titulo);
      const tabelaTitulos = document.createElement('table');
      tabelaTitulos.className = 'tabela tabela--itens';
      const cabT = document.createElement('tr');
      for (const [texto, esquerda] of [['Título', true], ['Vencimento', true], ['Valor'], ['Recebido'],
        ['Em aberto'], ['Último recebimento', true]]) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = texto;
        if (esquerda) th.className = 'esquerda';
        cabT.append(th);
      }
      tabelaTitulos.createTHead().append(cabT);
      const corpoT = tabelaTitulos.createTBody();
      for (const t of titulos) {
        const tr = document.createElement('tr');
        const pendente = Number(t.pendente) || 0;
        tr.append(
          td(t.titulo, 'esquerda sem-quebra'),
          td(dataBR(t.vencimento), 'esquerda sem-quebra'),
          td(dinheiro(t.valor)),
          td(dinheiro(t.recebido)),
          td(pendente > 0.009 ? dinheiro(pendente) : '—', pendente > 0.009 ? 'negativo' : null),
          td(t.ultimo_recebimento ? dataBR(t.ultimo_recebimento) : 'sem baixa', 'esquerda'),
        );
        corpoT.append(tr);
      }
      partes.push(tabelaTitulos);
    }

    linha.firstChild.replaceChildren(...partes);
  } catch (erro) {
    linha.firstChild.replaceChildren(span(erro.message, 'status--erro'));
  }
}

// ===== Excel =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/faturamento/pedidos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({ ...filtrosAtuais(), filtro: filtroAtual })) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'pedidos.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    mostrarStatus(`Excel: ${erro.message}`, true);
    el('status').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    botao.disabled = false;
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    const informada = window.prompt('Informe a chave de acesso do faturamento:');
    if (!informada) {
      mostrarStatus('É preciso informar a chave de acesso para ver esta tela.', true);
      return;
    }
    chave.guardar(informada.trim());
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'faturamento');
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
  // Volta como estava antes de sair da tela
  const guardado = estado.aplicarCampos('faturamento', {
    inicio: 'inicio', fim: 'fim', busca: 'pesquisa-termo', vendedor: 'filtro-vendedor',
  });
  if (guardado.filtro) filtroAtual = guardado.filtro;
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
  // Mudou a data na mão: o atalho acompanha (desmarca, ou marca o que bater)
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
  el('filtro-vendedor').addEventListener('change', () => carregar());
  el('baixar-excel').addEventListener('click', baixarExcel);
  el('baixar-excel-lista').addEventListener('click', baixarExcel);
  el('pedidos-anterior').addEventListener('click', () => irParaPagina(pagina - 1));
  el('pedidos-proxima').addEventListener('click', () => irParaPagina(pagina + 1));

  carregar();
});
