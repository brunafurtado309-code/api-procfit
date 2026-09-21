// Recebe o pedido de detalhe de um pedido (pré-venda) e devolve a resposta.

const service = require('../services/pedidos.service');

const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  detalhe: acao(service.detalhe),
};
