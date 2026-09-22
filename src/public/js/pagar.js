// Contas a pagar (parte do financeiro). Mesma chave de acesso do financeiro.
// Sem chave, volta para a página do financeiro, que pede a chave.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
// R$ 7,52 mi / R$ 950,3 mil / R$ 441,20: cabe ao lado do número grande
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
  apagar: () => sessionStorage.removeItem('apiKey'),
};

const CARTOES = [
  { id: 'aberto', titulo: 'Em aberto', valor: 'aberto', qtd: 'aberto_titulos' },
  { id: 'vencidos', titulo: 'Vencidos', valor: 'vencido', qtd: 'vencido_titulos', alerta: true },
  { id: '7dias', titulo: 'Vencem em 7 dias', valor: 'proximos_7', qtd: 'proximos_7_titulos' },
  { id: '30dias', titulo: 'Vencem em 30 dias', valor: 'proximos_30', qtd: 'proximos_30_titulos' },
  { id: 'pago', titulo: 'Pagos', valor: 'pago', qtd: 'pago_titulos' },
];
const SITUACAO = {
  ABERTO: { texto: 'Em aberto', classe: 'situacao--cancelada' },
  PARCIAL: { texto: 'Pago em parte', classe: 'situacao--devolucao' },
  PAGO: { texto: 'Pago', classe: 'situacao--faturada' },
  CANCELADO: { texto: 'Cancelado', classe: 'situacao--cancelada' },
};

// ===== Estado =====
let cartaoAtual = 'aberto';
let abrirLista = false; // abre a lista de títulos depois de clicar num cartão ou fornecedor
let pagamentosLista = [];
let pessoasCaixa = []; // todas as pessoas que cuidam de caixa (cartão sempre visível)
let pessoaAtual = null; // código do usuário, ou 'sem' para não identificado
let titulos = [];
let ordem = { coluna: 'vencimento', direcao: 'asc' };

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
    situacao: cartaoAtual,
  };
}

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

// ===== Períodos prontos =====
function periodoPronto(nome) {
  const hoje = new Date();
  const segunda = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - ((hoje.getDay() + 6) % 7));
  const periodos = {
    tudo: [null, null],
    semana: [segunda, new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6)],
    mes: [new Date(hoje.getFullYear(), hoje.getMonth(), 1), new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)],
    'proximo-mes': [new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1), new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0)],
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
  mostrarStatus('Carregando o contas a pagar…');
  try {
    const dados = await buscar('pagar', filtrosAtuais());
    titulos = dados.titulos;
    mostrarResumo(dados.resumo);
    mostrarCartoes(dados.resumo);
    mostrarAging(dados.resumo);
    mostrarBaixas(dados.baixas);
    mostrarCategorias(dados.categorias);
    mostrarLongoPrazo(dados.longo_prazo);
    mostrarPrevisao(dados.previsao);
    mostrarFornecedores(dados.fornecedores);
    mostrarMarcadores();
    mostrarLista(dados.limite);
    if (abrirLista) {
      abrirLista = false;
      el('lista-titulos').open = true;
      el('lista-titulos').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    carregarPagamentos();
    el('painel').hidden = false;
    const cartao = CARTOES.find((c) => c.id === cartaoAtual);
    mostrarStatus(`${cartao.titulo} · atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarResumo(r) {
  el('total-aberto').textContent = dinheiro(r.aberto);
  el('total-explica').textContent =
    `${plural(r.aberto_titulos, 'título', 'títulos')} em aberto · ${plural(r.fornecedores, 'fornecedor', 'fornecedores')}`;
  // Indicadores ao lado do número grande: valor resumido (o exato está nos cartões logo abaixo)
  el('ind-vencido').replaceChildren(compacto(r.vencido), span(plural(r.vencido_titulos, 'título', 'títulos')));
  el('ind-7').replaceChildren(compacto(r.proximos_7), span(plural(r.proximos_7_titulos, 'título', 'títulos')));
  el('ind-30').replaceChildren(compacto(r.proximos_30), span(plural(r.proximos_30_titulos, 'título', 'títulos')));
  el('ind-fornecedores').replaceChildren(inteiro(r.fornecedores), span('com valor em aberto'));
  el('ind-vencido').classList.toggle('negativo', Number(r.vencido) > 0.01);
}

function mostrarCartoes(r) {
  el('cartoes').replaceChildren(...CARTOES.map((c) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `cartao${cartaoAtual === c.id ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(cartaoAtual === c.id));
    const titulo = document.createElement('h3');
    titulo.textContent = c.titulo;
    const valor = document.createElement('p');
    valor.className = `cartao-valor${c.alerta && Number(r[c.valor]) > 0.01 ? ' negativo' : ''}`;
    valor.textContent = dinheiro(r[c.valor]);
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = plural(r[c.qtd], 'título', 'títulos');
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      cartaoAtual = c.id;
      abrirLista = true; // quem clica num cartão quer ver os títulos
      carregar();
    });
    return botao;
  }));
}

// Barras horizontais (mesmo componente do contas a receber)
function barra({ rotulo, valor, nota, maximo, classe, aoClicar }) {
  const linha = document.createElement(aoClicar ? 'button' : 'div');
  linha.className = `barra${classe ? ` ${classe}` : ''}`;
  if (aoClicar) {
    linha.type = 'button';
    linha.addEventListener('click', aoClicar);
  }
  const trilho = span('', 'barra-trilho');
  const preenchida = span('', 'barra-preenchida');
  preenchida.style.width = `${maximo ? Math.max(2, (Number(valor) / maximo) * 100) : 0}%`;
  trilho.append(preenchida);
  const valorTexto = span(dinheiro(valor), 'barra-valor');
  if (nota) valorTexto.append(Object.assign(document.createElement('small'), { textContent: nota }));
  linha.append(span(rotulo, 'barra-rotulo'), trilho, valorTexto);
  return linha;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (aaaaMm) => {
  const [ano, mes] = aaaaMm.split('-').map(Number);
  return `${MESES[mes - 1]}/${ano}`;
};
const milhoes = (valor) => (Math.abs(valor) >= 1e6
  ? `R$ ${(valor / 1e6).toFixed(1).replace('.', ',')} mi`
  : dinheiro(valor));
// Abaixo disso, o mês é tratado como "baixas atrasadas"
const BAIXA_MINIMA = 0.8;

function mostrarAging(r) {
  const faixas = [
    { rotulo: '1 a 30 dias', valor: r.atraso_1_30, qtd: r.atraso_1_30_titulos },
    { rotulo: '31 a 60 dias', valor: r.atraso_31_60, qtd: r.atraso_31_60_titulos },
    { rotulo: '61 a 90 dias', valor: r.atraso_61_90, qtd: r.atraso_61_90_titulos },
    { rotulo: 'Mais de 90 dias', valor: r.atraso_90, qtd: r.atraso_90_titulos },
  ];
  const maximo = Math.max(...faixas.map((f) => Number(f.valor) || 0));
  el('barras-aging').replaceChildren(...faixas.map((f) => barra({
    rotulo: f.rotulo, valor: f.valor, nota: plural(f.qtd, 'título', 'títulos'), maximo, classe: 'barra--atraso',
  })));
}

// Do que já venceu no mês, quanto foi baixado. Mês ruim = baixa atrasada no PROCFIT.
function mostrarBaixas(lista) {
  const meses = lista
    .map((m) => {
      const venceu = Number(m.ja_venceu) || 0;
      const semBaixa = Number(m.vencido_sem_baixa) || 0;
      return { ...m, venceu, semBaixa, pct: venceu > 0 ? 1 - semBaixa / venceu : null };
    })
    .filter((m) => m.venceu > 0);

  el('barras-baixas').replaceChildren(...(meses.length ? meses.map((m) => {
    const linha = document.createElement('div');
    const ruim = m.pct !== null && m.pct < BAIXA_MINIMA;
    linha.className = `barra${ruim ? ' barra--atraso' : ' barra--previsao'}`;
    const trilho = span('', 'barra-trilho');
    const preenchida = span('', 'barra-preenchida');
    preenchida.style.width = `${Math.max(2, (m.pct ?? 0) * 100)}%`;
    trilho.append(preenchida);
    const valor = span(`${Math.round((m.pct ?? 0) * 100)}% baixado`, 'barra-valor');
    valor.append(Object.assign(document.createElement('small'), {
      textContent: m.semBaixa > 0.01 ? `${milhoes(m.semBaixa)} vencidos sem baixa` : 'tudo baixado',
    }));
    linha.append(span(nomeMes(m.mes), 'barra-rotulo'), trilho, valor);
    return linha;
  }) : [span('Nenhum vencimento nos últimos meses.', 'explica')]));

  // Aviso no topo quando algum mês está com poucas baixas
  const ruins = meses.filter((m) => m.pct !== null && m.pct < BAIXA_MINIMA);
  const aviso = el('aviso-baixas');
  if (ruins.length) {
    const total = ruins.reduce((t, m) => t + m.semBaixa, 0);
    aviso.textContent = `Atenção: as baixas de ${ruins.map((m) => nomeMes(m.mes)).join(', ')} estão atrasadas `
      + `(${milhoes(total)} vencidos sem baixa). Se esses pagamentos já foram feitos no banco, o vencido abaixo `
      + 'está maior do que a realidade: é preciso lançar as baixas no PROCFIT.';
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }
}

// Categoria de RECEITA usada em conta a pagar (achado de set/2026: provável categoria padrão errada)
const CATEGORIAS_SUSPEITAS = [1];

function mostrarCategorias(lista) {
  const grupos = new Map();
  for (const c of lista) {
    const g = grupos.get(c.grupo) ?? { grupo: c.grupo, lancado: 0, aberto: 0 };
    g.lancado += Number(c.lancado) || 0;
    g.aberto += Number(c.aberto) || 0;
    grupos.set(c.grupo, g);
  }
  const listaGrupos = [...grupos.values()].sort((a, b) => b.lancado - a.lancado);
  const maxGrupo = Math.max(0, ...listaGrupos.map((g) => g.lancado));
  el('barras-grupos').replaceChildren(...(listaGrupos.length ? listaGrupos.map((g) => barra({
    rotulo: g.grupo, valor: g.lancado, nota: `em aberto ${dinheiro(g.aberto)}`, maximo: maxGrupo,
  })) : [span('Nenhum título no período.', 'explica')]));

  const maiores = lista.slice(0, 12);
  const maxCategoria = Math.max(0, ...maiores.map((c) => Number(c.lancado) || 0));
  el('barras-categorias').replaceChildren(...(maiores.length ? maiores.map((c) => barra({
    rotulo: c.categoria, valor: c.lancado,
    nota: `${plural(c.titulos, 'título', 'títulos')} · em aberto ${dinheiro(c.aberto)}`,
    maximo: maxCategoria,
    classe: CATEGORIAS_SUSPEITAS.includes(Number(c.categoria_id)) ? 'barra--atraso' : null,
  })) : [span('Nenhum título no período.', 'explica')]));

  const suspeitas = lista.filter((c) => CATEGORIAS_SUSPEITAS.includes(Number(c.categoria_id)));
  const aviso = el('aviso-categoria');
  if (suspeitas.length) {
    const total = suspeitas.reduce((t, c) => t + (Number(c.lancado) || 0), 0);
    const totalGeral = lista.reduce((t, c) => t + (Number(c.lancado) || 0), 0);
    aviso.textContent = `A categoria "${suspeitas[0].categoria}" é de receita, mas aparece em contas a pagar: `
      + `${milhoes(total)} (${Math.round((total / (totalGeral || 1)) * 100)}% do período). Provavelmente é a categoria `
      + 'padrão dos títulos automáticos: o certo seria compra de mercadorias ou de insumos. Enquanto não for '
      + 'corrigida no PROCFIT, os grupos acima ficam distorcidos.';
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }
}

function mostrarLongoPrazo({ anos, credores }) {
  const total = anos.reduce((t, a) => t + (Number(a.pendente) || 0), 0);
  const titulosTotal = anos.reduce((t, a) => t + (Number(a.titulos) || 0), 0);
  el('longo-resumo').textContent = total > 0.01
    ? `${milhoes(total)} em ${plural(titulosTotal, 'parcela', 'parcelas')} com vencimento daqui a mais de 12 meses `
      + `(até ${anos.length ? anos[anos.length - 1].ano : '—'}). São compromissos como empréstimos e financiamentos.`
    : 'Nenhum compromisso com vencimento daqui a mais de 12 meses.';
  const maxAno = Math.max(0, ...anos.map((a) => Number(a.pendente) || 0));
  el('barras-longo').replaceChildren(...anos.map((a) => barra({
    rotulo: String(a.ano), valor: a.pendente, nota: plural(a.titulos, 'parcela', 'parcelas'), maximo: maxAno,
    classe: 'barra--previsao',
  })));
  const maxCredor = Math.max(0, ...credores.map((c) => Number(c.pendente) || 0));
  el('barras-credores').replaceChildren(...credores.map((c) => barra({
    rotulo: c.fornecedor ?? `Fornecedor ${c.cod_fornecedor}`, valor: c.pendente,
    nota: `${plural(c.titulos, 'parcela', 'parcelas')} · até ${dataBR(c.ultimo_vencimento)}`, maximo: maxCredor,
  })));
}

function mostrarPrevisao(lista) {
  const area = el('barras-previsao');
  if (!lista.length) {
    area.replaceChildren(span('Nada em aberto nas próximas semanas.', 'explica'));
    return;
  }
  const maximo = Math.max(...lista.map((p) => Number(p.pendente) || 0));
  area.replaceChildren(...lista.map((p) => barra({
    rotulo: p.semana === 'VENCIDO' ? 'Já vencidos' : `semana de ${dataBR(p.semana)}`,
    valor: p.pendente,
    nota: plural(p.titulos, 'título', 'títulos'),
    maximo,
    classe: p.semana === 'VENCIDO' ? 'barra--atraso' : 'barra--previsao',
  })));
}

function mostrarFornecedores(lista) {
  const area = el('barras-fornecedores');
  if (!lista.length) {
    area.replaceChildren(span('Nenhum fornecedor com valor em aberto.', 'explica'));
    return;
  }
  const maximo = Math.max(...lista.map((f) => Number(f.pendente) || 0));
  area.replaceChildren(...lista.map((f) => barra({
    rotulo: f.fornecedor ?? `Fornecedor ${f.cod_fornecedor}`,
    valor: f.pendente,
    nota: `${plural(f.titulos, 'título', 'títulos')}${Number(f.vencido) > 0.01 ? ` · vencido ${dinheiro(f.vencido)}` : ''}`,
    maximo,
    aoClicar: () => {
      el('pesquisa-termo').value = String(f.cod_fornecedor);
      el('limpar-pesquisa').hidden = false;
      abrirLista = true;
      carregar();
    },
  })));
}

function mostrarMarcadores() {
  const area = el('marcadores');
  const termo = el('pesquisa-termo').value.trim();
  const itens = [];
  if (termo) itens.push({ texto: `Pesquisa: ${termo}`, remover: () => { el('pesquisa-termo').value = ''; el('limpar-pesquisa').hidden = true; } });
  if (cartaoAtual !== 'aberto') {
    itens.push({ texto: CARTOES.find((c) => c.id === cartaoAtual).titulo, remover: () => { cartaoAtual = 'aberto'; } });
  }
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

// ===== Lista de títulos (ordenável clicando no nome da coluna) =====
const COLUNAS = [
  { titulo: 'Vencimento', chave: 'vencimento', esquerda: true },
  { titulo: 'Título', chave: 'titulo', esquerda: true },
  { titulo: 'Fornecedor', chave: 'fornecedor', esquerda: true },
  { titulo: 'Forma', chave: 'forma', esquerda: true },
  { titulo: 'Valor', chave: 'valor' },
  { titulo: 'Pago', chave: 'pago' },
  { titulo: 'Pendente', chave: 'pendente' },
  { titulo: 'Situação', chave: 'situacao', esquerda: true },
];

function ordenados() {
  const { coluna, direcao } = ordem;
  const fator = direcao === 'asc' ? 1 : -1;
  return [...titulos].sort((a, b) => {
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
    const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
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

function prazo(t) {
  const dias = Number(t.dias_atraso);
  if (t.situacao === 'PAGO' || t.situacao === 'CANCELADO') {
    return t.ultimo_pagamento ? { texto: `pago em ${dataBR(t.ultimo_pagamento)}` } : null;
  }
  if (dias > 0) return { texto: plural(dias, 'dia de atraso', 'dias de atraso'), alerta: true };
  if (dias === 0) return { texto: 'vence hoje', alerta: true };
  return { texto: `vence em ${plural(-dias, 'dia', 'dias')}` };
}

function mostrarLista(limite) {
  const tabela = el('tabela-pagar');
  tabela.tHead.replaceChildren(cabecalho());
  el('titulo-lista').textContent =
    `Ver a lista de títulos · ${CARTOES.find((c) => c.id === cartaoAtual).titulo} (${inteiro(titulos.length)})`;

  const corpo = tabela.tBodies[0];
  if (titulos.length === 0) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum título encontrado com esses filtros.', 'vazio');
    vazio.colSpan = COLUNAS.length;
    linha.append(vazio);
    corpo.replaceChildren(linha);
  } else {
    corpo.replaceChildren(...ordenados().map((t) => {
      const linha = document.createElement('tr');
      const info = prazo(t);
      if (info?.alerta && Number(t.dias_atraso) > 0) linha.className = 'linha-vencida';
      const etiqueta = span(SITUACAO[t.situacao]?.texto ?? t.situacao, `situacao ${SITUACAO[t.situacao]?.classe ?? ''}`);
      linha.append(
        comAuxiliar(dataBR(t.vencimento), info?.texto, 'esquerda sem-quebra', info?.alerta ? 'qtd negativo' : 'qtd'),
        td(t.titulo ?? '—', 'esquerda sem-quebra'),
        comAuxiliar(t.fornecedor ?? `Fornecedor ${t.cod_fornecedor}`, `código ${t.cod_fornecedor}`, 'esquerda'),
        td(t.forma ?? '—', 'esquerda'),
        td(dinheiro(t.valor)),
        td(Number(t.pago) > 0.009 ? dinheiro(t.pago) : '—'),
        td(dinheiro(t.pendente), Number(t.pendente) > 0.009 ? 'coluna-final' : null),
        td(etiqueta, 'esquerda'),
      );
      return linha;
    }));
  }

  const soma = (campo) => titulos.reduce((total, t) => total + (Number(t[campo]) || 0), 0);
  const rotulo = td(`Total (${plural(titulos.length, 'título', 'títulos')})`, 'esquerda');
  rotulo.colSpan = 4;
  const rodape = document.createElement('tr');
  rodape.append(rotulo, td(dinheiro(soma('valor'))), td(dinheiro(soma('pago'))), td(dinheiro(soma('pendente'))), td(''));
  tabela.tFoot.replaceChildren(rodape);

  if (limite && titulos.length >= limite) {
    mostrarStatus(`Mostrando os primeiros ${inteiro(limite)} títulos. Use a pesquisa ou o período para ver os demais.`);
  }
}

// ===== Pagamentos por pessoa =====
async function carregarPagamentos() {
  try {
    const dados = await buscar('pagar/pagamentos', {
      inicio: el('pag-inicio').value || null,
      fim: el('pag-fim').value || null,
      busca: el('pesquisa-termo').value.trim() || null,
    });
    // Mostra nos campos o período que a API usou (ex.: últimos 30 dias quando vazio)
    el('pag-inicio').value = dados.inicio;
    el('pag-fim').value = dados.fim;
    pagamentosLista = dados.pagamentos;
    pessoasCaixa = dados.pessoas ?? [];
    mostrarPessoas();
  } catch (erro) {
    el('cartoes-pessoas').replaceChildren(span(`Não foi possível carregar os pagamentos: ${erro.message}`, 'status--erro'));
  }
}

const chavePessoa = (p) => (p.usuario == null ? 'sem' : String(p.usuario));

function mostrarPessoas() {
  // Agrupa por pessoa: total, quantidade, por canal e atraso médio de lançamento (ponderado pelo valor)
  const pessoas = new Map();
  for (const p of pagamentosLista) {
    const k = chavePessoa(p);
    const g = pessoas.get(k) ?? {
      chave: k, nome: p.usuario_nome ?? (p.usuario == null ? 'Não identificado' : `Usuário ${p.usuario}`),
      total: 0, qtd: 0, caixa: 0, banco: 0, somaDias: 0, ultimo: null,
    };
    const valor = Number(p.valor) || 0;
    g.total += valor;
    g.qtd += 1;
    if (p.canal === 'Caixa') g.caixa += valor;
    if (p.canal === 'Banco') g.banco += valor;
    if (p.dias_para_lancar != null) g.somaDias += valor * Math.max(0, Number(p.dias_para_lancar));
    if (p.lancado_em && (!g.ultimo || p.lancado_em > g.ultimo)) g.ultimo = p.lancado_em;
    pessoas.set(k, g);
  }
  // Toda pessoa que cuida de caixa aparece, mesmo sem pagamento no período (fica com R$ 0,00)
  for (const p of pessoasCaixa) {
    const k = String(p.usuario);
    if (!pessoas.has(k)) {
      pessoas.set(k, {
        chave: k, nome: p.usuario_nome ?? `Usuário ${p.usuario}`, total: 0, qtd: 0, caixa: 0, banco: 0, somaDias: 0, ultimo: null,
      });
    }
  }
  const lista = [...pessoas.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  const escolhida = lista.find((g) => g.chave === pessoaAtual);
  el('caixa-titulo').textContent = escolhida ? `Caixa de ${escolhida.nome}` : 'Todos os caixas';
  el('cartoes-pessoas').replaceChildren(...(lista.length ? lista.map((g) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    const ativo = pessoaAtual === g.chave;
    botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const titulo = document.createElement('h3');
    titulo.textContent = g.nome;
    const valor = document.createElement('p');
    valor.className = 'cartao-valor';
    valor.textContent = dinheiro(g.total);
    const diasMedio = g.total ? Math.round(g.somaDias / g.total) : 0;
    const canais = [g.caixa > 0.009 ? `caixa ${compacto(g.caixa)}` : null, g.banco > 0.009 ? `banco ${compacto(g.banco)}` : null]
      .filter(Boolean).join(' · ');
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = `${plural(g.qtd, 'pagamento', 'pagamentos')}${canais ? ` · ${canais}` : ''}`;
    const atraso = document.createElement('p');
    atraso.className = `cartao-nota${diasMedio > 7 ? ' negativo' : ''}`;
    atraso.textContent = g.chave === 'sem' ? 'origem sem pessoa registrada'
      : g.qtd === 0 ? 'nenhum pagamento neste período'
        : `lança em média ${plural(diasMedio, 'dia', 'dias')} depois do pagamento`;
    botao.append(titulo, valor, nota, atraso);
    botao.addEventListener('click', () => {
      pessoaAtual = ativo ? null : g.chave;
      diaAberto = null;
      mostrarPessoas();
    });
    return botao;
  }) : [span(`Nenhum pagamento entre ${dataBR(el('pag-inicio').value)} e ${dataBR(el('pag-fim').value)}.`, 'explica')]));
  mostrarPagamentos();
}

// Caixa por dia: cada linha é um dia; clicar abre todas as notas pagas naquele dia,
// com fornecedor, categoria, valor da nota, quanto foi pago e quanto ainda falta.
let diaAberto = null;

function mostrarPagamentos() {
  const lista = pagamentosLista.filter((p) => (pessoaAtual ? chavePessoa(p) === pessoaAtual : true));
  const tabela = el('tabela-pagamentos');

  const cab = document.createElement('tr');
  for (const [titulo, esquerda] of [['Dia', true], ['Notas'], ['Pago no dia'], ['Ainda em aberto'],
    ['Principais categorias', true], ['', true]]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = titulo;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  tabela.tHead.replaceChildren(cab);

  // Agrupa por dia do pagamento
  const dias = new Map();
  for (const p of lista) {
    const d = dias.get(p.data_pagamento) ?? { dia: p.data_pagamento, notas: [], pago: 0, aberto: 0, categorias: new Map() };
    d.notas.push(p);
    d.pago += Number(p.valor) || 0;
    d.aberto += Math.max(0, Number(p.pendente_atual) || 0);
    const cat = p.categoria ?? 'Sem categoria';
    d.categorias.set(cat, (d.categorias.get(cat) ?? 0) + (Number(p.valor) || 0));
    dias.set(p.data_pagamento, d);
  }
  const listaDias = [...dias.values()].sort((a, b) => (a.dia < b.dia ? 1 : -1));

  const linhas = [];
  if (!listaDias.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum pagamento no período.', 'vazio');
    vazio.colSpan = 6;
    linha.append(vazio);
    linhas.push(linha);
  }
  for (const d of listaDias) {
    const aberto = diaAberto === d.dia;
    const linha = document.createElement('tr');
    linha.className = `linha-dia${aberto ? ' linha-dia--aberta' : ''}`;
    const principais = [...d.categorias.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([nome, valor]) => `${nome} ${compacto(valor)}`).join(' · ');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-expandir';
    botao.setAttribute('aria-expanded', String(aberto));
    botao.setAttribute('aria-label', aberto ? 'Fechar o dia' : 'Ver as notas do dia');
    botao.textContent = aberto ? '▾' : '▸';
    const semana = new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' });
    linha.append(
      comAuxiliar(dataBR(d.dia), semana, 'esquerda sem-quebra'),
      td(inteiro(d.notas.length)),
      td(dinheiro(d.pago), 'coluna-final'),
      td(d.aberto > 0.009 ? dinheiro(d.aberto) : '—', d.aberto > 0.009 ? 'negativo' : null),
      td(principais || '—', 'esquerda'),
      td(botao, 'esquerda'),
    );
    const alternar = () => {
      diaAberto = aberto ? null : d.dia;
      mostrarPagamentos();
    };
    botao.addEventListener('click', (evento) => { evento.stopPropagation(); alternar(); });
    linha.addEventListener('click', alternar);
    linhas.push(linha);
    if (aberto) linhas.push(detalheDoDia(d));
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const totalPago = listaDias.reduce((t, d) => t + d.pago, 0);
  const totalAberto = listaDias.reduce((t, d) => t + d.aberto, 0);
  const totalNotas = listaDias.reduce((t, d) => t + d.notas.length, 0);
  const rodape = document.createElement('tr');
  rodape.append(td(`Total (${plural(listaDias.length, 'dia', 'dias')})`, 'esquerda'), td(inteiro(totalNotas)),
    td(dinheiro(totalPago)), td(totalAberto > 0.009 ? dinheiro(totalAberto) : '—'), td(''), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// Notas de um dia: todas, com fornecedor, categoria, valor, pago e o que ainda está em aberto
function detalheDoDia(d) {
  const linha = document.createElement('tr');
  linha.className = 'linha-itens';
  const celula = document.createElement('td');
  celula.colSpan = 6;
  const tabela = document.createElement('table');
  tabela.className = 'tabela tabela--itens';
  const cab = document.createElement('tr');
  const mostrarPessoa = !pessoaAtual;
  const colunas = [['Nota / título', true], ['Fornecedor', true], ['Categoria', true],
    ...(mostrarPessoa ? [['Pessoa', true]] : []), ['Valor da nota'], ['Pago'], ['Em aberto'], ['Situação', true]];
  for (const [titulo, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = titulo;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  tabela.createTHead().append(cab);
  const corpo = tabela.createTBody();
  let somaNotas = 0;
  let somaPago = 0;
  let somaAberto = 0;
  for (const p of [...d.notas].sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0))) {
    const pendente = Math.max(0, Number(p.pendente_atual) || 0);
    somaNotas += Number(p.valor_titulo) || 0;
    somaPago += Number(p.valor) || 0;
    somaAberto += pendente;
    const quitada = pendente <= 0.009;
    const etiqueta = span(quitada ? 'Baixada' : 'Em aberto', `situacao ${quitada ? 'situacao--faturada' : 'situacao--devolucao'}`);
    const tr = document.createElement('tr');
    tr.append(
      comAuxiliar(p.titulo ?? '—', p.vencimento ? `vence ${dataBR(p.vencimento)}` : null, 'esquerda sem-quebra'),
      comAuxiliar(p.fornecedor ?? `Fornecedor ${p.cod_fornecedor}`, `código ${p.cod_fornecedor}`, 'esquerda'),
      comAuxiliar(p.categoria ?? 'Sem categoria', p.grupo, 'esquerda'),
      ...(mostrarPessoa ? [comAuxiliar(p.usuario_nome ?? 'Não identificado', p.canal, 'esquerda')] : []),
      td(dinheiro(p.valor_titulo)),
      td(dinheiro(p.valor)),
      td(pendente > 0.009 ? dinheiro(pendente) : '—', pendente > 0.009 ? 'negativo' : null),
      td(etiqueta, 'esquerda'),
    );
    corpo.append(tr);
  }
  const rotulo = td(`Total do dia (${plural(d.notas.length, 'nota', 'notas')})`, 'esquerda');
  rotulo.colSpan = mostrarPessoa ? 4 : 3;
  const rodape = document.createElement('tr');
  rodape.append(rotulo, td(dinheiro(somaNotas)), td(dinheiro(somaPago)),
    td(somaAberto > 0.009 ? dinheiro(somaAberto) : '—'), td(''));
  tabela.createTFoot().append(rodape);
  celula.append(tabela);
  linha.append(celula);
  return linha;
}

// ===== Excel: a mesma lista da tela, na mesma ordem =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/pagar/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({ ...filtrosAtuais(), ordem: ordem.coluna, direcao: ordem.direcao })) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const cabecalhoArquivo = resposta.headers.get('Content-Disposition') || '';
    const nome = (cabecalhoArquivo.match(/filename="([^"]+)"/) || [])[1] || 'contas-a-pagar.xlsx';
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
  for (const id of ['inicio', 'fim']) el(id).addEventListener('input', () => marcarAtalho(null));
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
  // Período dos pagamentos: atalhos preenchem as datas; datas digitadas valem ao clicar Aplicar
  const marcarPeriodo = (ativo) => {
    for (const item of el('periodo-pagamentos').querySelectorAll('[data-dias]')) {
      item.classList.toggle('atalho--ativo', item === ativo);
    }
  };
  el('periodo-pagamentos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-dias]');
    if (!botao) return;
    const hoje = new Date();
    const inicio = botao.dataset.dias === 'mes'
      ? new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - Math.max(0, Number(botao.dataset.dias) - 1));
    el('pag-inicio').value = formatarData(inicio);
    el('pag-fim').value = formatarData(hoje);
    marcarPeriodo(botao);
    diaAberto = null;
    carregarPagamentos();
  });
  for (const id of ['pag-inicio', 'pag-fim']) el(id).addEventListener('input', () => marcarPeriodo(null));
  el('filtro-pagamentos').addEventListener('submit', (evento) => {
    evento.preventDefault();
    diaAberto = null;
    carregarPagamentos();
  });

  carregar();
});
