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

// ----- Textos do Excel (mesmas regras da tela, em public/js/despachos.js) -----
const FORMAS = {
  0: 'Carteira', 1: 'Boleto', 2: 'Depósito', 3: 'Cheque', 4: 'Dinheiro', 5: 'Débito em conta',
  6: 'Cartão de crédito', 7: 'Promissória', 8: 'Vale', 9: 'Devolução', 11: 'PIX', 12: 'Cartão de débito', 13: 'Convênio',
};
const nomeForma = (codigo) => (codigo == null ? '' : FORMAS[Number(codigo)] ?? `Forma ${codigo}`);
const LUGAR_POR_TELA = { 668401: 'Bancos por títulos', 356928: 'Caixa', 249008: 'Cofre da loja', 455510: 'Retorno de despacho' };
const num = (v) => Number(v) || 0;

function situacaoTitulo(t) {
  if (t.titulo_receber == null) return 'Não virou título';
  const pendente = num(t.pendente);
  const noAcerto = num(t.cancelado_no_acerto);
  if (num(t.renegociado) > 0.009 && pendente <= 0.009) return 'Renegociado';
  if (num(t.cancelado) - noAcerto > 0.009 && pendente <= 0.009) return 'Cancelado manualmente';
  if (noAcerto > 0.009 && Math.abs(pendente) <= 0.009) return 'Pago no acerto';
  if (pendente < -0.009) return 'Recebido a mais';
  if (pendente <= 0.009) return 'Pago';
  if (num(t.recebido) > 0.009) return 'Pago em parte';
  return 'Em aberto';
}

function situacaoDespacho(c) {
  const semAcerto = num(c.notas_sem_acerto);
  const resolvidas = semAcerto > 0 && num(c.notas_resolvidas) === semAcerto;
  if (resolvidas && c.situacao !== 'ACERTADA') {
    if (num(c.valor_aberto_sem_acerto) > 0.009) return c.situacao === 'EM_ROTA' ? 'Resolvido fora · a receber' : 'Resto resolvido fora';
    return c.situacao === 'EM_ROTA' ? 'Quitado sem acerto' : 'Resto quitado fora';
  }
  if (num(c.acertos_sem_processar) > 0) return 'Acerto não processado';
  return SITUACAO_CARGA_TEXTO[c.situacao] ?? c.situacao;
}

// Uma linha por movimento do título (recebimento, estorno, encerramento no acerto,
// renegociação, cancelamento); título sem nenhum movimento vira uma linha "Sem baixa".
function linhasDoTitulo(t, c) {
  const base = {
    carga: t.carga, saida: c?.saida, conferente: c?.conferente, rota: c?.rota, responsavel: c?.responsavel,
    nota: t.nota, pedido: t.pedido, cliente: [t.codigo_cliente, t.cliente].filter(Boolean).join(' · '),
    titulo: t.titulo, forma_titulo: nomeForma(t.modalidade), vencimento: t.vencimento, valor_titulo: t.valor,
    situacao: situacaoTitulo(t), em_aberto: Math.max(0, num(t.pendente)),
    parcela_renegociacao: Number(t.origem) === 650512 ? 'sim' : '',
  };
  const eventos = [];
  for (const b of t.baixas ?? []) {
    const estorno = Number(b.transacao) !== 12;
    const viaAcerto = Number(b.via_acerto) === 1;
    let formulario = LUGAR_POR_TELA[Number(b.tab)] ?? `Outra tela (${b.tab})`;
    if (viaAcerto) formulario = 'Retorno de despacho (PIX lançado em Bancos)';
    eventos.push({
      movimento: estorno ? 'Estorno' : 'Recebimento',
      data_mov: b.data, hora: b.hora ? String(b.hora).slice(11, 16) : '',
      formulario, registro: b.registro, acerto: b.acerto ?? null,
      forma_recebida: nomeForma(b.modalidade),
      valor_mov: estorno ? -num(b.estornado) : num(b.valor),
      quem: b.usuario ?? '',
    });
  }
  if (num(t.cancelado_no_acerto) > 0.009) {
    const acerto = (String(t.motivo_acerto ?? '').match(/(\d+)\s*$/) || [])[1] ?? null;
    eventos.push({
      movimento: 'Encerrado no acerto (dinheiro)', data_mov: String(t.cancelado_no_acerto_em ?? '').slice(0, 10) || null,
      hora: String(t.cancelado_no_acerto_em ?? '').slice(11, 16), formulario: 'Retorno de despacho',
      registro: t.cancelamento_acerto, acerto, forma_recebida: nomeForma(t.modalidade),
      valor_mov: num(t.cancelado_no_acerto), quem: 'processamento do acerto',
    });
  }
  if (num(t.renegociado) > 0.009) {
    eventos.push({
      movimento: 'Renegociado', data_mov: t.renegociado_em, hora: '', formulario: 'Renegociação',
      registro: t.renegociacao, acerto: null, forma_recebida: '', valor_mov: num(t.renegociado), quem: '',
    });
  }
  const manual = num(t.cancelado) - num(t.cancelado_no_acerto);
  if (manual > 0.009) {
    eventos.push({
      movimento: 'Cancelado manualmente', data_mov: null, hora: '', formulario: 'Cancelamento de títulos',
      registro: t.cancelamento_manual, acerto: null, forma_recebida: '', valor_mov: manual, quem: '',
    });
  }
  if (!eventos.length) eventos.push({ movimento: 'Sem baixa' });
  return eventos.map((e) => ({ ...base, ...e }));
}

async function exportarCargas(query) {
  const filtros = filtrosCarga(query);
  const { lista } = await repo.cargas(filtros);
  const geradoEm = new Date().toLocaleString('pt-BR');
  const workbook = excel.novaPlanilha();

  // Aba 1: um despacho por linha
  excel.adicionarTabela(workbook, 'Despachos', {
    titulo: 'Despachos | Belo Norte',
    subtitulo: `${lista.length} despachos${filtros.situacao ? ` · ${SITUACAO_CARGA_TEXTO[filtros.situacao]}` : ''}`
      + ` · gerado em ${geradoEm}`,
    colunas: [
      { titulo: 'Despacho', chave: 'carga', tipo: 'codigo', largura: 10 },
      { titulo: 'Saída', chave: 'saida', tipo: 'data', largura: 12 },
      { titulo: 'Criado em', chave: 'criado_em', largura: 17 },
      { titulo: 'Rota', chave: 'rota', largura: 10 },
      { titulo: 'Conferente', chave: 'conferente', largura: 26 },
      { titulo: 'Responsável', chave: 'responsavel', largura: 26 },
      { titulo: 'Notas', chave: 'notas', tipo: 'inteiro', largura: 8, somar: true },
      { titulo: 'Valor que saiu', chave: 'valor', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Acerto', chave: 'acerto', tipo: 'codigo', largura: 9 },
      { titulo: 'Recebimento', chave: 'recebimento', tipo: 'data', largura: 12 },
      { titulo: 'Notas acertadas', chave: 'notas_acertadas', tipo: 'inteiro', largura: 10, somar: true },
      { titulo: 'Informado no acerto', chave: 'informado', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Pago fora do acerto', chave: 'valor_pago_fora', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'A receber (notas sem acerto)', chave: 'valor_aberto_sem_acerto', tipo: 'moeda', largura: 16, somar: true },
      { titulo: 'Situação', valor: situacaoDespacho, largura: 26 },
    ],
    linhas: lista,
    totais: true,
  });

  // Aba 2: títulos de cada despacho e cada movimento (recebimento, estorno, encerramento...)
  const porCarga = new Map(lista.map((c) => [Number(c.carga), c]));
  const titulos = await repo.titulosDasCargas(lista);
  const linhas = titulos.flatMap((t) => linhasDoTitulo(t, porCarga.get(Number(t.carga))));
  excel.adicionarTabela(workbook, 'Títulos e baixas', {
    titulo: 'Títulos e baixas dos despachos | Belo Norte',
    subtitulo: `${titulos.length} títulos · ${linhas.length} movimentos · uma linha por movimento do título`
      + ` · gerado em ${geradoEm}`,
    colunas: [
      { titulo: 'Despacho', chave: 'carga', tipo: 'codigo', largura: 10 },
      { titulo: 'Saída', chave: 'saida', tipo: 'data', largura: 12 },
      { titulo: 'Conferente', chave: 'conferente', largura: 24 },
      { titulo: 'Rota', chave: 'rota', largura: 8 },
      { titulo: 'Responsável', chave: 'responsavel', largura: 24 },
      { titulo: 'Nota', chave: 'nota', tipo: 'codigo', largura: 9 },
      { titulo: 'Pedido', chave: 'pedido', tipo: 'codigo', largura: 9 },
      { titulo: 'Cliente', chave: 'cliente', largura: 32 },
      { titulo: 'Título', chave: 'titulo', largura: 12 },
      { titulo: 'Forma do título', chave: 'forma_titulo', largura: 16 },
      { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
      { titulo: 'Valor do título', chave: 'valor_titulo', tipo: 'moeda', largura: 14 },
      { titulo: 'Situação no sistema', chave: 'situacao', largura: 20 },
      { titulo: 'Parcela de renegociação', chave: 'parcela_renegociacao', largura: 12 },
      { titulo: 'Movimento', chave: 'movimento', largura: 26 },
      { titulo: 'Data', chave: 'data_mov', tipo: 'data', largura: 12 },
      { titulo: 'Hora', chave: 'hora', largura: 7 },
      { titulo: 'Formulário', chave: 'formulario', largura: 30 },
      { titulo: 'Nº do registro', chave: 'registro', tipo: 'codigo', largura: 10 },
      { titulo: 'Acerto', chave: 'acerto', tipo: 'codigo', largura: 9 },
      { titulo: 'Forma recebida', chave: 'forma_recebida', largura: 16 },
      { titulo: 'Valor do movimento', chave: 'valor_mov', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Quem fez', chave: 'quem', largura: 24 },
      { titulo: 'Em aberto (título)', chave: 'em_aberto', tipo: 'moeda', largura: 14 },
    ],
    linhas,
    totais: true,
  });

  return { workbook, nomeArquivo: `despachos-detalhado_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

module.exports = {
  cargas, notasDaCarga, exportarCargas, lista, detalhe, exportar };
