// Recebe os pedidos do módulo precificação e devolve JSON.

const service = require('../services/precificacao.service');

// Toda ação recebe o mesmo: filtros da URL, partes do caminho, corpo enviado e quem está logado
const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params, req.body, req.usuarioNome));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  notas: acao(service.notas),
  fornecedores: acao(service.fornecedores),
  classificarFornecedor: acao(service.classificarFornecedor),
  classificarFornecedores: acao(service.classificarFornecedores),
  classificarNota: acao(service.classificarNota),
};
