// Regras do módulo precificação. Cada passo da construção acrescenta as suas aqui.

const AppError = require('../utils/AppError');
const repo = require('../repositories/precificacao.repository');

// Períodos que a tela oferece (dias para trás, a partir de hoje)
const PERIODOS = [30, 60, 90, 180];
const PERIODO_PADRAO = 90;

// Nota de mercadoria sem entrada há mais dias que isto vira atraso (laranja na tela)
const PRAZO_ENTRADA_DIAS = 3;

const SITUACOES = ['parada', 'nao_lancada', 'entrou', 'sem_entrada'];

function periodo(valor) {
  if (valor === undefined || valor === null || valor === '') return PERIODO_PADRAO;
  const dias = Number(valor);
  if (!PERIODOS.includes(dias)) throw new AppError(`"dias" deve ser: ${PERIODOS.join(', ')}`);
  return dias;
}

const numero = (v) => (v == null ? null : Number(v));

async function notas(query) {
  const filtros = { dias: periodo(query.dias) };
  const { resumo, compras, xml } = await repo.notas(filtros);

  // Resumo sempre com as quatro situações, mesmo as que vieram vazias
  const porSituacao = Object.fromEntries(SITUACOES.map((s) => [s, {
    notas: 0, valor: 0, dias_medio: null, dias_maximo: null, atrasadas: 0,
  }]));
  for (const r of resumo) {
    porSituacao[r.situacao] = {
      ...porSituacao[r.situacao],
      notas: Number(r.notas) || 0,
      valor: Number(r.valor) || 0,
      dias_medio: numero(r.dias_medio),
      dias_maximo: numero(r.dias_maximo),
    };
  }

  // Atraso só existe para o que deveria entrar no estoque e ainda não entrou
  const atrasada = (n) => n.dias > PRAZO_ENTRADA_DIAS;
  const listas = { parada: [], entrou: [], sem_entrada: [], nao_lancada: [] };
  for (const n of compras) {
    const linha = { ...n, valor: Number(n.valor) || 0, atrasada: n.situacao === 'parada' && atrasada(n) };
    listas[n.situacao].push(linha);
  }
  listas.nao_lancada = xml.map((n) => ({ ...n, valor: Number(n.valor) || 0, atrasada: atrasada(n) }));

  porSituacao.parada.atrasadas = listas.parada.filter((n) => n.atrasada).length;
  porSituacao.nao_lancada.atrasadas = listas.nao_lancada.filter((n) => n.atrasada).length;

  return {
    dias: filtros.dias,
    prazo_entrada_dias: PRAZO_ENTRADA_DIAS,
    resumo: porSituacao,
    listas,
  };
}

module.exports = { notas, PERIODOS };
