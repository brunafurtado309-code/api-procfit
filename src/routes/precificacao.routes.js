// Rotas do Painel da Precificação (custo, preço, margem, estoque e giro por produto)

const express = require('express');
const controller = require('../controllers/precificacao.controller');

const router = express.Router();

// Notas de compra em quatro situações: parada, chegou e não foi lançada, entrou e sem entrada
router.get('/notas', controller.notas);

module.exports = router;
