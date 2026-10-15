// Rotas de entradas e saídas do estoque (só quantidades)

const express = require('express');
const controller = require('../controllers/movimentos.controller');

const router = express.Router();

router.get('/notas', controller.notas);
router.get('/notas/excel', controller.excelNotas);
router.get('/notas/itens', controller.itensDaNota);
router.get('/produtos', controller.produtos);
router.get('/produtos/excel', controller.excel);
router.get('/empresas', controller.empresas);
router.get('/produtos/:produto', controller.movimentos);

module.exports = router;
