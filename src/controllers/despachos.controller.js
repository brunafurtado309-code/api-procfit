// Recebe os pedidos da aba Despachos e devolve JSON ou a planilha.

const service = require('../services/despachos.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

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
  lista: acao(service.lista),
  detalhe: acao(service.detalhe),
  excel: download(service.exportar),
};
