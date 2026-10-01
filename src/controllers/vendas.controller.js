// Recebe a requisicao, chama o service e devolve a resposta.

const service = require('../services/vendas.service');

// Envolve cada acao para mandar qualquer erro ao errorHandler.
const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query));
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
  porOperador: acao(service.porOperador), // NOVO: o service ja tinha, faltava ligar
  topProdutos: acao(service.topProdutos),
};
