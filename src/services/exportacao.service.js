// Exportação para Excel: usa as mesmas consultas e regras do painel.

const repo = require('../repositories/vendas.repository');
const vendas = require('./vendas.service');
const excel = require('../utils/excel');

const LIMITE_EXPORTACAO = 100000;

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const periodoTexto = (f) => `Período: ${dataBR(f.inicio)} a ${dataBR(f.fim)}`;
const contar = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

// ===== Colunas =====
const COL_NOTAS = [
  { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 },
  { titulo: 'Situação', chave: 'situacao', largura: 12 },
  { titulo: 'Nº da nota', chave: 'nota', tipo: 'codigo', largura: 12 },
  { titulo: 'Série', chave: 'serie', largura: 7 },
  { titulo: 'Nº do pedido', chave: 'pedido', tipo: 'codigo', largura: 13 },
  { titulo: 'Cód. vendedor', chave: 'codigo_vendedor', tipo: 'codigo', largura: 12 },
  { titulo: 'Vendedor', chave: 'vendedor', largura: 32 },
  { titulo: 'Cód. cliente', chave: 'codigo_cliente', tipo: 'codigo', largura: 12 },
  { titulo: 'Cliente', chave: 'cliente', largura: 40 },
  { titulo: 'Nome fantasia', chave: 'fantasia', largura: 28 },
  { titulo: 'CNPJ/CPF', chave: 'cnpj_cpf', largura: 20 },
  { titulo: 'Qtd. itens', chave: 'quantidade', tipo: 'inteiro', largura: 10, somar: true },
  { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 16, somar: true },
];

const COL_CUPONS = [
  { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 },
  { titulo: 'Hora', chave: 'hora', largura: 8 },
  { titulo: 'Situação', chave: 'situacao', largura: 12 },
  { titulo: 'Caixa', chave: 'caixa', tipo: 'codigo', largura: 8 },
  { titulo: 'Nº do cupom', chave: 'cupom', tipo: 'codigo', largura: 12 },
  { titulo: 'Série', chave: 'serie', largura: 7 },
  { titulo: 'Cód. operador', chave: 'codigo_operador', tipo: 'codigo', largura: 12 },
  { titulo: 'Operador', chave: 'operador', largura: 32 },
  { titulo: 'Cód. vendedor', chave: 'codigo_vendedor', tipo: 'codigo', largura: 12 },
  { titulo: 'Vendedor', chave: 'vendedor', largura: 32 },
  { titulo: 'Cód. cliente', chave: 'codigo_cliente', tipo: 'codigo', largura: 12 },
  { titulo: 'Cliente', chave: 'cliente', largura: 40 },
  { titulo: 'Nome fantasia', chave: 'fantasia', largura: 28 },
  { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 16, somar: true },
];

const semColunas = (colunas, ...chaves) => colunas.filter((c) => !chaves.includes(c.chave));

// ===== Painel completo =====
async function exportarPainel(query) {
  const filtros = vendas.montarFiltros(query);

  const [resumo, porVendedor, porOperador, notas, cupons] = await Promise.all([
    repo.resumo(filtros),
    vendas.porVendedor(query),
    vendas.porOperador(query),
    repo.notasDoVendedor(filtros, null, LIMITE_EXPORTACAO),
    repo.cuponsDoOperador(filtros, null, LIMITE_EXPORTACAO),
  ]);

  const t = porVendedor.total;
  const wb = excel.novaPlanilha();

  excel.adicionarResumo(wb, 'Resumo', {
    titulo: 'Painel de vendas | Belo Norte',
    subtitulo: `${periodoTexto(filtros)}. Gerado em ${new Date().toLocaleString('pt-BR')}`,
    itens: [
      ['Venda líquida', t.liquido, 'moeda'],
      ['Notas faturadas', t.notas_valor, 'moeda', contar(t.notas_qtd, 'nota', 'notas')],
      ['Vendas no caixa', t.caixa_valor, 'moeda', contar(t.caixa_qtd, 'cupom', 'cupons')],
      ['Devoluções', t.devolucoes_valor + t.devolucoes_caixa_valor, 'moeda',
        contar(t.devolucoes_qtd + t.devolucoes_caixa_qtd, 'devolução', 'devoluções')],
      ['Quantidade de vendas', resumo.qtd_vendas, 'inteiro'],
      ['Ticket médio', resumo.ticket_medio, 'moeda'],
      ['Descontos', resumo.desconto, 'moeda'],
      ['Margem bruta', resumo.margem_pct, 'percentual',
        resumo.margem_pct == null
          ? 'Sem custo cadastrado no período'
          : `Calculada sobre ${resumo.cobertura_custo_pct}% das vendas (as notas fiscais não têm custo no PROCFIT)`],
    ],
  });

  excel.adicionarTabela(wb, 'Vendedores', {
    colunas: [
      { titulo: 'Cód. vendedor', chave: 'vendedor', tipo: 'codigo', largura: 12 },
      { titulo: 'Vendedor', chave: 'nome', largura: 36 },
      { titulo: 'Notas', chave: 'notas_qtd', tipo: 'inteiro', largura: 10, somar: true },
      { titulo: 'Notas faturadas', chave: 'notas_valor', tipo: 'moeda', largura: 18, somar: true },
      { titulo: 'Devoluções', chave: 'devolucoes_qtd', tipo: 'inteiro', largura: 11, somar: true },
      { titulo: 'Valor devolvido', chave: 'devolucoes_valor', tipo: 'moeda', largura: 16, somar: true },
      { titulo: 'Total líquido', tipo: 'moeda', largura: 18, somar: true,
        valor: (v) => (v.notas_valor || 0) + (v.devolucoes_valor || 0) },
    ],
    linhas: porVendedor.vendedores.filter((v) => v.notas_qtd > 0 || v.devolucoes_qtd > 0),
    totais: true,
  });

  excel.adicionarTabela(wb, 'Caixa', {
    colunas: [
      { titulo: 'Cód. operador', chave: 'operador', tipo: 'codigo', largura: 12 },
      { titulo: 'Operador', chave: 'nome', largura: 36 },
      { titulo: 'Cupons', chave: 'caixa_qtd', tipo: 'inteiro', largura: 10, somar: true },
      { titulo: 'Valor em cupons', chave: 'caixa_valor', tipo: 'moeda', largura: 18, somar: true },
      { titulo: 'Devoluções', chave: 'devolucoes_caixa_qtd', tipo: 'inteiro', largura: 11, somar: true },
      { titulo: 'Valor devolvido', chave: 'devolucoes_caixa_valor', tipo: 'moeda', largura: 16, somar: true },
      { titulo: 'Total líquido', chave: 'liquido', tipo: 'moeda', largura: 18, somar: true },
    ],
    linhas: porOperador.operadores,
    totais: true,
  });

  excel.adicionarTabela(wb, 'Notas', { colunas: COL_NOTAS, linhas: notas, totais: true });
  excel.adicionarTabela(wb, 'Cupons', { colunas: COL_CUPONS, linhas: cupons, totais: true });

  return { workbook: wb, nomeArquivo: `vendas_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

// ===== Detalhes =====
async function exportarNotasVendedor(query, params) {
  const dados = await vendas.notasDoVendedor(query, params);
  const t = dados.total;
  const wb = excel.novaPlanilha();

  excel.adicionarTabela(wb, 'Notas', {
    titulo: `Notas de ${dados.vendedor.nome}`,
    subtitulo: `${periodoTexto(dados.periodo)}. ${contar(t.faturadas_qtd, 'faturada', 'faturadas')}, ` +
      `${contar(t.canceladas_qtd, 'cancelada', 'canceladas')}, ${contar(t.devolucoes_qtd, 'devolução', 'devoluções')}` +
      (dados.limite_atingido ? '. ATENÇÃO: lista cortada no limite, diminua o período.' : ''),
    colunas: semColunas(COL_NOTAS, 'codigo_vendedor', 'vendedor'),
    linhas: dados.notas,
    totais: true,
  });

  const nome = excel.nomeSeguro(dados.vendedor.nome) || `vendedor_${dados.vendedor.codigo}`;
  return { workbook: wb, nomeArquivo: `notas_${nome}_${dados.periodo.inicio}_a_${dados.periodo.fim}.xlsx` };
}

async function exportarCuponsOperador(query, params) {
  const dados = await vendas.cuponsDoOperador(query, params);
  const t = dados.total;
  const wb = excel.novaPlanilha();

  excel.adicionarTabela(wb, 'Cupons', {
    titulo: `Cupons de ${dados.operador.nome}`,
    subtitulo: `${periodoTexto(dados.periodo)}. ${contar(t.emitidos_qtd, 'emitido', 'emitidos')}, ` +
      `${contar(t.cancelados_qtd, 'cancelado', 'cancelados')}, ${contar(t.devolucoes_qtd, 'devolução', 'devoluções')}` +
      (dados.limite_atingido ? '. ATENÇÃO: lista cortada no limite, diminua o período.' : ''),
    colunas: semColunas(COL_CUPONS, 'codigo_operador', 'operador'),
    linhas: dados.cupons,
    totais: true,
  });

  const nome = excel.nomeSeguro(dados.operador.nome) || `operador_${dados.operador.codigo}`;
  return { workbook: wb, nomeArquivo: `cupons_${nome}_${dados.periodo.inicio}_a_${dados.periodo.fim}.xlsx` };
}

module.exports = { exportarPainel, exportarNotasVendedor, exportarCuponsOperador };
