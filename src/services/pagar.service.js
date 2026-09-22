// Regras do contas a pagar: valida os filtros da tela e exporta para Excel.

const AppError = require('../utils/AppError');
const repo = require('../repositories/pagar.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const SITUACAO_TEXTO = { ABERTO: 'Em aberto', PARCIAL: 'Pago em parte', PAGO: 'Pago', CANCELADO: 'Cancelado' };
const CARTAO_TEXTO = {
  aberto: 'Em aberto', vencidos: 'Vencidos', '7dias': 'Vencem em 7 dias', '30dias': 'Vencem em 30 dias', pago: 'Pagos',
};

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

function montarFiltros(query) {
  const situacao = query.situacao ? String(query.situacao) : 'aberto';
  if (!repo.FILTRO_SITUACAO[situacao]) {
    throw new AppError(`"situacao" deve ser: ${Object.keys(repo.FILTRO_SITUACAO).join(', ')}`);
  }
  const ordem = query.ordem ? String(query.ordem) : null;
  if (ordem && !repo.ORDENACAO[ordem]) {
    throw new AppError(`"ordem" deve ser: ${Object.keys(repo.ORDENACAO).join(', ')}`);
  }
  const direcao = query.direcao ? String(query.direcao) : 'asc';
  if (!['asc', 'desc'].includes(direcao)) throw new AppError('"direcao" deve ser asc ou desc');
  return {
    inicio: data(query.inicio, 'inicio'),
    fim: data(query.fim, 'fim'),
    busca: (query.busca ?? '').trim().slice(0, 60) || null,
    situacao,
    ordem,
    direcao,
  };
}

async function painel(query) {
  return repo.painel(montarFiltros(query));
}

async function exportar(query) {
  const filtros = montarFiltros(query);
  const { titulos } = await repo.painel(filtros);
  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : null);
  const periodo = filtros.inicio || filtros.fim
    ? ` · vencimento de ${dataBR(filtros.inicio) ?? 'o início'} até ${dataBR(filtros.fim) ?? 'o fim'}` : '';

  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Contas a pagar', {
    titulo: 'Contas a pagar | Belo Norte',
    subtitulo: `${CARTAO_TEXTO[filtros.situacao]} · ${titulos.length} títulos${periodo}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
      { titulo: 'Dias de atraso', valor: (t) => (t.dias_atraso > 0 ? t.dias_atraso : 0), tipo: 'inteiro', largura: 10 },
      { titulo: 'Título', chave: 'titulo', largura: 16 },
      { titulo: 'Cód. fornecedor', chave: 'cod_fornecedor', tipo: 'codigo', largura: 12 },
      { titulo: 'Fornecedor', chave: 'fornecedor', largura: 40 },
      { titulo: 'Forma', chave: 'forma', largura: 14 },
      { titulo: 'Empresa', chave: 'empresa', tipo: 'codigo', largura: 9 },
      { titulo: 'Emissão', chave: 'emissao', tipo: 'data', largura: 12 },
      { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Pago', chave: 'pago', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Descontos', chave: 'descontos', tipo: 'moeda', largura: 12, somar: true },
      { titulo: 'Retenções', chave: 'retencoes', tipo: 'moeda', largura: 12, somar: true },
      { titulo: 'Juros e multa', chave: 'juros_multa', tipo: 'moeda', largura: 12, somar: true },
      { titulo: 'Pendente', chave: 'pendente', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Último pagamento', chave: 'ultimo_pagamento', tipo: 'data', largura: 14 },
      { titulo: 'Situação', valor: (t) => SITUACAO_TEXTO[t.situacao] ?? t.situacao, largura: 13 },
    ],
    linhas: titulos,
    totais: true,
  });
  const hoje = new Date().toISOString().slice(0, 10);
  const parte = excel.nomeSeguro(filtros.busca || '');
  return { workbook, nomeArquivo: `contas-a-pagar${parte ? `_${parte}` : ''}_${hoje}.xlsx` };
}

module.exports = { painel, exportar };
