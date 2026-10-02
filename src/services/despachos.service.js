// Regras da aba Despachos: valida filtros, resume os acertos e exporta para Excel.

const AppError = require('../utils/AppError');
const repo = require('../repositories/despachos.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const SITUACOES = ['CONFERIDO', 'DIFERENCA', 'SEM_PARCELAS', 'SEM_NOTAS', 'DESCOBERTO', 'PENDENTE'];
const SITUACAO_TEXTO = {
  CONFERIDO: 'Ok', DIFERENCA: 'Conferir', SEM_PARCELAS: 'Não processado', SEM_NOTAS: 'Sem notas',
  DESCOBERTO: 'Falta receber', PENDENTE: 'Pendente de recebimento',
};
const temDescoberto = (a) => Number(a.a_descoberto) > 0.01;

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

function montarFiltros(query) {
  const situacao = query.situacao ? String(query.situacao).toUpperCase() : null;
  if (situacao && !SITUACOES.includes(situacao)) {
    throw new AppError(`"situacao" deve ser: ${SITUACOES.join(', ')}`);
  }
  const busca = (query.busca ?? '').trim().slice(0, 60) || null;
  // Pesquisa por NÚMERO (despacho, acerto, nota, pedido ou código do cliente) procura em
  // todas as datas: quem digita o número quer achar aquele registro, esteja no período ou não.
  // Pesquisa por nome continua respeitando o período escolhido.
  const porNumero = busca !== null && /^\d+$/.test(busca);
  return {
    inicio: porNumero ? null : data(query.inicio, 'inicio'),
    fim: porNumero ? null : data(query.fim, 'fim'),
    busca,
    situacao,
  };
}

// Indicadores sobre a lista inteira do período (antes do filtro de situação)
function resumir(acertos) {
  const soma = (campo) => acertos.reduce((total, a) => total + (Number(a[campo]) || 0), 0);
  const contar = (situacao) => acertos.filter((a) => a.situacao === situacao).length;
  return {
    acertos: acertos.length,
    notas: soma('notas'),
    total_notas: soma('total_notas'),
    total_informado: soma('total_informado'),
    a_descoberto: soma('a_descoberto'),
    com_descoberto: acertos.filter(temDescoberto).length,
    total_parcelas: soma('total_parcelas'),
    diferenca: soma('diferenca'),
    conferidos: contar('CONFERIDO'),
    com_diferenca: contar('DIFERENCA'),
    sem_parcelas: contar('SEM_PARCELAS') + contar('SEM_NOTAS'),
  };
}

function filtrarSituacao(acertos, situacao) {
  if (!situacao) return acertos;
  if (situacao === 'DESCOBERTO') return acertos.filter(temDescoberto);
  if (situacao === 'SEM_PARCELAS') return acertos.filter((a) => a.situacao === 'SEM_PARCELAS' || a.situacao === 'SEM_NOTAS');
  return acertos.filter((a) => a.situacao === situacao);
}

// Despacho sem acerto, no mesmo formato de uma linha de acerto, para entrar na lista do Retorno.
// "Recebido" aqui é o que já foi baixado por fora do acerto (ex.: Bancos por títulos).
function linhaPendente(c) {
  const valor = Number(c.valor) || 0;
  const pagoFora = Number(c.valor_pago_fora) || 0;
  return {
    acerto: null,
    carga: c.carga,
    data_recebimento: c.saida,   // para ordenar junto; a tela mostra como "saiu em"
    saida: c.saida,
    criado_em: c.criado_em,
    usuario: c.usuario,
    usuario_nome: c.conferente,
    rota: c.rota,
    responsavel: c.responsavel,
    notas: c.notas,
    total_notas: valor,
    total_informado: pagoFora,
    a_descoberto: Math.max(0, valor - pagoFora),
    notas_sem_acerto: c.notas_sem_acerto,
    notas_pagas_fora: c.notas_pagas_fora,
    notas_parciais_fora: c.notas_parciais_fora,
    valor_pago_fora: pagoFora,
    situacao: 'PENDENTE',
  };
}

async function lista(query) {
  const filtros = montarFiltros(query);
  const [todos, semAcerto] = await Promise.all([repo.lista(filtros), repo.pendentes(filtros)]);
  const pend = semAcerto.map(linhaPendente);
  const resumo = {
    ...resumir(todos),
    pendentes: pend.length,
    valor_pendente: pend.reduce((t, p) => t + p.a_descoberto, 0),
  };
  let lista;
  if (filtros.situacao === 'PENDENTE') lista = pend;
  else if (filtros.situacao) lista = filtrarSituacao(todos, filtros.situacao);
  else lista = [...todos, ...pend];
  return { resumo, lista };
}

async function detalhe(query, params) {
  const numero = Number(params.acerto);
  if (!Number.isInteger(numero) || numero <= 0) throw new AppError('Número do acerto inválido');
  const dados = await repo.detalhe(numero);
  if (!dados) throw new AppError(`Acerto ${numero} não encontrado`, 404);
  return dados;
}

// Excel: a mesma lista da tela (período, pesquisa e situação)
async function exportar(query) {
  const filtros = montarFiltros(query);
  const acertos = filtrarSituacao(await repo.lista(filtros), filtros.situacao);
  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : 'o início');

  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Despachos', {
    titulo: 'Despachos | Belo Norte',
    subtitulo: `${acertos.length} despachos · recebimento de ${dataBR(filtros.inicio)} até ${filtros.fim ? dataBR(filtros.fim) : 'hoje'}`
      + `${filtros.situacao ? ` · ${SITUACAO_TEXTO[filtros.situacao]}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Acerto', chave: 'acerto', tipo: 'codigo', largura: 9 },
      { titulo: 'Recebimento', chave: 'data_recebimento', tipo: 'data', largura: 12 },
      { titulo: 'Digitado em', chave: 'digitado_em', largura: 17 },
      { titulo: 'Lançado por', valor: (a) => a.usuario_nome ?? (a.usuario != null ? `usuário ${a.usuario}` : ''), largura: 22 },
      { titulo: 'Carga', chave: 'carga', tipo: 'codigo', largura: 9 },
      { titulo: 'Rota', chave: 'rota', largura: 18 },
      { titulo: 'Notas', chave: 'notas', tipo: 'inteiro', largura: 8, somar: true },
      { titulo: 'Total das notas', chave: 'total_notas', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Recebido', chave: 'total_informado', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Falta receber', chave: 'a_descoberto', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Títulos gerados', chave: 'total_parcelas', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Situação', valor: (a) => SITUACAO_TEXTO[
        a.situacao === 'CONFERIDO' || a.situacao === 'DIFERENCA'
          ? (temDescoberto(a) ? 'DESCOBERTO' : a.situacao) : a.situacao] ?? a.situacao, largura: 15 },
    ],
    linhas: acertos,
    totais: true,
  });

  const hoje = new Date().toISOString().slice(0, 10);
  return { workbook, nomeArquivo: `despachos_${hoje}.xlsx` };
}

// ===== Saída: as cargas que deixaram a empresa =====
const SITUACAO_CARGA_TEXTO = {
  EM_ROTA: 'Pendente de recebimento', PARCIAL: 'Acertada em parte', ACERTADA: 'Acertada',
  NAO_PROC: 'Acerto não processado',
};

function filtrosCarga(query) {
  const filtros = montarFiltros({ ...query, situacao: undefined });
  if (query.situacao) {
    if (!repo.SITUACOES_CARGA[query.situacao]) {
      throw new AppError(`"situacao" deve ser: ${Object.keys(repo.SITUACOES_CARGA).join(', ')}`);
    }
    filtros.situacao = query.situacao;
  }
  return filtros;
}

const cargas = (query) => repo.cargas(filtrosCarga(query));

async function notasDaCarga(query, params) {
  const carga = Number(params.carga);
  if (!Number.isInteger(carga) || carga <= 0) throw new AppError('Número da carga inválido');
  const dados = await repo.notasDaCarga(carga);
  if (!dados.carga) throw new AppError(`Carga ${carga} não encontrada`, 404);
  return dados;
}

async function exportarCargas(query) {
  const filtros = filtrosCarga(query);
  const { lista } = await repo.cargas(filtros);
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Cargas', {
    titulo: 'Despachos: cargas que saíram | Belo Norte',
    subtitulo: `${lista.length} cargas${filtros.situacao ? ` · ${SITUACAO_CARGA_TEXTO[filtros.situacao]}` : ''}`
      + ` · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Carga', chave: 'carga', tipo: 'codigo', largura: 9 },
      { titulo: 'Saída', chave: 'saida', tipo: 'data', largura: 12 },
      { titulo: 'Rota', chave: 'rota', largura: 12 },
      { titulo: 'Conferente', chave: 'conferente', largura: 26 },
      { titulo: 'Responsável', chave: 'responsavel', largura: 26 },
      { titulo: 'Notas', chave: 'notas', tipo: 'inteiro', largura: 8, somar: true },
      { titulo: 'Valor que saiu', chave: 'valor', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Notas acertadas', chave: 'notas_acertadas', tipo: 'inteiro', largura: 10, somar: true },
      { titulo: 'Informado no acerto', chave: 'informado', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Pago fora do acerto', chave: 'valor_pago_fora', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Acerto', chave: 'acerto', tipo: 'codigo', largura: 9 },
      { titulo: 'Recebimento', chave: 'recebimento', tipo: 'data', largura: 12 },
      { titulo: 'Situação', valor: (c) => SITUACAO_CARGA_TEXTO[c.situacao] ?? c.situacao, largura: 20 },
    ],
    linhas: lista,
    totais: true,
  });
  return { workbook, nomeArquivo: `cargas-despacho_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

module.exports = {
  cargas, notasDaCarga, exportarCargas, lista, detalhe, exportar };
