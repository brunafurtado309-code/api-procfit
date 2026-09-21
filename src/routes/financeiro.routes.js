// URLs do financeiro. Todas ficam sob /financeiro (definido no server.js).

const { Router } = require('express');
const controller = require('../controllers/financeiro.controller');

const router = Router();

router.get('/resumo', controller.resumo);
router.get('/cartoes', controller.cartoes);
router.get('/indicadores', controller.indicadores);
router.get('/previsao', controller.previsao);
router.get('/clientes', controller.porCliente);
router.get('/faixas-atraso', controller.porFaixaAtraso);
router.get('/titulos', controller.titulos);
// Excel do que está filtrado na tela (mesmos filtros da lista)
router.get('/excel', controller.excel);
// Precisa ficar DEPOIS de /clientes: o Express testa na ordem, e uma rota
// com parâmetro captura tudo que vier antes dela.
router.get('/clientes/:entidade', controller.fichaCliente);

module.exports = router;
