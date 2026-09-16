// URLs de vendas. Todas ficam sob /vendas (definido no server.js).

const { Router } = require('express');
const controller = require('../controllers/vendas.controller');

const router = Router();

router.get('/resumo', controller.resumo);
router.get('/por-dia', controller.porDia);
router.get('/por-loja', controller.porLoja);
router.get('/por-origem', controller.porOrigem);
router.get('/top-produtos', controller.topProdutos);

module.exports = router;
