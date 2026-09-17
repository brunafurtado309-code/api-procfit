// Recebe a requisição, chama o service e devolve a resposta.

const service = require('../services/vendas.service');
const exportacao = require('../services/exportacao.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Envolve cada ação para mandar qualquer erro ao errorHandler.
// O service recebe os filtros (query) e os parâmetros da URL (params).
const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

// Para downloads: o service devolve a planilha e o nome do arquivo.
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
  notasDoVendedor: acao(service.notasDoVendedor),
  porOperador: acao(service.porOperador),
  cuponsDoOperador: acao(service.cuponsDoOperador),
  pesquisar: acao(service.pesquisar),
  todasNotas: acao(service.todasNotas),
  todosCupons: acao(service.todosCupons),
  listaDevolucoes: acao(service.listaDevolucoes),
  listaDescontos: acao(service.listaDescontos),
  itensDoDocumento: acao(service.itensDoDocumento),
  topProdutos: acao(service.topProdutos),
  exportarPainel: download(exportacao.exportarPainel),
  exportarNotas: download(exportacao.exportarNotasVendedor),
  exportarCupons: download(exportacao.exportarCuponsOperador),
};
