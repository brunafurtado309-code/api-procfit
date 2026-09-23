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
let formaAtual = null;    // nome da forma de pagamento

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
    mostrarSeletores();
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
  .filter((r) => (pessoaAtual ? Number(r.usuario) === pessoaAtual : true))
  .filter((r) => (formaAtual ? (r.forma ?? 'Outra') === formaAtual : true));

// Preenche os três seletores com o que existe no período e marca o que está escolhido
function mostrarSeletores() {
  const preencher = (id, itens, atual, rotuloTodos) => {
    const seletor = el(id);
    seletor.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: rotuloTodos }),
      ...itens.map(([valor, texto]) => Object.assign(document.createElement('option'),
        { value: String(valor), textContent: texto })));
    seletor.value = atual == null ? '' : String(atual);
  };
  const porChave = (chave, nome) => {
    const mapa = new Map();
    for (const r of lista) {
      const k = r[chave];
      if (k == null) continue;
      mapa.set(k, r[nome] ?? String(k));
    }
    return [...mapa.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'));
  };
  preencher('filtro-origem', porChave('origem_id', 'origem'), origemAtual, 'Todas');
  preencher('filtro-pessoa', porChave('usuario', 'usuario_nome'), pessoaAtual, 'Todos');
  const formas = [...new Set(lista.map((r) => r.forma ?? 'Outra'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  preencher('filtro-forma', formas.map((f) => [f, f]), formaAtual, 'Todas');
}

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
      mostrarSeletores();
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
        mostrarSeletores();
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

// ===== Lista: um lançamento por linha; clicar abre os títulos daquele lançamento =====
let loteAberto = null;
let ordemLotes = { coluna: 'dia', direcao: 'desc' };

function thOrdenavel(titulo, chaveColuna, aoOrdenar, ordemAtual, esquerda = false) {
  const th = document.createElement('th');
  th.scope = 'col';
  if (esquerda) th.className = 'esquerda';
  if (!chaveColuna) {
    th.textContent = titulo;
    return th;
  }
  const ativa = ordemAtual.coluna === chaveColuna;
  const crescente = ordemAtual.direcao === 'asc';
  if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
  const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
  seta.setAttribute('aria-hidden', 'true');
  botao.append(titulo, seta);
  botao.addEventListener('click', (evento) => {
    evento.stopPropagation();
    aoOrdenar({ coluna: chaveColuna, direcao: ativa && crescente ? 'desc' : 'asc' });
  });
  th.append(botao);
  return th;
}

function comparar(a, b, { coluna, direcao }) {
  const fator = direcao === 'asc' ? 1 : -1;
  const x = a[coluna];
  const y = b[coluna];
  if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
  return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
}

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
  if (formaAtual) itens.push({ texto: `Forma: ${formaAtual}`, remover: () => { formaAtual = null; } });
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
      loteAberto = null;
      mostrarSeletores();
      mostrarCartoes();
      mostrarPessoas();
      mostrarLista();
    });
    return botao;
  }));
}

function mostrarLista() {
  mostrarMarcadores();
  const itens = visiveis();

  // Agrupa por lançamento (origem + lote): é assim que a baixa acontece no PROCFIT
  const lotes = new Map();
  for (const r of itens) {
    const chaveLote = `${r.origem_id}-${r.lote}`;
    const g = lotes.get(chaveLote) ?? {
      chave: chaveLote, dia: r.dia, lancado_em: r.lancado_em, origem: r.origem, lote: r.lote,
      usuario_nome: r.usuario_nome ?? 'Não identificado', titulos: [], recebido: 0, formas: new Set(),
    };
    g.titulos.push(r);
    g.recebido += Number(r.recebido) || 0;
    g.formas.add(r.forma ?? 'Outra');
    lotes.set(chaveLote, g);
  }
  for (const g of lotes.values()) g.quantidade = g.titulos.length;
  const listaLotes = [...lotes.values()].sort((a, b) => comparar(a, b, ordemLotes));

  el('titulo-lista').textContent = `Recebimentos · ${plural(listaLotes.length, 'lançamento', 'lançamentos')} `
    + `· ${plural(itens.length, 'título', 'títulos')}`;

  const tabela = el('tabela-recebimentos');
  const cab = document.createElement('tr');
  const ordenar = (nova) => { ordemLotes = nova; mostrarLista(); };
  for (const [titulo, campo, esquerda] of [['Dia', 'dia', true], ['Origem', 'origem', true],
    ['Quem lançou', 'usuario_nome', true], ['Títulos', 'quantidade'], ['Recebido', 'recebido'], ['', null, true]]) {
    cab.append(thOrdenavel(titulo, campo, ordenar, ordemLotes, esquerda));
  }
  tabela.tHead.replaceChildren(cab);

  const linhas = [];
  if (!listaLotes.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum recebimento com esses filtros.', 'vazio');
    vazio.colSpan = 6;
    linha.append(vazio);
    linhas.push(linha);
  }
  for (const g of listaLotes) {
    const aberto = loteAberto === g.chave;
    const linha = document.createElement('tr');
    linha.className = `linha-dia${aberto ? ' linha-dia--aberta' : ''}`;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-expandir';
    botao.setAttribute('aria-expanded', String(aberto));
    botao.setAttribute('aria-label', aberto ? 'Fechar o lançamento' : 'Ver os títulos deste lançamento');
    botao.textContent = aberto ? '▾' : '▸';
    linha.append(
      comAuxiliar(dataBR(g.dia), g.lancado_em ? `lançado ${dataHoraBR(g.lancado_em)}` : null, 'esquerda sem-quebra'),
      comAuxiliar(g.origem, `lote ${g.lote}`, 'esquerda'),
      td(g.usuario_nome, 'esquerda'),
      td(inteiro(g.quantidade)),
      comAuxiliar(dinheiro(g.recebido), [...g.formas].join(' · '), 'coluna-final'),
      td(botao, 'esquerda'),
    );
    const alternar = () => {
      loteAberto = aberto ? null : g.chave;
      mostrarLista();
    };
    botao.addEventListener('click', (evento) => { evento.stopPropagation(); alternar(); });
    linha.addEventListener('click', alternar);
    linhas.push(linha);
    if (aberto) linhas.push(detalheDoLote(g));
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const rodape = document.createElement('tr');
  const rotulo = td(`Total (${plural(listaLotes.length, 'lançamento', 'lançamentos')})`, 'esquerda');
  rotulo.colSpan = 3;
  rodape.append(rotulo, td(inteiro(itens.length)), td(dinheiro(soma(itens))), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// Nome do cliente clicável: abre a ficha dele no contas a receber (auditoria completa)
function celulaCliente(r) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'link-pedido';
  botao.textContent = r.cliente ?? `Cliente ${r.cod_cliente}`;
  botao.title = 'Ver a ficha do cliente: títulos, compras e recebimentos';
  botao.addEventListener('click', (evento) => {
    evento.stopPropagation();
    window.location.href = `financeiro.html#cliente-${r.cod_cliente}`;
  });
  const celula = td(botao, 'esquerda');
  celula.append(span(`código ${r.cod_cliente}`, 'qtd'));
  return celula;
}

// Títulos de um lançamento: cliente, nota, pedido, forma e valor
function detalheDoLote(g) {
  const linha = document.createElement('tr');
  linha.className = 'linha-itens';
  const celula = document.createElement('td');
  celula.colSpan = 6;
  const tabela = document.createElement('table');
  tabela.className = 'tabela tabela--itens';
  const cab = document.createElement('tr');
  for (const [texto, esquerda] of [['Cliente', true], ['Título', true], ['Nota / pedido', true],
    ['Vencimento', true], ['Forma', true], ['Recebido']]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = texto;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  tabela.createTHead().append(cab);
  const corpo = tabela.createTBody();
  for (const r of [...g.titulos].sort((a, b) => (Number(b.recebido) || 0) - (Number(a.recebido) || 0))) {
    const tr = document.createElement('tr');
    const notaPedido = td(r.nota ? `NF ${r.nota}` : 'sem nota', 'esquerda');
    if (r.pedido) notaPedido.append(' · ', pedidoJanela.link(r.pedido));
    tr.append(
      celulaCliente(r),
      td(r.titulo ?? '—', 'esquerda sem-quebra'),
      notaPedido,
      td(dataBR(r.vencimento), 'esquerda sem-quebra'),
      td(r.forma ?? '—', 'esquerda'),
      comAuxiliar(dinheiro(r.recebido), parcial(r) ? `parcial de ${dinheiro(r.valor_titulo)}` : null,
        null, 'qtd negativo'),
    );
    corpo.append(tr);
  }
  const rodape = document.createElement('tr');
  const rotulo = td(`Total do lançamento (${plural(g.titulos.length, 'título', 'títulos')})`, 'esquerda');
  rotulo.colSpan = 5;
  rodape.append(rotulo, td(dinheiro(g.recebido)));
  tabela.createTFoot().append(rodape);
  celula.append(tabela);
  linha.append(celula);
  return linha;
}

// ===== Excel =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/recebimentos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({
      ...filtrosAtuais(), origem: origemAtual, usuario: pessoaAtual, forma: formaAtual, direcao: ordemLotes.direcao,
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
    // A mensagem fica no topo: leva a tela até ela para ninguém achar que o botão não fez nada
    mostrarStatus(`Excel: ${erro.message}`, true);
    el('status').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  el('baixar-excel-lista').addEventListener('click', baixarExcel);
  // Seletores: mudam o filtro sem recarregar do servidor (os dados do período já estão na tela)
  el('filtro-origem').addEventListener('change', (evento) => {
    origemAtual = evento.target.value ? Number(evento.target.value) : null;
    loteAberto = null;
    mostrarCartoes();
    mostrarLista();
  });
  el('filtro-pessoa').addEventListener('change', (evento) => {
    pessoaAtual = evento.target.value ? Number(evento.target.value) : null;
    loteAberto = null;
    mostrarPessoas();
    mostrarLista();
  });
  el('filtro-forma').addEventListener('change', (evento) => {
    formaAtual = evento.target.value || null;
    loteAberto = null;
    mostrarLista();
  });

  carregar();
});
