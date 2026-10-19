// Rotas do Painel da Precificação (custo, preço, margem, estoque e giro por produto)

const express = require('express');
const controller = require('../controllers/precificacao.controller');

const router = express.Router();

router.get('/inicio', controller.inicio);

module.exports = router;
