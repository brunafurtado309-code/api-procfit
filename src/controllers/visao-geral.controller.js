// Recebe o pedido da Visão geral do financeiro e devolve o JSON da tela.

const service = require('../services/visao-geral.service');

async function painel(req, res, next) {
  try {
    res.json(await service.painel(req.query));
  } catch (err) {
    next(err);
  }
}

module.exports = { painel };
