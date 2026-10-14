// Rotas da tabela de preços (só código, produto e preço de varejo)

const express = require('express');
const controller = require('../controllers/precos.controller');

const router = express.Router();

router.get('/varejo', controller.lista);
router.get('/varejo/excel', controller.excel);

module.exports = router;
