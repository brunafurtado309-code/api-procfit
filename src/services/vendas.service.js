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

const topProdutos = (query) =>
  repo.topProdutos(montarFiltros(query), montarLimite(query.limite));

module.exports = {
  resumo, porDia, porLoja, porOrigem, porVendedor, topProdutos, montarFiltros, montarLimite,
};
