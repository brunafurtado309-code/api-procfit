// Rotas do Painel da Precificação (custo, preço, margem, estoque e giro por produto)

const express = require('express');
const controller = require('../controllers/precificacao.controller');

const router = express.Router();

// Notas de compra por situação: parada, a classificar, chegou e não foi lançada, entrou, produção ou consumo
router.get('/notas', controller.notas);

// Classificação (gravada no banco do painel, nunca no PROCFIT)
router.get('/fornecedores', controller.fornecedores);
router.put('/fornecedores', controller.classificarFornecedores);           // { fornecedores: [códigos], tipo }
router.put('/fornecedores/:fornecedor', controller.classificarFornecedor); // { tipo } ou { tipo: null }
router.put('/notas/:nota', controller.classificarNota);                   // { tipo } ou { tipo: null }
router.put('/nfe/:registro', controller.classificarNfe);                  // nota que não virou nota de compra

// Produtos: tipo (revenda, produção própria, insumo, uso interno) e categoria
router.get('/produtos', controller.produtos);
router.put('/produtos', controller.classificarProdutos); // { produtos: [códigos], tipo?, categoria?, revisado? }

module.exports = router;
