// Regras do módulo faturamento: valida os filtros e exporta a análise de pedidos.

const AppError = require('../utils/AppError');
const repo = require('../repositories/faturamento.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA = 24 * 60 * 60 * 1000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ETAPA_TEXTO = {
  ORCAMENTO: 'Orçamento',
  APROVACAO: 'Pendente de aprovação',
  PEDIDO: 'Pedido (sem checkout)',
  CHECKOUT: 'Checkout feito',
  FATURADO: 'Faturado (nota emitida)',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

const DEVOLUCAO_TEXTO = { TOTAL: 'Total', PARCIAL: 'Parcial', SEM_VALOR: 'Sem valor' };

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

// Período padrão: últimos 30 dias, no máximo 1 ano (a consulta olha pedido, nota, cupom e título)
function montarFiltros(query) {
  let inicio = data(query.inicio, 'inicio');
  let fim = data(query.fim, 'fim');
  if (!fim) fim = iso(new Date());
  if (!inicio) inicio = iso(new Date(new Date(`${fim}T12:00:00`).getTime() - 29 * UM_DIA));
  if (inicio > fim) throw new AppError('A data inicial não pode ser depois da final');
  const dias = Math.round((new Date(`${fim}T12:00:00`) - new Date(`${inicio}T12:00:00`)) / UM_DIA) + 1;
  if (dias > 366) throw new AppError('Escolha um período de no máximo 1 ano');

  const filtros = { inicio, fim };
  if (query.busca) {
    const busca = String(query.busca).trim().slice(0, 60);
    if (busca) filtros.busca = busca;
  }
  if (query.vendedor) {
    const vendedor = Number(query.vendedor);
    if (!Number.isInteger(vendedor)) throw new AppError('"vendedor" deve ser um número');
    filtros.vendedor = vendedor;
  }
  if (query.filtro) {
    if (!repo.FILTROS[query.filtro]) {
      throw new AppError(`"filtro" deve ser: ${Object.keys(repo.FILTROS).join(', ')}`);
    }
    filtros.filtro = query.filtro;
  }
  return filtros;
}

const analise = (query) => repo.analise(montarFiltros(query));
const vendedores = (query) => repo.vendedores(montarFiltros(query));

async function detalhe(query, params) {
  const pedido = Number(params.pedido);
  if (!Number.isInteger(pedido) || pedido <= 0) throw new AppError('Número do pedido inválido');
  const dados = await repo.detalhe(pedido);
  if (!dados.pedido) throw new AppError(`Pedido ${pedido} não encontrado`, 404);
  return dados;
}

async function exportar(query) {
  const filtros = montarFiltros(query);
  const { lista } = await repo.analise(filtros);
  const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : null);
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Pedidos', {
    titulo: 'Análise de pedidos | Belo Norte',
    subtitulo: `${lista.length} pedidos · de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`
      + `${filtros.filtro ? ` · ${filtros.filtro}` : ''}${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''}`
      + ` · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Pedido', chave: 'pedido', tipo: 'codigo', largura: 10 },
      { titulo: 'Data', chave: 'dia', tipo: 'data', largura: 12 },
      { titulo: 'Etapa', valor: (p) => ETAPA_TEXTO[p.etapa] ?? p.etapa, largura: 22 },
      { titulo: 'Status no PROCFIT', chave: 'status', largura: 20 },
      { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 11 },
      { titulo: 'Cliente', chave: 'cliente', largura: 38 },
      { titulo: 'Vendedor', chave: 'vendedor', largura: 26 },
      { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Desconto', chave: 'desconto', tipo: 'moeda', largura: 13, somar: true },
      { titulo: 'Checkout', chave: 'checkout_em', largura: 17 },
      { titulo: 'Nota', chave: 'nota', tipo: 'codigo', largura: 10 },
      { titulo: 'Cupom', chave: 'cupom', tipo: 'codigo', largura: 10 },
      { titulo: 'Títulos', chave: 'titulos', tipo: 'inteiro', largura: 8 },
      { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Em aberto', chave: 'pendente', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Pago no caixa com título aberto', valor: (p) => (p.pago_com_titulo_aberto ? 'Sim' : ''), largura: 14 },
      { titulo: 'Nota sem cobrança', valor: (p) => (p.nota_sem_cobranca ? 'Sim' : ''), largura: 14 },
      { titulo: 'Cancelado com nota', valor: (p) => (p.cancelado_com_nota ? 'Sim' : ''), largura: 14 },
      { titulo: 'Parado sem faturar', valor: (p) => (p.parado_sem_faturar ? 'Sim' : ''), largura: 14 },
      { titulo: 'Devolução', valor: (p) => DEVOLUCAO_TEXTO[p.devolucao] ?? '', largura: 14 },
      { titulo: 'Valor devolvido', chave: 'devolvido', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Data da devolução', chave: 'devolucao_dia', tipo: 'data', largura: 13 },
    ],
    linhas: lista,
    totais: true,
  });
  return { workbook, nomeArquivo: `pedidos_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

module.exports = { analise, detalhe, vendedores, exportar, ETAPA_TEXTO };
