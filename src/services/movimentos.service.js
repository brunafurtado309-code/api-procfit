// Regras de entradas e saídas: valida os filtros, dá nome a cada tipo de movimento e exporta.
// Só quantidades: nenhum preço ou custo sai deste módulo.

const AppError = require('../utils/AppError');
const repo = require('../repositories/movimentos.repository');
const { empresas: listaEmpresas } = require('../repositories/logistica.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA = 24 * 60 * 60 * 1000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Nome do movimento pela tela de origem (TAB_MASTER_ORIGEM) e o tipo (ver movimentos.repository.js).
// Para dar nome a um tipo novo, é só acrescentar aqui.
const TAB_TRANSFERENCIA = repo.TAB_TRANSFERENCIA;

// Os de out/2026 foram nomeados pelo que os lançamentos mostram: o tipo 4 traz a indústria do grupo
// e grandes quantidades; o tipo 20 é a nota de venda cancelada voltando ao estoque (conferido no
// cancelamento da nota 10579); o tipo 19 ainda não foi conferido, por isso fica "Entrada por nota".
const NOMES_POR_ORIGEM = {
  [repo.TAB_NOTA_COMPRA]: { 2: 'Compra (nota de entrada)', entrada: 'Entrada por nota de compra' },
  753289: { 1: 'Venda por nota', saida: 'Saída por nota fiscal' },
  [repo.TAB_CAIXA]: { saida: 'Venda no caixa', entrada: 'Devolução no caixa' },
  [TAB_TRANSFERENCIA]: { 4: 'Transferência recebida' },
  [repo.TAB_CANCELAMENTO_NOTA]: { entrada: 'Nota de venda cancelada' },
  773844: { 19: 'Entrada por nota' },
};

function nomeDoMovimento(m) {
  const sentido = Number(m.entrada) > 0 ? 'entrada' : 'saida';
  const nomes = NOMES_POR_ORIGEM[m.origem] ?? {};
  return nomes[m.tipo] ?? nomes[sentido] ?? `${sentido === 'entrada' ? 'Outra entrada' : 'Outra saída'} (tipo ${m.tipo})`;
}

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

// Período padrão: últimos 30 dias, no máximo 1 ano
function montarFiltros(query) {
  let inicio = data(query.inicio, 'inicio');
  let fim = data(query.fim, 'fim');
  if (!fim) fim = iso(new Date());
  if (!inicio) inicio = iso(new Date(new Date(`${fim}T12:00:00`).getTime() - 29 * UM_DIA));
  if (inicio > fim) throw new AppError('A data inicial não pode ser depois da final');
  const dias = Math.round((new Date(`${fim}T12:00:00`) - new Date(`${inicio}T12:00:00`)) / UM_DIA) + 1;
  if (dias > 366) throw new AppError('Escolha um período de no máximo 1 ano');

  const filtros = { inicio, fim, empresa: null };
  if (query.empresa) {
    const empresa = Number(query.empresa);
    if (!Number.isInteger(empresa) || empresa <= 0) throw new AppError('"empresa" deve ser um número');
    filtros.empresa = empresa;
  }
  const busca = String(query.busca ?? '').trim().slice(0, 60);
  if (busca) filtros.busca = busca;
  return filtros;
}

// Em que grupo cai uma entrada: nota fiscal que chegou, transferência entre empresas, devolução
// ou nota de venda cancelada. Usado na ficha do produto e na lista de notas.
function grupoDaEntrada(m) {
  if (m.origem === repo.TAB_CANCELAMENTO_NOTA) return 'cancelada';
  if (m.devolucao_nota != null || m.origem === repo.TAB_CAIXA) return 'devolucao';
  if (m.origem === TAB_TRANSFERENCIA) return 'transferencia';
  return 'nota';
}

const produtos = (query) => repo.produtos(montarFiltros(query));

// ===== Notas de entrada =====
// Tipo curto (a etiqueta da lista) e quem lançou, já em texto para a tela e o Excel.
// O login ADMIN vem sem nome: na nota de compra é a nota que chegou sozinha pelo eDoc.
// Quem finaliza a nota no PROCFIT não fica gravado no banco (conferido em out/2026).
const TIPO_CURTO = {
  compra: 'Compra',
  nota: 'Outra entrada',
  transferencia: 'Transferência',
  devolucao: 'Devolução',
  cancelada: 'Venda cancelada',
};

function prepararNota(m) {
  let grupo = grupoDaEntrada(m);
  if (grupo === 'nota' && m.origem === repo.TAB_NOTA_COMPRA) grupo = 'compra';
  let lancadaPor = null;
  let lancadaEm = null;
  if (grupo === 'compra' && m.nota_lancada_em) {
    lancadaPor = m.nota_lancada_por ?? 'eDoc (automático)';
    lancadaEm = m.nota_lancada_em;
  } else if (grupo === 'devolucao' && m.devolucao_lancada_em) {
    lancadaPor = m.devolucao_lancada_por ?? 'login genérico (ADMIN)';
    lancadaEm = m.devolucao_lancada_em;
  } else if (grupo === 'cancelada' && m.cancelada_em) {
    lancadaPor = m.cancelada_por ?? 'login genérico (ADMIN)';
    lancadaEm = m.cancelada_em;
  }
  const doCliente = grupo === 'devolucao' || grupo === 'cancelada';
  const noCaixa = m.origem === repo.TAB_CAIXA;
  return {
    // o que a tela devolve para abrir os produtos da nota
    origem: m.origem,
    registro: m.registro,
    empresa: m.empresa,
    documento: m.documento,
    entidade: m.entidade,
    dia: m.dia ?? null,
    // o que aparece
    grupo,
    tipo: noCaixa ? 'Devolução no caixa' : TIPO_CURTO[grupo],
    sem_nota: noCaixa ? 'cupons do dia' : 'sem número',
    detalhe: grupo === 'nota' ? nomeDoMovimento({ ...m, entrada: 1 }) : null,
    quando: m.quando,
    nota: m.nota_compra ?? m.devolucao_nota ?? m.documento ?? null,
    nota_original: grupo === 'devolucao' && m.devolucao_nota != null ? m.documento : null,
    nome_empresa: m.nome_empresa || `Empresa ${m.empresa}`,
    quem_enviou: m.nome_entidade || null,
    quem_enviou_rotulo: doCliente ? 'cliente' : 'fornecedor',
    itens: m.itens,
    quantidade: m.quantidade,
    lancada_por: lancadaPor,
    lancada_em: lancadaEm,
  };
}

async function notas(query) {
  const filtros = montarFiltros(query);
  const lista = (await repo.notas(filtros)).map(prepararNota);
  return { lista, limite: repo.LIMITE_NOTAS, cortada: lista.length >= repo.LIMITE_NOTAS };
}

function numeroOuNulo(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new AppError(`"${nome}" deve ser um número`);
  return n;
}

async function itensDaNota(query) {
  const nota = {
    origem: numeroOuNulo(query.origem, 'origem'),
    registro: numeroOuNulo(query.registro, 'registro'),
    documento: numeroOuNulo(query.documento, 'documento'),
    entidade: numeroOuNulo(query.entidade, 'entidade'),
    empresa: numeroOuNulo(query.empresa_nota, 'empresa_nota'),
    dia: data(query.dia, 'dia'),
  };
  if (nota.origem === null || nota.empresa === null) throw new AppError('Nota inválida');
  return repo.itensDaNota(nota, montarFiltros(query));
}

async function exportarNotas(query) {
  const filtros = montarFiltros(query);
  const lista = (await repo.notas(filtros)).map(prepararNota).map((n) => ({
    ...n,
    quando: n.quando ? n.quando.slice(0, 16).replace('T', ' ') : '',
    lancada: n.lancada_por ? `${n.lancada_por}${n.lancada_em ? ` em ${n.lancada_em.slice(0, 16)}` : ''}` : '',
  }));
  const dataBR = (d) => String(d).split('-').reverse().join('/');
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Notas de entrada', {
    titulo: 'Notas de entrada no estoque | Belo Norte',
    subtitulo: `${lista.length} notas · de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`
      + `${filtros.empresa ? ` · empresa ${filtros.empresa}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''}`,
    colunas: [
      { titulo: 'Entrada no estoque', chave: 'quando', largura: 18 },
      { titulo: 'Tipo', chave: 'tipo', largura: 16 },
      { titulo: 'Nota', chave: 'nota', tipo: 'codigo', largura: 12 },
      { titulo: 'Fornecedor / cliente', chave: 'quem_enviou', largura: 40 },
      { titulo: 'Empresa', chave: 'nome_empresa', largura: 24 },
      { titulo: 'Produtos', chave: 'itens', tipo: 'inteiro', largura: 10 },
      { titulo: 'Quantidade', chave: 'quantidade', tipo: 'inteiro', largura: 12 },
      { titulo: 'Lançada por', chave: 'lancada', largura: 36 },
    ],
    linhas: lista,
  });
  return { workbook, nomeArquivo: `notas_de_entrada_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}
const empresas = () => listaEmpresas();

async function movimentos(query, params) {
  const codigo = Number(params.produto);
  if (!Number.isInteger(codigo) || codigo <= 0) throw new AppError('Código do produto inválido');
  const dados = await repo.movimentos(codigo, montarFiltros(query));
  if (!dados.produto) throw new AppError(`Produto ${codigo} não encontrado`, 404);
  // Cada entrada num grupo: nota fiscal que chegou, transferência entre empresas, devolução ou
  // nota de venda cancelada. Quem está no lançamento é quem mandou a mercadoria (fornecedor ou
  // empresa do grupo) ou, na devolução e no cancelamento, o cliente da venda.
  dados.entradas = dados.entradas.map(({ entidade, ...m }) => {
    const grupo = grupoDaEntrada(m);
    const doCliente = grupo === 'devolucao' || grupo === 'cancelada';
    // O motivo vem como "CANCELAMENTO DE NOTA MOTIVO:DESACORDO COMERCIAL": fica só "Desacordo comercial"
    if (m.motivo_cancelamento) {
      const motivo = m.motivo_cancelamento.replace(/^.*MOTIVO\s*:\s*/i, '').trim().toLowerCase();
      m.motivo_cancelamento = motivo ? motivo[0].toUpperCase() + motivo.slice(1) : null;
    }
    return {
      ...m,
      grupo,
      nome: m.devolucao_nota != null ? 'Devolução de venda' : nomeDoMovimento(m),
      [doCliente ? 'cliente' : 'fornecedor']: entidade,
    };
  });
  return dados;
}

async function exportar(query) {
  const filtros = montarFiltros(query);
  const { lista } = await repo.produtos(filtros);
  const dataBR = (d) => String(d).split('-').reverse().join('/');
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Entradas e saídas', {
    titulo: 'Entradas e saídas do estoque | Belo Norte',
    subtitulo: `${lista.length} produtos · de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`
      + `${filtros.empresa ? ` · empresa ${filtros.empresa}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''}`,
    colunas: [
      { titulo: 'Código', chave: 'produto', tipo: 'codigo', largura: 9 },
      { titulo: 'Produto', chave: 'descricao', largura: 48 },
      { titulo: 'Entrou', chave: 'entrou', tipo: 'inteiro', largura: 12 },
      { titulo: 'Saiu', chave: 'saiu', tipo: 'inteiro', largura: 12 },
      { titulo: 'Saldo hoje', chave: 'saldo', tipo: 'inteiro', largura: 12 },
      { titulo: 'Movimentos', chave: 'movimentos', tipo: 'inteiro', largura: 12 },
    ],
    linhas: lista,
  });
  return { workbook, nomeArquivo: `entradas_e_saidas_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

module.exports = { produtos, empresas, movimentos, exportar, notas, itensDaNota, exportarNotas };
