// Recebe a requisição do financeiro, chama o service e devolve a resposta.

const service = require('../services/financeiro.service');

const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  resumo: acao(service.resumo),
  cartoes: acao(service.cartoes),
  porCliente: acao(service.porCliente),
  porFaixaAtraso: acao(service.porFaixaAtraso),
  titulos: acao(service.titulos),
  fichaCliente: acao(service.fichaCliente),
};
