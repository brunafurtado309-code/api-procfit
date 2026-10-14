// Rotas do módulo logística (compra, venda, estoque e preço por produto)

const express = require('express');
const controller = require('../controllers/logistica.controller');

const router = express.Router();

router.get('/produtos', controller.painel);
router.get('/produtos/excel', controller.excel);
router.get('/empresas', controller.empresas);
router.get('/produtos/:produto', controller.produto);

module.exports = router;
