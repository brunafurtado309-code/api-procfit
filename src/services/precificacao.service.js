// Regras do módulo precificação. Cada passo da construção acrescenta as suas aqui.

const AppError = require('../utils/AppError');
const repo = require('../repositories/precificacao.repository');
const classificacao = require('../repositories/classificacao.repository');

// Períodos que a tela oferece (dias para trás, a partir de hoje)
const PERIODOS = [30, 60, 90, 180];
const PERIODO_PADRAO = 90;

// Nota de mercadoria sem entrada há mais dias que isto vira atraso (laranja na tela)
const PRAZO_ENTRADA_DIAS = 3;

// Sugestão automática do tipo do fornecedor, pelo histórico dele no PROCFIT:
//   nenhuma nota finalizada            -> sem sugestão (as notas vão para "produção ou uso e consumo")
//   PARCELA_REVENDA ou mais finalizadas -> revenda
//   entre os dois                       -> misto (cada nota precisa ser classificada)
// A sugestão só vale até alguém confirmar ou corrigir na tela.
const PARCELA_REVENDA = 0.8;

const TIPOS_FORNECEDOR = {
  revenda: 'Revenda',
  producao: 'Produção',
  consumo: 'Uso e consumo',
  misto: 'Misto (classificar cada nota)',
};
const TIPOS_NOTA = {
  revenda: 'Revenda',
  producao: 'Produção',
  consumo: 'Uso e consumo',
};

const SITUACOES = ['parada', 'a_classificar', 'nao_lancada', 'entrou', 'producao_consumo'];

function periodo(valor) {
  if (valor === undefined || valor === null || valor === '') return PERIODO_PADRAO;
  const dias = Number(valor);
  if (!PERIODOS.includes(dias)) throw new AppError(`"dias" deve ser: ${PERIODOS.join(', ')}`);
  return dias;
}

function codigo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new AppError(`Código ${nome} inválido`);
  return numero;
}

function sugestao(f) {
  const notas = Number(f.notas) || 0;
  const finalizadas = Number(f.finalizadas) || 0;
  if (!notas || !finalizadas) return null;
  return finalizadas / notas >= PARCELA_REVENDA ? 'revenda' : 'misto';
}

// Fornecedores com o histórico, a sugestão e a classificação confirmada (se houver)
async function montarFornecedores() {
  const [lista, confirmadas] = await Promise.all([repo.fornecedores(), classificacao.listar('fornecedor')]);
  const porCodigo = new Map();
  for (const f of lista) {
    const c = confirmadas.get(Number(f.codigo));
    porCodigo.set(Number(f.codigo), {
      codigo: Number(f.codigo),
      nome: f.nome,
      notas: Number(f.notas) || 0,
      finalizadas: Number(f.finalizadas) || 0,
      valor: Number(f.valor) || 0,
      ultima_nota: f.ultima_nota,
      sugestao: sugestao(f),
      tipo: c?.tipo ?? null,
      alterado_por: c?.alterado_por ?? null,
      alterado_em: c?.alterado_em ?? null,
    });
  }
  return porCodigo;
}

// Decide o tipo de uma nota que ainda não entrou: primeiro a classificação da própria nota,
// depois a do fornecedor (confirmada), por último a sugestão.
// Devolve { tipo, origem }; tipo null = precisa classificar a nota (fornecedor misto).
function tipoDaNota(nota, fornecedor, notasConfirmadas) {
  const daNota = notasConfirmadas.get(Number(nota.nota_id));
  if (daNota) return { tipo: daNota.tipo, origem: 'nota' };
  if (fornecedor?.tipo) {
    return { tipo: fornecedor.tipo === 'misto' ? null : fornecedor.tipo, origem: 'fornecedor' };
  }
  const s = fornecedor?.sugestao;
  if (s === 'revenda') return { tipo: 'revenda', origem: 'sugestao' };
  if (s === 'misto') return { tipo: null, origem: 'sugestao' };
  return { tipo: 'sem_historico', origem: 'sugestao' };
}

function situacaoDaNota(nota, tipo) {
  if (nota.entrou) return 'entrou';
  if (tipo === 'revenda') return 'parada';
  if (tipo === null) return 'a_classificar';
  return 'producao_consumo';
}

const umaCasa = (v) => Math.round(v * 10) / 10;

async function notas(query) {
  const filtros = { dias: periodo(query.dias) };
  const [{ compras, xml }, fornecedores, notasConfirmadas] = await Promise.all([
    repo.notas(filtros), montarFornecedores(), classificacao.listar('nota'),
  ]);

  const listas = Object.fromEntries(SITUACOES.map((s) => [s, []]));
  for (const n of compras) {
    const fornecedor = fornecedores.get(Number(n.cod_fornecedor));
    const { tipo, origem } = n.entrou ? { tipo: null, origem: null } : tipoDaNota(n, fornecedor, notasConfirmadas);
    const situacao = situacaoDaNota(n, tipo);
    listas[situacao].push({
      ...n,
      entrou: Boolean(n.entrou),
      valor: Number(n.valor) || 0,
      tipo,
      tipo_origem: origem,
      tipo_fornecedor: fornecedor?.tipo ?? null,
      atrasada: situacao === 'parada' && n.dias > PRAZO_ENTRADA_DIAS,
    });
  }
  listas.nao_lancada = xml.map((n) => ({ ...n, valor: Number(n.valor) || 0, atrasada: n.dias > PRAZO_ENTRADA_DIAS }));
  // Produção ou uso e consumo: as de maior valor primeiro (não é atraso, é volume)
  listas.producao_consumo.sort((a, b) => b.valor - a.valor);

  const resumo = {};
  for (const s of SITUACOES) {
    const itens = listas[s];
    resumo[s] = {
      notas: itens.length,
      valor: itens.reduce((t, n) => t + n.valor, 0),
      dias_medio: itens.length ? umaCasa(itens.reduce((t, n) => t + Number(n.dias || 0), 0) / itens.length) : null,
      atrasadas: itens.filter((n) => n.atrasada).length,
    };
  }

  // Fornecedores com nota no período que ainda não foram confirmados por ninguém
  const doPeriodo = new Set(compras.map((n) => Number(n.cod_fornecedor)));
  const aConfirmar = [...doPeriodo].filter((c) => fornecedores.get(c) && !fornecedores.get(c).tipo).length;

  return {
    dias: filtros.dias,
    prazo_entrada_dias: PRAZO_ENTRADA_DIAS,
    tipos_nota: TIPOS_NOTA,
    fornecedores_a_confirmar: aConfirmar,
    resumo,
    listas,
  };
}

// Lista de fornecedores para classificar: os não confirmados primeiro, os que mais mandam nota no topo
async function fornecedores() {
  const lista = [...(await montarFornecedores()).values()];
  lista.sort((a, b) => (Boolean(a.tipo) - Boolean(b.tipo)) || (b.notas - a.notas));
  return { tipos: TIPOS_FORNECEDOR, parcela_revenda: PARCELA_REVENDA, fornecedores: lista };
}

// Quem grava: o nome do login; a chave mestra de emergência não tem nome
const quem = (usuario) => usuario || 'chave mestra';

function tipoValido(tipo, tipos) {
  if (tipo === null || tipo === undefined || tipo === '') return null;
  if (!tipos[tipo]) throw new AppError(`"tipo" deve ser: ${Object.keys(tipos).join(', ')} (ou vazio para tirar)`);
  return tipo;
}

async function classificarFornecedor(query, params, corpo, usuario) {
  const cod = codigo(params.fornecedor, 'do fornecedor');
  const tipo = tipoValido(corpo?.tipo, TIPOS_FORNECEDOR);
  return classificacao.definir('fornecedor', cod, tipo, quem(usuario));
}

// Vários fornecedores com o mesmo tipo (ex.: todos os de material de construção como uso e consumo)
const LIMITE_LOTE = 500;
async function classificarFornecedores(query, params, corpo, usuario) {
  const lista = corpo?.fornecedores;
  if (!Array.isArray(lista) || !lista.length) throw new AppError('Escolha ao menos um fornecedor');
  if (lista.length > LIMITE_LOTE) throw new AppError(`No máximo ${LIMITE_LOTE} fornecedores de uma vez`);
  const codigos = [...new Set(lista.map((c) => codigo(c, 'do fornecedor')))];
  const tipo = tipoValido(corpo?.tipo, TIPOS_FORNECEDOR);
  return classificacao.definir('fornecedor', codigos, tipo, quem(usuario));
}

async function classificarNota(query, params, corpo, usuario) {
  const cod = codigo(params.nota, 'da nota');
  const tipo = tipoValido(corpo?.tipo, TIPOS_NOTA);
  return classificacao.definir('nota', cod, tipo, quem(usuario));
}

module.exports = {
  notas, fornecedores, classificarFornecedor, classificarFornecedores, classificarNota, PERIODOS,
};
