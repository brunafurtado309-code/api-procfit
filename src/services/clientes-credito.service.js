// Análise de clientes e crédito (contas a receber).
//
// Classificação de crédito, pelo histórico real (regra mostrada também na tela):
//   D  tem título vencido há mais de 60 dias
//   C  vencido há mais de 30 dias, ou costuma pagar com mais de 15 dias de atraso
//   B  tem algum vencido, ou costuma pagar com 4 a 15 dias de atraso
//   A  paga em dia (até 3 dias depois do vencimento) e não tem vencido
//   N  sem histórico de pagamento nos últimos 12 meses (cliente novo)

const financeiro = require('./financeiro.service');
const repo = require('../repositories/financeiro.repository');
const excel = require('../utils/excel');

const CLASSES = {
  A: 'A · paga em dia', B: 'B · atrasa pouco', C: 'C · atrasa bastante', D: 'D · vencido há mais de 60 dias',
  N: 'Sem histórico',
};

function classificar(c) {
  const maiorAtraso = Number(c.maior_atraso) || 0;
  const atrasoMedio = Number(c.atraso_medio_pagamento) || 0;
  if (maiorAtraso > 60) return 'D';
  if (maiorAtraso > 30 || atrasoMedio > 15) return 'C';
  if (maiorAtraso > 0 || atrasoMedio > 3) return 'B';
  if (!Number(c.pagos_12m)) return 'N';
  return 'A';
}

function enriquecer(linhas) {
  return linhas.map((c) => {
    const pagos = Number(c.pagos_12m) || 0;
    const classe = classificar(c);
    return {
      ...c,
      classe,
      pct_em_dia: pagos ? Number(c.pagos_em_dia_12m) / pagos : null,
      // Risco: atraso de mais de 30 dias e comprou de novo nos últimos 30 dias
      atrasado_comprando: (Number(c.maior_atraso) || 0) > 30 && Number(c.vendido_30d) > 0.009,
    };
  });
}

function resumir(clientes) {
  const soma = (lista, campo) => lista.reduce((t, c) => t + (Number(c[campo]) || 0), 0);
  const porClasse = {};
  for (const classe of Object.keys(CLASSES)) {
    const lista = clientes.filter((c) => c.classe === classe);
    porClasse[classe] = { clientes: lista.length, aberto: soma(lista, 'aberto'), vendido_12m: soma(lista, 'vendido_12m') };
  }
  const aberto = soma(clientes, 'aberto');
  // Concentração: quanto os 20 maiores devedores representam do total em aberto
  const maiores = [...clientes].sort((a, b) => (b.aberto || 0) - (a.aberto || 0)).slice(0, 20);
  const pagos = soma(clientes, 'pagos_12m');
  return {
    clientes: clientes.length,
    aberto,
    vencido: soma(clientes, 'vencido'),
    com_vencido: clientes.filter((c) => Number(c.vencido) > 0.009).length,
    vendido_12m: soma(clientes, 'vendido_12m'),
    concentracao_20: aberto ? soma(maiores, 'aberto') / aberto : 0,
    pct_em_dia: pagos ? soma(clientes, 'pagos_em_dia_12m') / pagos : null,
    atrasados_comprando: clientes.filter((c) => c.atrasado_comprando).length,
    por_classe: porClasse,
  };
}

async function analise(query) {
  const filtros = financeiro.montarFiltros({ busca: query.busca });
  const clientes = enriquecer(await repo.analiseClientes(filtros));
  return { resumo: resumir(clientes), clientes };
}

async function exportar(query) {
  const { clientes } = await analise(query);
  const classe = query.classe && CLASSES[query.classe] ? query.classe : null;
  const lista = clientes
    .filter((c) => (classe ? c.classe === classe : true))
    .filter((c) => (query.risco === 'atrasado_comprando' ? c.atrasado_comprando : true))
    .sort((a, b) => (b.aberto || 0) - (a.aberto || 0));

  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Clientes e crédito', {
    titulo: 'Clientes e crédito | Belo Norte',
    subtitulo: `${lista.length} clientes${classe ? ` · ${CLASSES[classe]}` : ''}`
      + `${query.risco === 'atrasado_comprando' ? ' · em atraso e ainda comprando' : ''}`
      + `${query.busca ? ` · pesquisa "${query.busca}"` : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 11 },
      { titulo: 'Cliente', chave: 'cliente', largura: 40 },
      { titulo: 'Classe', valor: (c) => CLASSES[c.classe], largura: 26 },
      { titulo: 'Em aberto', chave: 'aberto', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Vencido', chave: 'vencido', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Maior atraso (dias)', chave: 'maior_atraso', tipo: 'inteiro', largura: 12 },
      { titulo: 'Vendido a prazo 12 meses', chave: 'vendido_12m', tipo: 'moeda', largura: 16, somar: true },
      { titulo: 'Pagos 12 meses', chave: 'pagos_12m', tipo: 'inteiro', largura: 10 },
      { titulo: '% pago em dia', valor: (c) => (c.pct_em_dia === null ? '' : Math.round(c.pct_em_dia * 100)), tipo: 'inteiro', largura: 10 },
      { titulo: 'Atraso médio de pagamento (dias)', valor: (c) => (c.atraso_medio_pagamento === null ? '' : Math.round(c.atraso_medio_pagamento)), tipo: 'inteiro', largura: 14 },
      { titulo: 'Última compra', chave: 'ultima_compra', tipo: 'data', largura: 12 },
      { titulo: 'Último pagamento', chave: 'ultimo_pagamento', tipo: 'data', largura: 12 },
      { titulo: 'Cliente desde', chave: 'cliente_desde', tipo: 'data', largura: 12 },
    ],
    linhas: lista,
    totais: true,
  });
  return { workbook, nomeArquivo: `clientes-e-credito_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

module.exports = { analise, exportar };
