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
  td.className = 'esquerda';
  td.textContent = linha.cliente || 'Não identificado';
  if (linha.fantasia && linha.fantasia !== linha.cliente) {
    const fantasia = document.createElement('span');
    fantasia.className = 'fantasia';
    fantasia.textContent = linha.fantasia;
    td.append(fantasia);
  }
  return td;
}

// Cada tipo de detalhe: rota, colunas e textos
const DETALHES = {
  notas: {
    rota: (codigo) => `vendedores/${encodeURIComponent(codigo)}/notas`,
    rotaExcel: (codigo) => `vendedores/${encodeURIComponent(codigo)}/notas/excel`,
    pessoa: (d) => d.vendedor,
    linhas: (d) => d.notas,
    carregando: 'Carregando notas…',
    vazio: 'Nenhuma nota deste vendedor no período.',
    resumo: (t) => [
      contar(t.faturadas_qtd, 'nota faturada', 'notas faturadas'),
      contar(t.canceladas_qtd, 'cancelada', 'canceladas'),
      contar(t.devolucoes_qtd, 'devolução', 'devoluções'),
    ],
    colunas: [
      { titulo: 'Data', celula: (n) => celulaTexto(dataBR(n.data), 'sem-quebra') },
      { titulo: 'Situação', esquerda: true, celula: (n) => celulaSituacao(n.situacao) },
      { titulo: 'Nº da nota', celula: (n) => celulaTexto(n.nota) },
      { titulo: 'Nº do pedido', celula: (n) => celulaTexto(n.pedido) },
      { titulo: 'Cód. cliente', celula: (n) => celulaTexto(n.codigo_cliente) },
      { titulo: 'Cliente', esquerda: true, celula: celulaCliente },
      { titulo: 'Valor', celula: (n) => celulaValor(n.valor) },
    ],
  },
  cupons: {
    rota: (codigo) => `operadores/${encodeURIComponent(codigo)}/cupons`,
    rotaExcel: (codigo) => `operadores/${encodeURIComponent(codigo)}/cupons/excel`,
    pessoa: (d) => d.operador,
    linhas: (d) => d.cupons,
    carregando: 'Carregando cupons…',
    vazio: 'Nenhum cupom deste operador no período.',
    resumo: (t) => [
      contar(t.emitidos_qtd, 'cupom emitido', 'cupons emitidos'),
      contar(t.cancelados_qtd, 'cancelado', 'cancelados'),
      contar(t.devolucoes_qtd, 'devolução', 'devoluções'),
    ],
    colunas: [
      { titulo: 'Data', celula: (c) => celulaTexto(dataBR(c.data), 'sem-quebra') },
      { titulo: 'Hora', celula: (c) => celulaTexto(c.hora) },
      { titulo: 'Situação', esquerda: true, celula: (c) => celulaSituacao(c.situacao) },
      { titulo: 'Caixa', celula: (c) => celulaTexto(c.caixa) },
      { titulo: 'Nº do cupom', celula: (c) => celulaTexto(c.cupom) },
      { titulo: 'Vendedor', esquerda: true, celula: (c) => celulaTexto(c.vendedor || 'Não informado', 'esquerda') },
      { titulo: 'Cód. cliente', celula: (c) => celulaTexto(c.codigo_cliente) },
      { titulo: 'Cliente', esquerda: true, celula: celulaCliente },
      { titulo: 'Valor', celula: (c) => celulaValor(c.valor) },
    ],
  },
};

function montarCabecalho(config) {
  const tr = document.createElement('tr');
  for (const coluna of config.colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = coluna.titulo;
    if (coluna.esquerda) th.className = 'esquerda';
    tr.append(th);
  }
  el('detalhe-cabecalho').replaceChildren(tr);
}

function montarLinhaDetalhe(config, linha) {
  const tr = document.createElement('tr');
  if (SITUACAO_CLASSE[linha.situacao] === 'cancelada') tr.className = 'linha-cancelada';
  for (const coluna of config.colunas) tr.append(coluna.celula(linha));
  return tr;
}

function mostrarDetalhe(config, dados) {
  const t = dados.total;
  const linhas = config.linhas(dados);
  el('detalhe-titulo').textContent = config.pessoa(dados).nome;
  el('detalhe-resumo').textContent =
    `${dataBR(dados.periodo.inicio)} a ${dataBR(dados.periodo.fim)}: ` +
    `${config.resumo(t).join(', ')}. Total ${moeda.format(t.valor)}`;

  const corpo = el('detalhe-linhas');
  const quantidadeColunas = config.colunas.length;

  if (linhas.length === 0) {
    const tr = document.createElement('tr');
    const td = celulaTexto(config.vazio, 'vazio');
    td.colSpan = quantidadeColunas;
    tr.append(td);
    corpo.replaceChildren(tr);
    el('detalhe-total').replaceChildren();
  } else {
    corpo.replaceChildren(...linhas.map((linha) => montarLinhaDetalhe(config, linha)));
    const tr = document.createElement('tr');
    const rotulo = celulaTexto('Total', 'esquerda');
    rotulo.colSpan = quantidadeColunas - 1;
    tr.append(rotulo, celulaValor(t.valor));
    el('detalhe-total').replaceChildren(tr);
  }

  mostrarStatusDetalhe(
    dados.limite_atingido ? 'Mostrando só os primeiros registros. Diminua o período para ver todos.' : '',
    dados.limite_atingido,
  );
}

function mostrarStatusDetalhe(texto, erro = false) {
  el('detalhe-status').textContent = texto;
  el('detalhe-status').classList.toggle('status--erro', erro);
}

// Guarda o que está aberto na janela, para o botão de Excel saber o que baixar
let detalheAberto = null;

async function abrirDetalhe(tipo, codigo, nome) {
  const config = DETALHES[tipo];
  detalheAberto = { config, codigo, filtros: filtrosAtuais() };
  el('detalhe-titulo').textContent = nome;
  el('detalhe-resumo').textContent = '';
  montarCabecalho(config);
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

async function carregar() {
  const filtros = { inicio: el('inicio').value, fim: el('fim').value };
  mostrarStatus('Carregando…');

  try {
    // As consultas rodam ao mesmo tempo
    const [resumo, origens, porVendedor, porOperador] = await Promise.all([
      buscar('resumo', filtros),
      buscar('por-origem', filtros),
      buscar('por-vendedor', filtros),
      buscar('por-operador', filtros),
    ]);
    mostrarResumo(resumo);
    mostrarOrigens(origens);
    mostrarComposicao(porVendedor.total);
    mostrarTabela(TABELA_VENDEDORES, porVendedor.vendedores, porVendedor.total);
    mostrarTabela(TABELA_CAIXA, porOperador.operadores, porOperador.total);
    mostrarStatus(`Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`);
  } catch (erro) {
    if (erro instanceof ChaveInvalida) {
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    console.error(erro);
    mostrarStatus(erro.message, true);
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
  el('detalhe-baixar').addEventListener('click', baixarDetalhe);
  el('baixar-painel').addEventListener('click', baixarPainel);

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    mostrarEntrada();
  });

  if (chave.ler()) mostrarPainel();
  else mostrarEntrada();
});
