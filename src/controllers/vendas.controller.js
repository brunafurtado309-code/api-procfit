// Recebe a requisicao, chama o service e devolve a resposta.

const service = require('../services/vendas.service');
const exportacao = require('../services/exportacao.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Envolve cada acao para mandar qualquer erro ao errorHandler.
// Passa tambem os parametros da URL (ex.: o codigo do vendedor em /vendedores/12/notas).
const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

// Gera a planilha e manda como download
const download = (fn) => async (req, res, next) => {
  try {
    const { workbook, nomeArquivo } = await fn(req.query, req.params);
    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  resumo: acao(service.resumo),
  porDia: acao(service.porDia),
  porLoja: acao(service.porLoja),
  porOrigem: acao(service.porOrigem),
  porVendedor: acao(service.porVendedor),
  porOperador: acao(service.porOperador),
  topProdutos: acao(service.topProdutos),
  // Janelas de detalhe da tela de vendas (o service ja tinha, faltava ligar)
  notasDoVendedor: acao(service.notasDoVendedor),
  cuponsDoOperador: acao(service.cuponsDoOperador),
  pesquisar: acao(service.pesquisar),
  todasNotas: acao(service.todasNotas),
  todosCupons: acao(service.todosCupons),
  listaDevolucoes: acao(service.listaDevolucoes),
  listaDescontos: acao(service.listaDescontos),
  itensDoDocumento: acao(service.itensDoDocumento),
  // Excel
  excelPainel: download(exportacao.exportarPainel),
  excelNotasVendedor: download(exportacao.exportarNotasVendedor),
  excelCuponsOperador: download(exportacao.exportarCuponsOperador),
};
