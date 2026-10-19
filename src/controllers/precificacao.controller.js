// Recebe os pedidos do módulo precificação e devolve JSON.

const service = require('../services/precificacao.service');

const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  inicio: acao(service.inicio),
};
