// Recebe os pedidos da tabela de preços e devolve JSON ou a planilha.

const service = require('../services/precos.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = {
  lista: async (req, res, next) => {
    try {
      res.json(await service.lista());
    } catch (err) {
      next(err);
    }
  },
  excel: async (req, res, next) => {
    try {
      const { workbook, nomeArquivo } = await service.exportar();
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
