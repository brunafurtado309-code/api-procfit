// URLs do financeiro. Todas ficam sob /financeiro (definido no server.js).

const { Router } = require('express');
const controller = require('../controllers/financeiro.controller');

const router = Router();

router.get('/resumo', controller.resumo);
router.get('/cartoes', controller.cartoes);
router.get('/clientes', controller.porCliente);
router.get('/faixas-atraso', controller.porFaixaAtraso);
router.get('/titulos', controller.titulos);
router.get('/clientes/:entidade', controller.fichaCliente);

module.exports = router;
