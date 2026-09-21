// Recebe a requisição do financeiro, chama o service e devolve a resposta.

const service = require('../services/financeiro.service');
const exportacao = require('../services/exportacao-financeiro.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
  cartoes: acao(service.cartoes),
  indicadores: acao(service.indicadores),
  previsao: acao(service.previsao),
  porCliente: acao(service.porCliente),
  porFaixaAtraso: acao(service.porFaixaAtraso),
  titulos: acao(service.titulos),
  fichaCliente: acao(service.fichaCliente),
  excel: download(exportacao.exportarTitulos),
};
