// Rotas do módulo faturamento (análise de pedidos)

const express = require('express');
const controller = require('../controllers/faturamento.controller');

const router = express.Router();

router.get('/pedidos', controller.analise);
router.get('/pedidos/excel', controller.excel);
router.get('/pedidos/vendedores', controller.vendedores);
router.get('/pedidos/:pedido', controller.detalhe);

module.exports = router;
