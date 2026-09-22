// Recebe os pedidos do módulo administrativo e devolve JSON ou a planilha.

const service = require('../services/admin.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  usuarios: acao(service.usuarios),
  atividade: acao(service.atividade),
  recebimentos: acao(service.recebimentos),
  excel: async (req, res, next) => {
    try {
      const { workbook, nomeArquivo } = await service.exportar(req.query);
      res.setHeader('Content-Type', TIPO_XLSX);
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      next(err);
    }
  },
};
