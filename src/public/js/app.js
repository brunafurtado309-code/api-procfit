// Painel de vendas: busca os dados na API e preenche a tela.

// ===== Formatação no padrão brasileiro =====
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const percentual = (valor) =>
  `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const NOMES_ORIGEM = { PDV: 'Caixa', NFE: 'Nota fiscal', OUTROS: 'Outros' };

const el = (id) => document.getElementById(id);

// "1 nota" / "3 notas"
const contar = (n, singular, plural) =>
  `${inteiro.format(n ?? 0)} ${n === 1 ? singular : plural}`;

// Escreve um valor em reais e pinta de alerta se for negativo
function escreverValor(elemento, valor) {
  elemento.textContent = moeda.format(valor ?? 0);
  elemento.classList.toggle('negativo', valor < 0);
}

// Data de hoje no formato AAAA-MM-DD (horário local)
function formatarData(data) {
  const doisDigitos = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

// ===== Chave de acesso (guardada só enquanto a aba estiver aberta) =====
const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  salvar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

function mostrarEntrada() {
  el('painel').hidden = true;
  el('trocar-chave').hidden = true;
  el('form-chave').hidden = false;
  el('campo-chave').focus();
}

function mostrarPainel() {
  painelFoiAtualizado(); // guarda a versão que está aberta
  el('form-chave').hidden = true;
  el('painel').hidden = false;
  el('trocar-chave').hidden = false;
  carregar();
}

// ===== Comunicação com a API =====
class ChaveInvalida extends Error {}

async function buscar(rota, filtros) {
  const url = `/vendas/${rota}?${new URLSearchParams(filtros)}`;
  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() } });
  const corpo = await resposta.json().catch(() => ({}));

  if (resposta.status === 401) throw new ChaveInvalida();
  if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível carregar os dados.');
  return corpo;
}

// Baixa um arquivo da API (a chave vai no cabeçalho, por isso não dá para usar um link comum)
async function baixarArquivo(rota, filtros, nomePadrao, botao) {
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Gerando…';

  try {
    const url = `/vendas/${rota}?${new URLSearchParams(filtros)}`;
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() } });

    if (resposta.status === 401) throw new ChaveInvalida();
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar o Excel.');
    }

    // Usa o nome que a API sugeriu, se houver
    const cabecalho = resposta.headers.get('Content-Disposition') || '';
    const nomeArquivo = (cabecalho.match(/filename="([^"]+)"/) || [])[1] || nomePadrao;

    const arquivo = await resposta.blob();
    const endereco = URL.createObjectURL(arquivo);
    const link = document.createElement('a');
    link.href = endereco;
    link.download = nomeArquivo;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(endereco), 1000);
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

function pedirChaveDeNovo() {
  pararAtualizacao();
  if (el('detalhe').open) el('detalhe').close();
  chave.apagar();
  mostrarEntrada();
  mostrarStatus('');
  alert('Chave de acesso inválida. Informe a chave novamente.');
}

const filtrosAtuais = () => ({ inicio: el('inicio').value, fim: el('fim').value });

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// ===== Preenchimento da tela =====
function mostrarResumo(r) {
  el('venda-liquida').textContent = moeda.format(r.venda_liquida ?? 0);
  el('qtd-vendas').textContent = inteiro.format(r.qtd_vendas ?? 0);
  el('ticket').textContent = r.ticket_medio != null ? moeda.format(r.ticket_medio) : '—';
  el('desconto').textContent = moeda.format(r.desconto ?? 0);

  const nota = el('margem-nota');
  if (r.margem_pct == null) {
    el('margem').textContent = 'Sem custo';
    nota.textContent = 'Nenhuma venda do período tem custo cadastrado.';
    nota.classList.add('nota--alerta');
  } else {
    el('margem').textContent = percentual(r.margem_pct);
    nota.textContent = `Calculada sobre ${percentual(r.cobertura_custo_pct)} das vendas`;
    nota.classList.toggle('nota--alerta', r.cobertura_custo_pct < 100);
  }
}

function mostrarOrigens(origens) {
  // Só entram na barra as origens com venda positiva (devoluções ficam de fora)
  const positivas = origens.filter((o) => o.venda_liquida > 0);
  const total = positivas.reduce((soma, o) => soma + o.venda_liquida, 0);

  const barra = el('barra');
  const legenda = el('legenda');
  barra.replaceChildren();
  legenda.replaceChildren();

  for (const o of positivas) {
    const nome = NOMES_ORIGEM[o.origem] || o.origem;
    const classe = o.origem.toLowerCase();
    const participacao = total ? (o.venda_liquida / total) * 100 : 0;
    const cobertura = o.cobertura_custo_pct ?? 0;

    // Segmento da barra (largura = participação na venda)
    const segmento = document.createElement('div');
    segmento.className = `segmento segmento--${classe}`;
    segmento.style.width = `${participacao}%`;

    // Parte lisa dentro do segmento (largura = quanto tem custo)
    const parteComCusto = document.createElement('div');
    parteComCusto.className = 'segmento__custo';
    parteComCusto.style.width = `${cobertura}%`;
    segmento.append(parteComCusto);
    barra.append(segmento);

    // Legenda (textContent evita injeção de HTML vindo dos dados)
    const item = document.createElement('li');
    item.className = `legenda__item legenda__item--${classe}`;

    const titulo = document.createElement('strong');
    titulo.textContent = `${nome}: ${percentual(participacao)}`;

    const valor = document.createElement('span');
    valor.textContent = moeda.format(o.venda_liquida);

    const custo = document.createElement('span');
    custo.textContent = o.margem_pct != null
      ? `Margem de ${percentual(o.margem_pct)} (custo em ${percentual(cobertura)} das vendas)`
      : 'Sem custo cadastrado';

    item.append(titulo, valor, custo);
    legenda.append(item);
  }
}

function mostrarComposicao(total) {
  escreverValor(el('total-notas'), total.notas_valor);
  el('total-notas-qtd').textContent = contar(total.notas_qtd, 'nota', 'notas');

  escreverValor(el('total-caixa'), total.caixa_valor);
  el('total-caixa-qtd').textContent = contar(total.caixa_qtd, 'cupom', 'cupons');

  // Devoluções = notas de devolução + devoluções no caixa
  escreverValor(el('total-devolucoes'), total.devolucoes_valor + total.devolucoes_caixa_valor);
  el('total-devolucoes-qtd').textContent =
    contar(total.devolucoes_qtd + total.devolucoes_caixa_qtd, 'devolução', 'devoluções');

  escreverValor(el('total-liquido'), total.liquido);
}

// Célula com valor em reais e, opcionalmente, a quantidade embaixo
function celulaValor(valor, textoQtd, classeExtra) {
  const td = document.createElement('td');
  const texto = document.createElement('span');
  escreverValor(texto, valor);
  td.append(texto);

  if (textoQtd) {
    const qtd = document.createElement('span');
    qtd.className = 'qtd';
    qtd.textContent = textoQtd;
    td.append(qtd);
  }
  if (classeExtra) td.classList.add(classeExtra);
  return td;
}

// Colunas de cada tabela: de onde vem o valor e o texto de quantidade.
// codigo = campo que identifica a pessoa; detalhe = qual janela abre ao clicar no nome.
const TABELA_VENDEDORES = {
  codigo: 'vendedor',
  detalhe: 'notas',
  corpo: 'vendedores',
  rodape: 'vendedores-total',
  vazio: 'Nenhuma nota faturada no período.',
  semNome: 'Sem vendedor informado',
  participa: (v) => v.notas_qtd > 0 || v.devolucoes_qtd > 0,
  total: (v) => (v.notas_valor ?? 0) + (v.devolucoes_valor ?? 0),
  colunas: [
    { valor: (v) => v.notas_valor, qtd: (v) => contar(v.notas_qtd, 'nota', 'notas') },
    { valor: (v) => v.devolucoes_valor, qtd: (v) => contar(v.devolucoes_qtd, 'devolução', 'devoluções') },
  ],
};

const TABELA_CAIXA = {
  codigo: 'operador',
  detalhe: 'cupons',
  corpo: 'caixa',
  rodape: 'caixa-total',
  vazio: 'Nenhuma venda no caixa no período.',
  semNome: 'Sem operador informado',
  participa: (o) => o.caixa_qtd > 0 || o.devolucoes_caixa_qtd > 0,
  total: (o) => (o.caixa_valor ?? 0) + (o.devolucoes_caixa_valor ?? 0),
  colunas: [
    { valor: (o) => o.caixa_valor, qtd: (o) => contar(o.caixa_qtd, 'cupom', 'cupons') },
    { valor: (o) => o.devolucoes_caixa_valor, qtd: (o) => contar(o.devolucoes_caixa_qtd, 'devolução', 'devoluções') },
  ],
};

function montarLinha(tabela, item, nome, ehTotal = false) {
  const tr = document.createElement('tr');

  const celulaNome = document.createElement(ehTotal ? 'td' : 'th');
  if (!ehTotal) celulaNome.scope = 'row';

  if (tabela.detalhe && !ehTotal) {
    // O nome vira um botão que abre o detalhe (notas ou cupons)
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'nome-botao';
    botao.textContent = nome;
    botao.addEventListener('click', () => abrirDetalhe(tabela.detalhe, item[tabela.codigo] || 0, nome));
    celulaNome.append(botao);
  } else {
    celulaNome.textContent = nome;
  }
  tr.append(celulaNome);

  for (const coluna of tabela.colunas) {
    tr.append(celulaValor(coluna.valor(item), coluna.qtd(item)));
  }
  tr.append(celulaValor(tabela.total(item), null, 'coluna-final'));
  return tr;
}

function mostrarTabela(tabela, itens, total) {
  const corpo = el(tabela.corpo);
  const rodape = el(tabela.rodape);

  // Cada tabela mostra só quem participou daquele tipo de venda, do maior para o menor
  const linhas = itens
    .filter(tabela.participa)
    .sort((a, b) => tabela.total(b) - tabela.total(a));

  if (linhas.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = tabela.colunas.length + 2;
    td.className = 'vazio';
    td.textContent = tabela.vazio;
    tr.append(td);
    corpo.replaceChildren(tr);
    rodape.replaceChildren();
    return;
  }

  const nomeDe = (item) => (item[tabela.codigo] ? item.nome : tabela.semNome);
  corpo.replaceChildren(...linhas.map((item) => montarLinha(tabela, item, nomeDe(item))));
  rodape.replaceChildren(montarLinha(tabela, total, 'Total', true));
}

// ===== Janela de detalhe (notas do vendedor ou cupons do operador) =====
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const SITUACAO_CLASSE = {
  Faturada: 'faturada', Emitido: 'faturada',
  Cancelada: 'cancelada', Cancelado: 'cancelada',
  'Devolução': 'devolucao',
};

function celulaTexto(texto, classe) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  if (classe) td.className = classe;
  return td;
}

function celulaSituacao(situacao) {
  const td = document.createElement('td');
  td.className = 'esquerda';
  const selo = document.createElement('span');
  selo.className = `situacao situacao--${SITUACAO_CLASSE[situacao] || 'faturada'}`;
  selo.textContent = situacao;
  td.append(selo);
  return td;
}

function celulaCliente(linha) {
  const td = document.createElement('td');
  td.className = 'esquerda coluna-cliente';
  td.textContent = linha.cliente || 'Não identificado';
  if (linha.fantasia && linha.fantasia !== linha.cliente) {
    const fantasia = document.createElement('span');
    fantasia.className = 'fantasia';
    fantasia.textContent = linha.fantasia;
    td.append(fantasia);
  }
  if (linha.observacao) {
    const observacao = document.createElement('span');
    observacao.className = 'observacao';
    observacao.textContent = `Obs.: ${linha.observacao}`;
    td.append(observacao);
  }
  return td;
}

// ===== Produtos de cada documento (botão ▸) =====
const QTD_COLUNAS_ITENS = 6;

function parametrosItens(linha) {
  const ehNota = linha.tipo === 'Nota';
  const params = {
    tipo: ehNota ? 'nota' : 'cupom',
    empresa: linha.empresa,
    // Na devolução por nota, os itens estão com o número da nota original
    numero: linha.numero_documento ?? (ehNota ? linha.nota : linha.cupom),
    categoria: linha.categoria,
  };
  if (!ehNota) {
    params.caixa = linha.caixa;
    params.venda = linha.venda;
  }
  if (SITUACAO_CLASSE[linha.situacao] === 'cancelada') params.original = 1;
  return params;
}

function tabelaItens(dados) {
  const tabela = document.createElement('table');
  tabela.className = 'tabela tabela--itens';

  const cab = document.createElement('tr');
  for (const [titulo, esquerda] of [['Produto', true], ['Qtd.'], ['Preço unit.'], ['Bruto'], ['Desconto'], ['Valor']]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = titulo;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(cab);

  const tbody = document.createElement('tbody');
  for (const item of dados.itens) {
    const tr = document.createElement('tr');
    if (Number(item.desconto) > 0) tr.className = 'item-com-desconto';

    const produto = document.createElement('td');
    produto.className = 'esquerda';
    const codigo = document.createElement('span');
    codigo.className = 'codigo-produto';
    codigo.textContent = item.produto;
    produto.append(codigo, ` ${item.descricao || 'Produto sem cadastro'}`);

    const quantidade = Number(item.quantidade) || 0;
    const unitario = quantidade ? Number(item.bruto) / quantidade : null;

    tr.append(
      produto,
      celulaTexto(inteiro.format(quantidade)),
      unitario === null ? celulaTexto('—') : celulaValor(unitario),
      celulaValor(item.bruto),
      celulaValor(item.desconto, null, Number(item.desconto) > 0 ? 'desconto-destaque' : null),
      celulaValor(item.valor),
    );
    tbody.append(tr);
  }

  const total = document.createElement('tr');
  const rotulo = celulaTexto('Total dos produtos', 'esquerda');
  rotulo.colSpan = 3;
  total.append(rotulo, celulaValor(dados.total.bruto), celulaValor(dados.total.desconto), celulaValor(dados.total.valor));
  const tfoot = document.createElement('tfoot');
  tfoot.append(total);

  tabela.append(thead, tbody, tfoot);
  return tabela;
}

async function alternarItens(botao, linha, trDocumento, quantidadeColunas) {
  const aberto = botao.getAttribute('aria-expanded') === 'true';
  const proxima = trDocumento.nextElementSibling;
  if (aberto) {
    if (proxima?.classList.contains('linha-itens')) proxima.remove();
    botao.setAttribute('aria-expanded', 'false');
    botao.textContent = '▸';
    return;
  }

  botao.setAttribute('aria-expanded', 'true');
  botao.textContent = '▾';
  const trItens = document.createElement('tr');
  trItens.className = 'linha-itens';
  const td = document.createElement('td');
  td.colSpan = quantidadeColunas;
  td.textContent = 'Carregando produtos…';
  trItens.append(td);
  trDocumento.after(trItens);

  try {
    if (!linha._itens) {
      linha._itens = await buscar('itens', { ...detalheAberto.filtros, ...parametrosItens(linha) });
    }
    const conteudo = [];
    if (linha.observacao || linha.nota_origem) {
      const info = document.createElement('p');
      info.className = 'info-documento';
      const partes = [];
      if (linha.nota_origem) partes.push(`Nota original: ${linha.nota_origem}`);
      if (linha.pedido) partes.push(`Pedido: ${linha.pedido}`);
      if (linha.observacao) partes.push(`Observação: ${linha.observacao}`);
      info.textContent = partes.join('  •  ');
      conteudo.push(info);
    }
    conteudo.push(linha._itens.itens.length
      ? tabelaItens(linha._itens)
      : 'Nenhum produto encontrado para este documento no período.');
    td.replaceChildren(...conteudo);
  } catch (erro) {
    if (erro instanceof ChaveInvalida) return pedirChaveDeNovo();
    td.textContent = erro.message;
    td.classList.add('status--erro');
  }
}

function celulaExpandir(linha, trDocumento, quantidadeColunas) {
  const td = document.createElement('td');
  td.className = 'coluna-expandir';
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'botao-expandir';
  botao.textContent = '▸';
  botao.setAttribute('aria-expanded', 'false');
  botao.setAttribute('aria-label', `Ver produtos do ${linha.tipo === 'Nota' ? 'documento' : 'cupom'} ${linha.documento ?? ''}`);
  botao.addEventListener('click', () => alternarItens(botao, linha, trDocumento, quantidadeColunas));
  td.append(botao);
  return td;
}

// Tabela de preço do pedido (Atacado, Varejo...)
function celulaTabela(linha) {
  const td = document.createElement('td');
  td.className = 'esquerda';
  if (!linha.tabela_preco) {
    td.textContent = '—';
    return td;
  }
  const selo = document.createElement('span');
  selo.className = `tabela-preco tabela-preco--${normalizar(linha.tabela_preco).replace(/[^a-z]/g, '')}`;
  selo.textContent = linha.tabela_preco;
  td.append(selo);
  return td;
}

// Nº do documento; na devolução mostra também o documento original
function celulaDocumento(linha) {
  const td = celulaTexto(linha.documento ?? linha.nota);
  let textoOrigem = null;
  if (linha.nota_origem) textoOrigem = `origem: NF ${linha.nota_origem}`;
  else if (linha.cupom_origem) textoOrigem = `origem: cupom ${linha.cupom_origem} (caixa ${linha.caixa_origem})`;
  if (textoOrigem) {
    const origem = document.createElement('span');
    origem.className = 'origem';
    origem.textContent = textoOrigem;
    td.append(origem);
  }
  return td;
}

// Valor da nota ou do cupom original (só na lista de devoluções), com a data embaixo
const COLUNA_VALOR_ORIGINAL = {
  titulo: 'Valor original',
  soma: 'valor_origem',
  celula: (l) => (l.valor_origem === null || l.valor_origem === undefined
    ? celulaTexto('Não informado')
    : celulaValor(l.valor_origem, l.data_origem ? `de ${dataBR(l.data_origem)}` : null)),
};

// Colunas usadas em todas as listas
const COLUNA_EXPANDIR = { titulo: '', expandir: true };
const COLUNAS_VALORES = [
  { titulo: 'Bruto', soma: 'bruto', celula: (l) => celulaValor(l.bruto) },
  { titulo: 'Desconto', soma: 'desconto', celula: (l) => celulaValor(l.desconto, null, Number(l.desconto) > 0 ? 'desconto-destaque' : null) },
  { titulo: 'Valor', soma: 'valor', celula: (l) => celulaValor(l.valor) },
];

const comTipo = (tipo, campoDocumento) => (item) => ({ ...item, tipo, documento: item[campoDocumento] });

// Cada tipo de detalhe: rota, colunas e textos
const DETALHES = {
  notas: {
    rota: (codigo) => `vendedores/${encodeURIComponent(codigo)}/notas`,
    rotaExcel: (codigo) => `vendedores/${encodeURIComponent(codigo)}/notas/excel`,
    pessoa: (d) => d.vendedor,
    linhas: (d) => d.notas.map(comTipo('Nota', 'nota')),
    carregando: 'Carregando notas…',
    situacoes: ['Faturada', 'Cancelada', 'Devolução'],
    dicaBusca: 'Nº da nota, nº do pedido, cliente, CNPJ/CPF ou código',
    busca: (n) => [n.nota, n.nota_origem, n.pedido, n.tabela_preco, n.codigo_cliente, n.cliente, n.fantasia, n.cnpj_cpf, n.observacao],
    vazio: 'Nenhuma nota deste vendedor no período.',
    resumo: (t) => [
      contar(t.faturadas_qtd, 'nota faturada', 'notas faturadas'),
      contar(t.canceladas_qtd, 'cancelada', 'canceladas'),
      contar(t.devolucoes_qtd, 'devolução', 'devoluções'),
    ],
    colunas: [
      COLUNA_EXPANDIR,
      { titulo: 'Data', celula: (n) => celulaTexto(dataBR(n.data), 'sem-quebra') },
      { titulo: 'Situação', esquerda: true, celula: (n) => celulaSituacao(n.situacao) },
      { titulo: 'Nº da nota', celula: celulaDocumento },
      { titulo: 'Nº do pedido', celula: (n) => celulaTexto(n.pedido) },
      { titulo: 'Tabela', esquerda: true, celula: celulaTabela },
      { titulo: 'Cód. cliente', celula: (n) => celulaTexto(n.codigo_cliente) },
      { titulo: 'Cliente', esquerda: true, celula: celulaCliente },
      ...COLUNAS_VALORES,
    ],
  },
  cupons: {
    rota: (codigo) => `operadores/${encodeURIComponent(codigo)}/cupons`,
    rotaExcel: (codigo) => `operadores/${encodeURIComponent(codigo)}/cupons/excel`,
    pessoa: (d) => d.operador,
    linhas: (d) => d.cupons.map(comTipo('Cupom', 'cupom')),
    carregando: 'Carregando cupons…',
    situacoes: ['Emitido', 'Cancelado', 'Devolução'],
    dicaBusca: 'Nº do cupom, caixa, vendedor, cliente ou código',
    busca: (c) => [c.cupom, c.pedido, c.tabela_preco, c.caixa, c.vendedor, c.codigo_cliente, c.cliente, c.fantasia, c.observacao],
    vazio: 'Nenhum cupom deste operador no período.',
    resumo: (t) => [
      contar(t.emitidos_qtd, 'cupom emitido', 'cupons emitidos'),
      contar(t.cancelados_qtd, 'cancelado', 'cancelados'),
      contar(t.devolucoes_qtd, 'devolução', 'devoluções'),
    ],
    colunas: [
      COLUNA_EXPANDIR,
      { titulo: 'Data', celula: (c) => celulaTexto(dataBR(c.data), 'sem-quebra') },
      { titulo: 'Hora', celula: (c) => celulaTexto(c.hora) },
      { titulo: 'Situação', esquerda: true, celula: (c) => celulaSituacao(c.situacao) },
      { titulo: 'Caixa', celula: (c) => celulaTexto(c.caixa) },
      { titulo: 'Nº do cupom', celula: (c) => celulaTexto(c.cupom) },
      { titulo: 'Nº do pedido', celula: (c) => celulaTexto(c.pedido) },
      { titulo: 'Tabela', esquerda: true, celula: celulaTabela },
      { titulo: 'Vendedor', esquerda: true, celula: (c) => celulaTexto(c.vendedor || 'Não informado', 'esquerda coluna-pessoa') },
      { titulo: 'Cliente', esquerda: true, celula: celulaCliente },
      ...COLUNAS_VALORES,
    ],
  },
};

// Pesquisa e cartões: notas e cupons juntos na mesma lista
function celulaTipo(linha) {
  const td = document.createElement('td');
  td.className = 'esquerda';
  const selo = document.createElement('span');
  selo.className = `tipo-documento tipo-documento--${linha.tipo === 'Nota' ? 'nota' : 'cupom'}`;
  selo.textContent = linha.tipo;
  td.append(selo);
  return td;
}

// colunasExtras: entram antes dos valores; tituloValor: troca o nome da coluna "Valor"
function listaMista({ rota, titulo, carregando, vazio, situacoes, colunasExtras = [], tituloValor = null }) {
  return {
    rota: () => rota,
    rotaExcel: null,
    pessoa: (d) => ({ nome: titulo(d) }),
    linhas: (d) => [
      ...d.notas.map(comTipo('Nota', 'nota')),
      ...d.cupons.map(comTipo('Cupom', 'cupom')),
    ].sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.documento ?? 0) - (b.documento ?? 0)),
    carregando,
    vazio,
    situacoes,
    dicaBusca: 'Refinar: número, pedido, cliente, vendedor, atacado ou varejo…',
    busca: (l) => [l.tipo, l.documento, l.nota_origem, l.cupom_origem, l.pedido, l.tabela_preco, l.vendedor, l.codigo_cliente,
      l.cliente, l.fantasia, l.cnpj_cpf, l.observacao],
    resumo: (t) => {
      const partes = [];
      if (t.notas_qtd) partes.push(contar(t.notas_qtd, 'nota', 'notas'));
      if (t.cupons_qtd) partes.push(contar(t.cupons_qtd, 'cupom', 'cupons'));
      if (!partes.length) partes.push('nenhum documento');
      if (Number(t.desconto) > 0) partes.push(`${moeda.format(t.desconto)} em descontos`);
      return partes;
    },
    colunas: [
      COLUNA_EXPANDIR,
      { titulo: 'Tipo', esquerda: true, celula: celulaTipo },
      { titulo: 'Data', celula: (l) => celulaTexto(dataBR(l.data), 'sem-quebra') },
      { titulo: 'Situação', esquerda: true, celula: (l) => celulaSituacao(l.situacao) },
      { titulo: 'Nº documento', celula: celulaDocumento },
      { titulo: 'Nº do pedido', celula: (l) => celulaTexto(l.pedido) },
      { titulo: 'Tabela', esquerda: true, celula: celulaTabela },
      { titulo: 'Vendedor', esquerda: true, celula: (l) => celulaTexto(l.vendedor || 'Não informado', 'esquerda coluna-pessoa') },
      { titulo: 'Cliente', esquerda: true, celula: celulaCliente },
      ...colunasExtras,
      ...COLUNAS_VALORES.map((c) => (c.soma === 'valor' && tituloValor ? { ...c, titulo: tituloValor } : c)),
    ],
  };
}

DETALHES.pesquisa = listaMista({
  rota: 'pesquisa',
  titulo: (d) => `Resultado para "${d.termo}"`,
  carregando: 'Pesquisando…',
  vazio: 'Nenhuma nota ou cupom encontrado no período. Confira o que foi digitado ou amplie as datas.',
  situacoes: ['Faturada', 'Emitido', 'Cancelada', 'Cancelado', 'Devolução'],
});

DETALHES.todasNotas = listaMista({
  rota: 'notas',
  titulo: () => 'Notas fiscais do período',
  carregando: 'Carregando notas…',
  vazio: 'Nenhuma nota fiscal no período.',
  situacoes: ['Faturada', 'Cancelada'],
});

DETALHES.todosCupons = listaMista({
  rota: 'cupons',
  titulo: () => 'Cupons do período',
  carregando: 'Carregando cupons…',
  vazio: 'Nenhum cupom no período.',
  situacoes: ['Emitido', 'Cancelado'],
});

DETALHES.devolucoes = listaMista({
  rota: 'devolucoes',
  titulo: () => 'Devoluções do período',
  carregando: 'Carregando devoluções…',
  vazio: 'Nenhuma devolução no período.',
  situacoes: ['Devolução'],
  colunasExtras: [COLUNA_VALOR_ORIGINAL],
  tituloValor: 'Valor devolvido',
});

DETALHES.descontos = listaMista({
  rota: 'descontos',
  titulo: () => 'Vendas com desconto',
  carregando: 'Carregando vendas com desconto…',
  vazio: 'Nenhuma venda com desconto no período.',
  situacoes: ['Faturada', 'Emitido'],
});

function montarCabecalho(config) {
  const tr = document.createElement('tr');
  for (const coluna of config.colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = coluna.titulo;
    if (coluna.esquerda) th.className = 'esquerda';
    if (coluna.expandir) {
      th.className = 'coluna-expandir';
      th.setAttribute('aria-label', 'Produtos');
    }
    tr.append(th);
  }
  el('detalhe-cabecalho').replaceChildren(tr);
}

function montarLinhaDetalhe(config, linha) {
  const tr = document.createElement('tr');
  if (SITUACAO_CLASSE[linha.situacao] === 'cancelada') tr.className = 'linha-cancelada';
  for (const coluna of config.colunas) {
    tr.append(coluna.expandir
      ? celulaExpandir(linha, tr, config.colunas.length)
      : coluna.celula(linha));
  }
  return tr;
}

// ===== Pesquisa dentro do detalhe =====
// Tira acentos e deixa minúsculo, para "acai" encontrar "AÇAÍ"
const normalizar = (texto) =>
  String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function prepararFiltrosDetalhe(config) {
  const busca = el('detalhe-busca');
  busca.value = '';
  busca.placeholder = config.dicaBusca;

  const situacao = el('detalhe-situacao');
  const todas = document.createElement('option');
  todas.value = '';
  todas.textContent = 'Todas';
  const opcoes = config.situacoes.map((nome) => {
    const opcao = document.createElement('option');
    opcao.value = nome;
    opcao.textContent = nome;
    return opcao;
  });
  situacao.replaceChildren(todas, ...opcoes);
  el('detalhe-contagem').textContent = '';
}

function linhaUnica(texto, quantidadeColunas) {
  const tr = document.createElement('tr');
  const td = celulaTexto(texto, 'vazio');
  td.colSpan = quantidadeColunas;
  tr.append(td);
  return tr;
}

function aplicarFiltroDetalhe() {
  if (!detalheAberto?.linhas) return;
  const { config, linhas } = detalheAberto;
  // Cada palavra digitada precisa aparecer (em qualquer ordem)
  const palavras = normalizar(el('detalhe-busca').value).split(/\s+/).filter(Boolean);
  const situacao = el('detalhe-situacao').value;
  const quantidadeColunas = config.colunas.length;
  const corpo = el('detalhe-linhas');

  if (linhas.length === 0) {
    corpo.replaceChildren(linhaUnica(config.vazio, quantidadeColunas));
    el('detalhe-total').replaceChildren();
    el('detalhe-contagem').textContent = '';
    return;
  }

  const visiveis = linhas.filter((linha) => {
    if (situacao && linha.situacao !== situacao) return false;
    return palavras.every((palavra) => linha._textoBusca.includes(palavra));
  });

  const filtrando = palavras.length > 0 || Boolean(situacao);
  el('detalhe-contagem').textContent = filtrando
    ? `Mostrando ${inteiro.format(visiveis.length)} de ${inteiro.format(linhas.length)}`
    : `${inteiro.format(linhas.length)} registros`;

  if (visiveis.length === 0) {
    corpo.replaceChildren(linhaUnica('Nada encontrado com essa pesquisa. Confira o que foi digitado ou limpe o filtro.', quantidadeColunas));
    el('detalhe-total').replaceChildren();
    return;
  }

  corpo.replaceChildren(...visiveis.map((linha) => montarLinhaDetalhe(config, linha)));

  // Total do que está visível (cada coluna com "soma")
  const tr = document.createElement('tr');
  const primeiraSoma = config.colunas.findIndex((c) => c.soma);
  const rotulo = celulaTexto(filtrando ? 'Total filtrado' : 'Total', 'esquerda');
  rotulo.colSpan = primeiraSoma;
  tr.append(rotulo);
  config.colunas.slice(primeiraSoma).forEach((coluna) => {
    if (!coluna.soma) {
      tr.append(document.createElement('td'));
      return;
    }
    const soma = visiveis.reduce((total, linha) => total + Number(linha[coluna.soma] || 0), 0);
    tr.append(celulaValor(Math.round(soma * 100) / 100));
  });
  el('detalhe-total').replaceChildren(tr);
}

// Espera a pessoa parar de digitar um instante antes de filtrar
let esperaBusca;
function aoDigitarBusca() {
  clearTimeout(esperaBusca);
  esperaBusca = setTimeout(aplicarFiltroDetalhe, 150);
}

function mostrarDetalhe(config, dados) {
  const t = dados.total;
  el('detalhe-titulo').textContent = config.pessoa(dados).nome;
  el('detalhe-resumo').textContent =
    `${dataBR(dados.periodo.inicio)} a ${dataBR(dados.periodo.fim)}: ` +
    `${config.resumo(t).join(', ')}. Total ${moeda.format(t.valor)}`;

  // Prepara o texto de busca de cada linha uma vez só
  detalheAberto.linhas = config.linhas(dados).map((linha) => ({
    ...linha,
    _textoBusca: normalizar(config.busca(linha).filter((v) => v !== null && v !== undefined).join(' ')),
  }));
  aplicarFiltroDetalhe();
  el('detalhe-busca').focus();

  const avisoLimite = dados.termo
    ? `Mostrando os primeiros ${dados.limite} resultados de cada tipo. Use uma pesquisa mais específica.`
    : 'Mostrando só os primeiros registros. Diminua o período para ver todos.';
  mostrarStatusDetalhe(dados.limite_atingido ? avisoLimite : '', dados.limite_atingido);
}

function mostrarStatusDetalhe(texto, erro = false) {
  el('detalhe-status').textContent = texto;
  el('detalhe-status').classList.toggle('status--erro', erro);
}

// Guarda o que está aberto na janela, para o botão de Excel saber o que baixar
let detalheAberto = null;

async function abrirDetalhe(tipo, codigo, nome, filtrosExtras = {}) {
  const config = DETALHES[tipo];
  detalheAberto = { config, codigo, filtros: { ...filtrosAtuais(), ...filtrosExtras } };
  el('detalhe-baixar').hidden = !config.rotaExcel;
  el('detalhe-titulo').textContent = nome;
  el('detalhe-resumo').textContent = '';
  montarCabecalho(config);
  prepararFiltrosDetalhe(config);
  el('detalhe-linhas').replaceChildren();
  el('detalhe-total').replaceChildren();
  mostrarStatusDetalhe(config.carregando);
  el('detalhe').showModal();

  try {
    const dados = await buscar(config.rota(codigo), detalheAberto.filtros);
    mostrarDetalhe(config, dados);
  } catch (erro) {
    if (erro instanceof ChaveInvalida) return pedirChaveDeNovo();
    console.error(erro);
    mostrarStatusDetalhe(erro.message, true);
  }
}

function pesquisarNaTelaPrincipal(evento) {
  evento.preventDefault();
  const termo = el('pesquisa-termo').value.trim();
  if (termo.length < 2) {
    mostrarStatus('Digite pelo menos 2 caracteres para pesquisar.', true);
    el('pesquisa-termo').focus();
    return;
  }
  mostrarStatus('');
  abrirDetalhe('pesquisa', null, `Resultado para "${termo}"`, { q: termo });
}

async function baixarDetalhe() {
  if (!detalheAberto) return;
  const { config, codigo, filtros } = detalheAberto;
  try {
    await baixarArquivo(config.rotaExcel(codigo), filtros, 'detalhe.xlsx', el('detalhe-baixar'));
  } catch (erro) {
    if (erro instanceof ChaveInvalida) return pedirChaveDeNovo();
    console.error(erro);
    mostrarStatusDetalhe(erro.message, true);
  }
}

async function baixarPainel() {
  const filtros = filtrosAtuais();
  try {
    await baixarArquivo('exportar/excel', filtros, `vendas_${filtros.inicio}_a_${filtros.fim}.xlsx`, el('baixar-painel'));
  } catch (erro) {
    if (erro instanceof ChaveInvalida) return pedirChaveDeNovo();
    console.error(erro);
    mostrarStatus(erro.message, true);
  }
}

// ===== Atualização automática =====
// O PROCFIT grava as vendas ao longo do dia (venda por venda),
// então o painel busca os números de novo sozinho enquanto o período incluir hoje.
const INTERVALO_ATUALIZACAO_MS = 2 * 60 * 1000; // 2 minutos

let timerAtualizacao = null;
let atualizacaoPendente = false; // chegou a hora, mas a janela de detalhe estava aberta
let filtrosCarregados = null;    // período que está na tela agora
let diaDaUltimaCarga = null;     // para perceber a virada da meia-noite
let cargaAtual = 0;              // número da carga mais recente
let carregando = false;

const hojeISO = () => formatarData(new Date());
const horaBR = (data) => data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function periodoIncluiHoje(filtros) {
  const hoje = hojeISO();
  return Boolean(filtros) && filtros.inicio <= hoje && filtros.fim >= hoje;
}

function pararAtualizacao() {
  clearTimeout(timerAtualizacao);
  timerAtualizacao = null;
  atualizacaoPendente = false;
}

// Agenda a próxima rodada. Devolve a hora prevista, ou null se não agendou.
function agendarAtualizacao() {
  clearTimeout(timerAtualizacao);
  timerAtualizacao = null;
  if (!chave.ler() || !periodoIncluiHoje(filtrosCarregados)) return null;
  timerAtualizacao = setTimeout(atualizarSozinho, INTERVALO_ATUALIZACAO_MS);
  return new Date(Date.now() + INTERVALO_ATUALIZACAO_MS);
}

// Passou da meia-noite: quem olhava "até hoje" continua olhando "até hoje".
// Se virou o mês e o início era o dia 1, o início vai para o dia 1 do mês novo.
function acompanharVirada() {
  const hoje = hojeISO();
  if (!diaDaUltimaCarga || diaDaUltimaCarga === hoje || !filtrosCarregados) return;
  if (filtrosCarregados.fim !== diaDaUltimaCarga) return;

  filtrosCarregados.fim = hoje;
  const mesAnterior = diaDaUltimaCarga.slice(0, 7);
  if (mesAnterior !== hoje.slice(0, 7) && filtrosCarregados.inicio === `${mesAnterior}-01`) {
    filtrosCarregados.inicio = `${hoje.slice(0, 7)}-01`;
  }
}

function atualizarSozinho() {
  timerAtualizacao = null;
  // Não mexe na tela enquanto alguém usa a janela de detalhe; atualiza ao fechar
  if (el('detalhe').open) {
    atualizacaoPendente = true;
    return;
  }
  if (carregando) {
    agendarAtualizacao(); // a carga anterior ainda não terminou: tenta na próxima rodada
    return;
  }
  acompanharVirada();
  // Volta os campos para o período que está na tela (caso alguém tenha mexido sem clicar em Atualizar)
  el('inicio').value = filtrosCarregados.inicio;
  el('fim').value = filtrosCarregados.fim;
  carregar({ automatico: true });
}

// "08:43" se for de hoje; "16/09 às 18:20" se for de outro dia
function textoUltimoRegistro(ultimo) {
  if (!ultimo) return null;
  const [data, hora] = ultimo.split(' ');
  const quando = data === hojeISO() ? hora : `${dataBR(data).slice(0, 5)} às ${hora}`;
  return `última venda recebida: ${quando}`;
}

// ===== Versão do painel =====
// Se o painel foi atualizado no servidor, a tela recarrega sozinha (a chave continua guardada na aba).
let versaoPainel = null;

async function painelFoiAtualizado() {
  try {
    const resposta = await fetch('/health', { cache: 'no-store' });
    const { versao } = await resposta.json();
    if (!versao) return false;
    if (!versaoPainel) {
      versaoPainel = versao; // primeira vez: só guarda
      return false;
    }
    return versao !== versaoPainel;
  } catch {
    return false; // API fora do ar: a própria carga mostra o aviso
  }
}

async function carregar({ automatico = false } = {}) {
  if (automatico && await painelFoiAtualizado() && !el('detalhe').open) {
    mostrarStatus('Painel atualizado. Recarregando…');
    window.location.reload();
    return;
  }
  const filtros = filtrosAtuais();
  const minhaCarga = ++cargaAtual;
  carregando = true;
  clearTimeout(timerAtualizacao);
  mostrarStatus(automatico ? 'Atualizando…' : 'Carregando…');

  try {
    // As consultas rodam ao mesmo tempo
    const [resumo, origens, porVendedor, porOperador] = await Promise.all([
      buscar('resumo', filtros),
      buscar('por-origem', filtros),
      buscar('por-vendedor', filtros),
      buscar('por-operador', filtros),
    ]);
    // Se outra carga começou depois desta (ex.: clicou em Atualizar com outras datas), ignora esta
    if (minhaCarga !== cargaAtual) return;

    mostrarResumo(resumo);
    mostrarOrigens(origens);
    mostrarComposicao(porVendedor.total);
    mostrarTabela(TABELA_VENDEDORES, porVendedor.vendedores, porVendedor.total);
    mostrarTabela(TABELA_CAIXA, porOperador.operadores, porOperador.total);

    filtrosCarregados = { ...filtros };
    diaDaUltimaCarga = hojeISO();
    const proxima = agendarAtualizacao();
    const partes = [`Atualizado às ${horaBR(new Date())}`];
    const ultimo = textoUltimoRegistro(resumo.ultimo_registro);
    if (ultimo) partes.push(ultimo);
    partes.push(proxima
      ? `próxima atualização às ${horaBR(proxima)}`
      : 'atualização automática só quando o período inclui hoje');
    mostrarStatus(partes.join(' · '));
  } catch (erro) {
    if (minhaCarga !== cargaAtual) return;
    if (erro instanceof ChaveInvalida) {
      pararAtualizacao();
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    console.error(erro);
    // Os números da última carga continuam na tela; tenta de novo na próxima rodada
    if (!filtrosCarregados) filtrosCarregados = { ...filtros };
    const proxima = agendarAtualizacao();
    mostrarStatus(proxima
      ? `${erro.message} Nova tentativa às ${horaBR(proxima)}.`
      : erro.message, true);
  } finally {
    if (minhaCarga === cargaAtual) carregando = false;
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', () => {
  const hoje = new Date();
  el('inicio').value = formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  el('fim').value = formatarData(hoje);

  el('form-chave').addEventListener('submit', (evento) => {
    evento.preventDefault();
    chave.salvar(el('campo-chave').value.trim());
    el('campo-chave').value = '';
    mostrarPainel();
  });

  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregar();
  });

  el('detalhe-fechar').addEventListener('click', () => el('detalhe').close());
  // Ao fechar a janela (botão ou Esc), faz a atualização que ficou esperando
  el('detalhe').addEventListener('close', () => {
    if (!atualizacaoPendente) return;
    atualizacaoPendente = false;
    atualizarSozinho();
  });
  el('detalhe-baixar').addEventListener('click', baixarDetalhe);
  el('detalhe-busca').addEventListener('input', aoDigitarBusca);
  el('detalhe-situacao').addEventListener('change', aplicarFiltroDetalhe);
  el('baixar-painel').addEventListener('click', baixarPainel);
  el('form-pesquisa').addEventListener('submit', pesquisarNaTelaPrincipal);

  // Cartões que abrem listas
  document.querySelectorAll('[data-detalhe]').forEach((cartao) => {
    cartao.addEventListener('click', () => {
      const titulo = cartao.closest('.numero')?.querySelector('dt')?.textContent || 'Detalhe';
      abrirDetalhe(cartao.dataset.detalhe, null, titulo);
    });
  });

  el('trocar-chave').addEventListener('click', () => {
    pararAtualizacao();
    chave.apagar();
    mostrarEntrada();
  });

  if (chave.ler()) mostrarPainel();
  else mostrarEntrada();
});
