// Recebe os pedidos do módulo precificação e devolve JSON.

const service = require('../services/precificacao.service');
const analise = require('../services/precificacao-analise.service');

// Toda ação recebe o mesmo: filtros da URL, partes do caminho, corpo enviado e quem está logado
const acao = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req.query, req.params, req.body, req.usuarioNome));
  } catch (err) {
    next(err);
  }
};

// Quem pode mudar a margem desejada (permissão "Edita preço", liberada na tela de Usuários)
const podeEditarPreco = (req) => (req.setores ?? []).includes('precificacao_edita');

module.exports = {
  // Análise: além dos filtros, avisa a tela se quem está logado pode editar a margem desejada
  analise: async (req, res, next) => {
    try {
      res.json(await analise.analise(req.query, { podeEditar: podeEditarPreco(req) }));
    } catch (err) {
      next(err);
    }
  },
  produtoAnalise: acao(analise.produto),
  // Categoria: também diz se quem está logado pode aplicar a margem desejada a todos os produtos dela
  categoriaAnalise: async (req, res, next) => {
    try {
      res.json(await analise.categoria(req.query, { podeEditar: podeEditarPreco(req) }));
    } catch (err) {
      next(err);
    }
  },
  definirMargens: acao(analise.definirMargens),
  podeEditarPreco,
  notas: acao(service.notas),
  fornecedores: acao(service.fornecedores),
  classificarFornecedor: acao(service.classificarFornecedor),
  classificarFornecedores: acao(service.classificarFornecedores),
  classificarNota: acao(service.classificarNota),
  classificarNfe: acao(service.classificarNfe),
  produtos: acao(service.produtos),
  classificarProdutos: acao(service.classificarProdutos),
};
