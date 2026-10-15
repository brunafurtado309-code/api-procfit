// Recebe os pedidos de entradas e saídas e devolve JSON ou a planilha.

const service = require('../services/movimentos.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

// Planilha: o serviço monta, aqui só manda o arquivo
const planilha = (fn) => async (req, res, next) => {
  try {
    const { workbook, nomeArquivo } = await fn(req.query);
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
  produtos: acao(service.produtos),
  empresas: acao(service.empresas),
  movimentos: acao(service.movimentos),
  excel: planilha(service.exportar),
  notas: acao(service.notas),
  itensDaNota: acao(service.itensDaNota),
  excelNotas: planilha(service.exportarNotas),
};
