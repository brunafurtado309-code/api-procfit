// Rotas do módulo faturamento (análise de pedidos)

const express = require('express');
const controller = require('../controllers/faturamento.controller');
const service = require('../services/faturamento.service');

const router = express.Router();

router.get('/pedidos', controller.analise);
router.get('/pedidos/excel', controller.excel);
router.get('/pedidos/vendedores', controller.vendedores);
router.get('/pedidos/:pedido', controller.detalhe);
router.get('/notas-canceladas', controller.notasCanceladas); // notas canceladas que ainda mexem no financeiro
router.get('/notas-canceladas/todos', controller.cancelamentosTodos); // tudo o que foi cancelado: nota, devolução, cupom e pedido
// Todas as notas de devolução do período, com o título financeiro que cada uma gerou (ou não)
router.get('/devolucoes', async (req, res, next) => {
  try {
    res.json(await service.devolucoes(req.query));
  } catch (erro) {
    next(erro);
  }
});

module.exports = router;
