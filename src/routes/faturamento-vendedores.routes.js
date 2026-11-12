// Sub-tela "Faturados por vendedor" do Faturamento.
// Tem permissão própria (faturamento_vendedores), liberada à parte na tela de Usuários:
// por isso fica num router separado, montado no server.js antes do /faturamento.

const express = require('express');
const controller = require('../controllers/faturamento.controller');

const router = express.Router();

router.get('/', controller.notasVendedor);
router.get('/excel', controller.excelNotasVendedor);

module.exports = router;
