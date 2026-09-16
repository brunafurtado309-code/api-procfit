// Recebe a requisição, chama o service e devolve a resposta.

const service = require('../services/vendas.service');

// Envolve cada ação para mandar qualquer erro ao errorHandler.
// O service recebe os filtros (query) e os parâmetros da URL (params).
const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params));
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
  notasDoVendedor: acao(service.notasDoVendedor),
  topProdutos: acao(service.topProdutos),
};
