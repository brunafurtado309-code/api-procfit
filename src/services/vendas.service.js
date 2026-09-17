// Regras de negócio de vendas: valida os filtros antes de ir ao banco.

const AppError = require('../utils/AppError');
const repo = require('../repositories/vendas.repository');

const MAX_DIAS = 366;          // protege o banco de consultas gigantes
const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 100;
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

function validarData(valor, nome) {
  if (!valor || !FORMATO_DATA.test(valor)) {
    throw new AppError(`Parâmetro "${nome}" é obrigatório no formato AAAA-MM-DD`);
  }
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  // Confere se a data existe de verdade (ex.: 2026-02-30 é recusada)
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) {
    throw new AppError(`Data inválida em "${nome}"`);
  }
  return data;
}

function montarFiltros(query) {
  const inicio = validarData(query.inicio, 'inicio');
  const fim = validarData(query.fim, 'fim');

  if (fim < inicio) {
    throw new AppError('"fim" não pode ser anterior a "inicio"');
  }

  const dias = Math.round((fim - inicio) / 86400000) + 1;
  if (dias > MAX_DIAS) {
    throw new AppError(`Período máximo é de ${MAX_DIAS} dias`);
  }

  let empresa = null;
  if (query.empresa !== undefined && query.empresa !== '') {
    empresa = Number(query.empresa);
    if (!Number.isInteger(empresa) || empresa <= 0) {
      throw new AppError('"empresa" deve ser um número inteiro');
    }
  }

  return { inicio: query.inicio, fim: query.fim, empresa };
}

function montarLimite(valor) {
  if (valor === undefined || valor === '') return LIMITE_PADRAO;
  const limite = Number(valor);
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
    throw new AppError(`"limite" deve ser entre 1 e ${LIMITE_MAXIMO}`);
  }
  return limite;
}

const resumo = (query) => repo.resumo(montarFiltros(query));
const porDia = (query) => repo.porDia(montarFiltros(query));
const porLoja = (query) => repo.porLoja(montarFiltros(query));
const porOrigem = (query) => repo.porOrigem(montarFiltros(query));
// Vendedores + linha de total calculada aqui (regra de negócio fica no service).
const COLUNAS_SOMADAS = [
  'notas_valor', 'notas_qtd',
  'devolucoes_valor', 'devolucoes_qtd',
  'caixa_valor', 'caixa_qtd',
  'devolucoes_caixa_valor', 'devolucoes_caixa_qtd',
  'liquido',
];
const arredondar = (n) => Math.round(n * 100) / 100;

async function porVendedor(query) {
  const vendedores = await repo.porVendedor(montarFiltros(query));
  const total = {};
  for (const coluna of COLUNAS_SOMADAS) {
    total[coluna] = arredondar(vendedores.reduce((soma, v) => soma + Number(v[coluna] || 0), 0));
  }
  return { vendedores, total };
}

// Notas de um vendedor, com totais por situação.
async function notasDoVendedor(query, params) {
  const filtros = montarFiltros(query);
  const codigo = Number(params.vendedor);
  if (!Number.isInteger(codigo) || codigo < 0) {
    throw new AppError('Código de vendedor inválido');
  }

  const [notas, nome] = await Promise.all([
    repo.notasDoVendedor(filtros, codigo),
    codigo === 0 ? Promise.resolve(null) : repo.nomeDoVendedor(codigo),
  ]);

  const contarSituacao = (situacao) => notas.filter((n) => n.situacao === situacao).length;
  const somarSituacao = (situacao) =>
    arredondar(notas.filter((n) => n.situacao === situacao).reduce((s, n) => s + Number(n.valor || 0), 0));

  return {
    vendedor: { codigo, nome: codigo === 0 ? 'Sem vendedor informado' : nome ?? `Vendedor ${codigo}` },
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    limite_atingido: notas.length >= repo.LIMITE_NOTAS,
    total: {
      faturadas_qtd: contarSituacao('Faturada'),
      faturadas_valor: somarSituacao('Faturada'),
      canceladas_qtd: contarSituacao('Cancelada'),
      devolucoes_qtd: contarSituacao('Devolução'),
      devolucoes_valor: somarSituacao('Devolução'),
      valor: arredondar(notas.reduce((s, n) => s + Number(n.valor || 0), 0)),
    },
    notas,
  };
}

// Caixa por operador + linha de total
const COLUNAS_CAIXA = [
  'caixa_valor', 'caixa_qtd', 'devolucoes_caixa_valor', 'devolucoes_caixa_qtd', 'liquido',
];

async function porOperador(query) {
  const operadores = await repo.porOperador(montarFiltros(query));
  const total = {};
  for (const coluna of COLUNAS_CAIXA) {
    total[coluna] = arredondar(operadores.reduce((soma, o) => soma + Number(o[coluna] || 0), 0));
  }
  return { operadores, total };
}

// Cupons de um operador, com totais por situação
async function cuponsDoOperador(query, params) {
  const filtros = montarFiltros(query);
  const codigo = Number(params.operador);
  if (!Number.isInteger(codigo) || codigo < 0) {
    throw new AppError('Código de operador inválido');
  }

  const [cupons, nome] = await Promise.all([
    repo.cuponsDoOperador(filtros, codigo),
    codigo === 0 ? Promise.resolve(null) : repo.nomeDoOperador(codigo),
  ]);

  const daSituacao = (situacao) => cupons.filter((c) => c.situacao === situacao);
  const somar = (lista) => arredondar(lista.reduce((s, c) => s + Number(c.valor || 0), 0));

  return {
    operador: { codigo, nome: codigo === 0 ? 'Sem operador informado' : nome ?? `Operador ${codigo}` },
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    limite_atingido: cupons.length >= repo.LIMITE_NOTAS,
    total: {
      emitidos_qtd: daSituacao('Emitido').length,
      emitidos_valor: somar(daSituacao('Emitido')),
      cancelados_qtd: daSituacao('Cancelado').length,
      devolucoes_qtd: daSituacao('Devolução').length,
      devolucoes_valor: somar(daSituacao('Devolução')),
      valor: somar(cupons),
    },
    cupons,
  };
}

// ===== Listas dos cartões (todas as notas, cupons, descontos, devoluções) =====
const somarValores = (lista, campo = 'valor') =>
  arredondar(lista.reduce((s, item) => s + Number(item[campo] || 0), 0));

function totaisMistos(notas, cupons) {
  const todos = [...notas, ...cupons];
  return {
    notas_qtd: notas.length,
    cupons_qtd: cupons.length,
    bruto: somarValores(todos, 'bruto'),
    desconto: somarValores(todos, 'desconto'),
    valor: somarValores(todos),
  };
}

async function listaMista(query, { titulo, notas: opcoesNotas, cupons: opcoesCupons }) {
  const filtros = montarFiltros(query);
  const limite = repo.LIMITE_NOTAS;
  const [notas, cupons] = await Promise.all([
    opcoesNotas ? repo.notasDoVendedor(filtros, null, limite, null, opcoesNotas) : [],
    opcoesCupons ? repo.cuponsDoOperador(filtros, null, limite, null, opcoesCupons) : [],
  ]);
  return {
    titulo,
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    limite_atingido: notas.length >= limite || cupons.length >= limite,
    total: totaisMistos(notas, cupons),
    notas,
    cupons,
  };
}

const todasNotas = (query) =>
  listaMista(query, { titulo: 'Notas fiscais do período', notas: { categoria: 'NOTA' } });
const todosCupons = (query) =>
  listaMista(query, { titulo: 'Cupons do período', cupons: { categoria: 'CAIXA' } });
const listaDevolucoes = (query) =>
  listaMista(query, {
    titulo: 'Devoluções do período',
    notas: { categoria: 'DEVOLUCAO' },
    cupons: { categoria: 'DEVOLUCAO_CAIXA' },
  });
const listaDescontos = (query) =>
  listaMista(query, {
    titulo: 'Vendas com desconto',
    notas: { categoria: 'NOTA', comDesconto: true },
    cupons: { categoria: 'CAIXA', comDesconto: true },
  });

// Produtos de uma nota ou cupom
const CATEGORIAS = { nota: ['NOTA', 'DEVOLUCAO'], cupom: ['CAIXA', 'DEVOLUCAO_CAIXA'] };

function inteiroPositivo(valor, nome, { zero = false } = {}) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < (zero ? 0 : 1)) {
    throw new AppError(`"${nome}" inválido`);
  }
  return numero;
}

async function itensDoDocumento(query) {
  const filtros = montarFiltros(query);
  const tipo = query.tipo;
  if (!CATEGORIAS[tipo]) throw new AppError('"tipo" deve ser nota ou cupom');
  if (!CATEGORIAS[tipo].includes(query.categoria)) throw new AppError('"categoria" inválida');

  const doc = {
    tipo,
    categoria: query.categoria,
    empresa: inteiroPositivo(query.empresa, 'empresa'),
    numero: inteiroPositivo(query.numero, 'numero', { zero: true }),
    original: query.original === '1',
  };
  if (tipo === 'cupom') {
    doc.caixa = inteiroPositivo(query.caixa, 'caixa', { zero: true });
    doc.venda = inteiroPositivo(query.venda, 'venda', { zero: true });
  }

  const itens = await repo.itensDoDocumento(filtros, doc);
  return {
    itens,
    total: {
      bruto: somarValores(itens, 'bruto'),
      desconto: somarValores(itens, 'desconto'),
      valor: somarValores(itens),
    },
  };
}

// Pesquisa de notas e cupons no período
const LIMITE_PESQUISA = 200;

async function pesquisar(query) {
  const filtros = montarFiltros(query);
  const termo = String(query.q ?? '').trim().replace(/\s+/g, ' ');

  if (termo.length < 2) throw new AppError('Digite pelo menos 2 caracteres para pesquisar');
  if (termo.length > 60) throw new AppError('A pesquisa pode ter no máximo 60 caracteres');

  const [notas, cupons] = await Promise.all([
    repo.notasDoVendedor(filtros, null, LIMITE_PESQUISA, termo),
    repo.cuponsDoOperador(filtros, null, LIMITE_PESQUISA, termo),
  ]);

  const somar = (lista) => arredondar(lista.reduce((s, item) => s + Number(item.valor || 0), 0));

  return {
    termo,
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    limite: LIMITE_PESQUISA,
    limite_atingido: notas.length >= LIMITE_PESQUISA || cupons.length >= LIMITE_PESQUISA,
    total: { ...totaisMistos(notas, cupons), valor: arredondar(somar(notas) + somar(cupons)) },
    notas,
    cupons,
  };
}

const topProdutos = (query) =>
  repo.topProdutos(montarFiltros(query), montarLimite(query.limite));

module.exports = {
  resumo, porDia, porLoja, porOrigem, porVendedor, notasDoVendedor,
  porOperador, cuponsDoOperador, pesquisar, topProdutos,
  todasNotas, todosCupons, listaDevolucoes, listaDescontos, itensDoDocumento,
  montarFiltros, montarLimite,
};
