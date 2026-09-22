// URLs do financeiro. Todas ficam sob /financeiro (definido no server.js).

const { Router } = require('express');
const controller = require('../controllers/financeiro.controller');
const pedidos = require('../controllers/pedidos.controller');
const despachos = require('../controllers/despachos.controller');
const pagar = require('../controllers/pagar.controller');
const clientesCredito = require('../controllers/clientes-credito.controller');

const router = Router();

router.get('/resumo', controller.resumo);
router.get('/cartoes', controller.cartoes);
router.get('/indicadores', controller.indicadores);
router.get('/previsao', controller.previsao);
router.get('/clientes', controller.porCliente);
router.get('/faixas-atraso', controller.porFaixaAtraso);
router.get('/titulos', controller.titulos);
router.get('/baixas-mes', controller.baixasPorMes);
// Excel do que está filtrado na tela (mesmos filtros da lista)
router.get('/excel', controller.excel);
// Detalhe do pedido (produtos, nota e cupom gerados)
router.get('/pedidos/:pedido', pedidos.detalhe);

// Aba Despachos: acertos de carga (a rota do Excel vem antes da rota com :acerto)
router.get('/despachos', despachos.lista);
router.get('/despachos/excel', despachos.excel);
router.get('/despachos/:acerto', despachos.detalhe);

// Contas a pagar (mesma chave do financeiro)
router.get('/pagar', pagar.painel);
router.get('/pagar/excel', pagar.excel);
router.get('/pagar/pagamentos', pagar.pagamentos);

// Clientes e crédito (contas a receber)
router.get('/clientes-credito', clientesCredito.analise);
router.get('/clientes-credito/excel', clientesCredito.excel);
// Precisa ficar DEPOIS de /clientes: o Express testa na ordem, e uma rota
// com parâmetro captura tudo que vier antes dela.
router.get('/clientes/:entidade', controller.fichaCliente);

module.exports = router;
