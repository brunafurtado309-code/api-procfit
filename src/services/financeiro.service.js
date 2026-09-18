// Regras do financeiro: valida os filtros antes de ir ao banco.

const AppError = require('../utils/AppError');
const repo = require('../repositories/financeiro.repository');

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const SITUACOES = ['aberto', 'parcial', 'quitado', 'todos'];
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;

// Aqui a data é OPCIONAL (diferente de vendas): sem datas, mostra tudo em aberto
function validarData(valor, nome) {
  if (valor === undefined || valor === '') return null;
  if (!FORMATO_DATA.test(valor)) {
    throw new AppError(`Parâmetro "${nome}" deve estar no formato AAAA-MM-DD`);
  }
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) {
    throw new AppError(`Data inválida em "${nome}"`);
  }
  return valor;
}

function numeroOpcional(valor, nome) {
  if (valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) {
    throw new AppError(`"${nome}" deve ser um número inteiro`);
  }
  return numero;
}

function montarFiltros(query) {
  const inicio = validarData(query.inicio, 'inicio');
  const fim = validarData(query.fim, 'fim');
  if (inicio && fim && fim < inicio) {
    throw new AppError('"fim" não pode ser anterior a "inicio"');
  }

  const situacao = query.situacao ?? 'aberto';
  if (!SITUACOES.includes(situacao)) {
    throw new AppError(`"situacao" deve ser: ${SITUACOES.join(', ')}`);
  }

  let limite = LIMITE_PADRAO;
  if (query.limite !== undefined && query.limite !== '') {
    limite = Number(query.limite);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw new AppError(`"limite" deve ser entre 1 e ${LIMITE_MAXIMO}`);
    }
  }

  let pagina = 1;
  if (query.pagina !== undefined && query.pagina !== '') {
    pagina = Number(query.pagina);
    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new AppError('"pagina" deve ser 1 ou mais');
    }
  }

  const busca = (query.busca ?? '').trim();

  return {
    inicio,
    fim,
    situacao,
    empresa: numeroOpcional(query.empresa, 'empresa'),
    modalidade: numeroOpcional(query.modalidade, 'modalidade'),
    busca: busca === '' ? null : busca,
    limite,
    pagina,
  };
}

const resumo = (query) => repo.resumo(montarFiltros(query));
const porFaixaAtraso = (query) => repo.porFaixaAtraso(montarFiltros(query));
const titulos = (query) => repo.titulos(montarFiltros(query));

const MESES_PADRAO = 12;
const MESES_MAXIMO = 60;

function fichaCliente(query, params) {
  const entidade = Number(params.entidade);
  if (!Number.isInteger(entidade) || entidade <= 0) {
    throw new AppError('Código do cliente inválido');
  }

  let meses = MESES_PADRAO;
  if (query.meses !== undefined && query.meses !== '') {
    meses = Number(query.meses);
    if (!Number.isInteger(meses) || meses < 1 || meses > MESES_MAXIMO) {
      throw new AppError(`"meses" deve ser entre 1 e ${MESES_MAXIMO}`);
    }
  }

  return repo.fichaCliente(entidade, { meses });
}

module.exports = { resumo, porFaixaAtraso, titulos, fichaCliente };
