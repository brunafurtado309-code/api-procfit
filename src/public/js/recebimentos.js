// Recebimentos (contas a receber): toda baixa de título, com a origem e quem lançou.
// Quatro origens no PROCFIT: bancos por títulos, recebimento no caixa, cofre da loja
// e retorno de despacho.

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
  apagar: () => sessionStorage.removeItem('apiKey'),
};

// ===== Estado =====
let lista = [];
let origemAtual = null;   // código da tela de origem
let pessoaAtual = null;   // código do usuário
let ordem = { coluna: 'dia', direcao: 'desc' };

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

const filtrosAtuais = () => ({
  inicio: el('inicio').value || null,
  fim: el('fim').value || null,
  busca: el('pesquisa-termo').value.trim() || null,
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

// ===== Períodos prontos =====
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

// ===== Carregar =====
async function carregar() {
  mostrarStatus('Carregando os recebimentos…');
  try {
    lista = await buscar('recebimentos', filtrosAtuais());
    mostrarResumo();
    mostrarCartoes();
    mostrarGrafico();
    mostrarPessoas();
    mostrarLista();
    el('painel').hidden = false;
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

const visiveis = () => lista
  .filter((r) => (origemAtual ? Number(r.origem_id) === origemAtual : true))
  .filter((r) => (pessoaAtual ? Number(r.usuario) === pessoaAtual : true));

const soma = (itens) => itens.reduce((t, r) => t + (Number(r.recebido) || 0), 0);
const parcial = (r) => Number(r.recebido) + 0.009 < Number(r.valor_titulo);

function mostrarResumo() {
  const total = soma(lista);
  el('total-recebido').textContent = dinheiro(total);
  el('total-explica').textContent = `${plural(lista.length, 'título baixado', 'títulos baixados')} no período`;
  el('ind-clientes').replaceChildren(inteiro(new Set(lista.map((r) => r.cod_cliente)).size), span('clientes diferentes'));
  el('ind-pessoas').replaceChildren(
    inteiro(new Set(lista.filter((r) => r.usuario != null).map((r) => r.usuario)).size), span('lançaram baixas'));
  const parciais = lista.filter(parcial);
  el('ind-parciais').replaceChildren(inteiro(parciais.length), span(`${compacto(soma(parciais))} recebidos em parte`));
  const formas = new Map();
  for (const r of lista) formas.set(r.forma ?? 'Outra', (formas.get(r.forma ?? 'Outra') ?? 0) + (Number(r.recebido) || 0));
  const maior = [...formas.entries()].sort((a, b) => b[1] - a[1])[0];
  el('ind-forma').replaceChildren(maior ? maior[0] : '—',
    span(maior ? `${compacto(maior[1])} (${Math.round((maior[1] / (total || 1)) * 100)}%)` : 'sem recebimentos'));
}

function mostrarCartoes() {
  const origens = new Map();
  for (const r of lista) {
    const k = Number(r.origem_id);
    const g = origens.get(k) ?? { id: k, nome: r.origem, valor: 0, qtd: 0 };
    g.valor += Number(r.recebido) || 0;
    g.qtd += 1;
    origens.set(k, g);
  }
  const itens = [{ id: null, nome: 'Todas as origens', valor: soma(lista), qtd: lista.length },
    ...[...origens.values()].sort((a, b) => b.valor - a.valor)];
  el('cartoes').replaceChildren(...itens.map((o) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    const ativo = origemAtual === o.id;
    botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const titulo = document.createElement('h3');
    titulo.textContent = o.nome;
    const valor = document.createElement('p');
    valor.className = 'cartao-valor';
    valor.textContent = dinheiro(o.valor);
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = plural(o.qtd, 'título', 'títulos');
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      origemAtual = ativo ? null : o.id;
      mostrarCartoes();
      mostrarLista();
    });
    return botao;
  }));
}

function mostrarGrafico() {
  const dias = [...new Set(lista.map((r) => r.dia))].sort();
  const origens = [...new Set(lista.map((r) => r.origem))];
  const valorDe = (dia, origem) => soma(lista.filter((r) => r.dia === dia && r.origem === origem));
  graficos.colunas(el('grafico-dias'), {
    titulo: 'Recebido por dia',
    empilhado: true,
    rotulos: dias.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`),
    series: origens.map((origem) => ({ nome: origem, valores: dias.map((d) => valorDe(d, origem)) })),
    vazio: 'Nenhum recebimento no período.',
  });
}

function mostrarPessoas() {
  const pessoas = new Map();
  for (const r of lista) {
    const k = r.usuario ?? 'sem';
    const g = pessoas.get(k) ?? { id: r.usuario, nome: r.usuario_nome ?? 'Não identificado', valor: 0, qtd: 0 };
    g.valor += Number(r.recebido) || 0;
    g.qtd += 1;
    pessoas.set(k, g);
  }
  const itens = [...pessoas.values()].sort((a, b) => b.valor - a.valor);
  const maximo = Math.max(0, ...itens.map((p) => p.valor));
  el('barras-pessoas').replaceChildren(...(itens.length ? itens.map((p) => {
    const linha = document.createElement(p.id != null ? 'button' : 'div');
    linha.className = `barra${p.id != null && pessoaAtual === p.id ? ' barra--ativa' : ''}`;
    if (p.id != null) {
      linha.type = 'button';
      linha.addEventListener('click', () => {
        pessoaAtual = pessoaAtual === p.id ? null : p.id;
        mostrarPessoas();
        mostrarLista();
      });
    }
    const trilho = span('', 'barra-trilho');
    const preenchida = span('', 'barra-preenchida');
    preenchida.style.width = `${maximo ? Math.max(2, (p.valor / maximo) * 100) : 0}%`;
    trilho.append(preenchida);
    const valor = span(dinheiro(p.valor), 'barra-valor');
    valor.append(Object.assign(document.createElement('small'), { textContent: plural(p.qtd, 'título', 'títulos') }));
    linha.append(span(p.nome, 'barra-rotulo'), trilho, valor);
    return linha;
  }) : [span('Nenhum recebimento no período.', 'explica')]));
}

// ===== Lista =====
const COLUNAS = [
  { titulo: 'Recebimento', chave: 'dia', esquerda: true },
  { titulo: 'Origem', chave: 'origem', esquerda: true },
  { titulo: 'Quem lançou', chave: 'usuario_nome', esquerda: true },
  { titulo: 'Título', chave: 'titulo', esquerda: true },
  { titulo: 'Nota / pedido', chave: 'nota', esquerda: true },
  { titulo: 'Cliente', chave: 'cliente', esquerda: true },
  { titulo: 'Forma', chave: 'forma', esquerda: true },
  { titulo: 'Recebido', chave: 'recebido' },
];

function mostrarMarcadores() {
  const itens = [];
  if (origemAtual) {
    itens.push({ texto: lista.find((r) => Number(r.origem_id) === origemAtual)?.origem ?? 'Origem',
      remover: () => { origemAtual = null; } });
  }
  if (pessoaAtual) {
    itens.push({ texto: `Lançado por ${lista.find((r) => Number(r.usuario) === pessoaAtual)?.usuario_nome ?? pessoaAtual}`,
      remover: () => { pessoaAtual = null; } });
  }
  const termo = el('pesquisa-termo').value.trim();
  if (termo) {
    itens.push({ texto: `Pesquisa: ${termo}`,
      remover: () => { el('pesquisa-termo').value = ''; el('limpar-pesquisa').hidden = true; carregar(); } });
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
      mostrarCartoes();
      mostrarPessoas();
      mostrarLista();
    });
    return botao;
  }));
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

function mostrarLista() {
  mostrarMarcadores();
  const fator = ordem.direcao === 'asc' ? 1 : -1;
  const itens = [...visiveis()].sort((a, b) => {
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  el('titulo-lista').textContent = `Recebimentos (${inteiro(itens.length)})`;

  const tabela = el('tabela-recebimentos');
  tabela.tHead.replaceChildren(cabecalho());
  const MAXIMO = 500;
  tabela.tBodies[0].replaceChildren(...(itens.length ? itens.slice(0, MAXIMO).map((r) => {
    const linha = document.createElement('tr');
    const notaPedido = td(r.nota ? `NF ${r.nota}` : 'sem nota', 'esquerda');
    if (r.pedido) {
      notaPedido.append(document.createElement('br'), pedidoJanela.link(r.pedido));
    }
    linha.append(
      comAuxiliar(dataBR(r.dia), r.lancado_em ? `lançado ${dataHoraBR(r.lancado_em)}` : null, 'esquerda sem-quebra'),
      comAuxiliar(r.origem, r.lote ? `lote ${r.lote}` : null, 'esquerda'),
      td(r.usuario_nome ?? 'Não identificado', 'esquerda'),
      td(r.titulo ?? '—', 'esquerda sem-quebra'),
      notaPedido,
      comAuxiliar(r.cliente ?? `Cliente ${r.cod_cliente}`, `código ${r.cod_cliente}`, 'esquerda'),
      td(r.forma ?? '—', 'esquerda'),
      comAuxiliar(dinheiro(r.recebido), parcial(r) ? `parcial de ${dinheiro(r.valor_titulo)}` : null,
        'coluna-final', 'qtd negativo'),
    );
    return linha;
  }) : [Object.assign(document.createElement('tr'),
    { innerHTML: '<td class="vazio" colspan="8">Nenhum recebimento com esses filtros.</td>' })]));

  const rodape = document.createElement('tr');
  const rotulo = td(itens.length > MAXIMO
    ? `Total (${plural(itens.length, 'título', 'títulos')}; mostrando os ${MAXIMO} primeiros)`
    : `Total (${plural(itens.length, 'título', 'títulos')})`, 'esquerda');
  rotulo.colSpan = 7;
  rodape.append(rotulo, td(dinheiro(soma(itens))));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Excel =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/recebimentos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({
      ...filtrosAtuais(), origem: origemAtual, usuario: pessoaAtual, ordem: ordem.coluna, direcao: ordem.direcao,
    })) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'recebimentos.xlsx';
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

  const periodo = periodoPronto('30');
  el('inicio').value = periodo.inicio;
  el('fim').value = periodo.fim;

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    window.location.href = 'financeiro.html';
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
    for (const item of el('atalhos').querySelectorAll('[data-dias]')) {
      item.classList.toggle('atalho--ativo', item === botao);
    }
    carregar();
  });
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
