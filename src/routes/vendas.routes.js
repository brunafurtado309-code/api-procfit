// URLs de vendas. Todas ficam sob /vendas (definido no server.js).

const { Router } = require('express');
const controller = require('../controllers/vendas.controller');
// Faturamento por vendedor e detalhe do pedido: mesmas regras do módulo faturamento,
// liberadas também para quem tem o setor vendas (ex.: diretoria)
const faturamento = require('../controllers/faturamento.controller');
const pedidos = require('../controllers/pedidos.controller');

const router = Router();

router.get('/resumo', controller.resumo);
router.get('/por-dia', controller.porDia);
router.get('/por-loja', controller.porLoja);
router.get('/por-origem', controller.porOrigem);
router.get('/por-vendedor', controller.porVendedor);
router.get('/por-operador', controller.porOperador); // NOVO: vendas por operador de caixa
router.get('/top-produtos', controller.topProdutos);
router.get('/faturamento-vendedores', faturamento.vendedores);       // resumo por vendedor
router.get('/faturamento-vendedores/pedidos', faturamento.analise);  // pedidos de um vendedor
router.get('/pedidos/:pedido', pedidos.detalhe);                     // janela do pedido

module.exports = router;
