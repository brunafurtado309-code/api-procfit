// URLs de vendas. Todas ficam sob /vendas (definido no server.js).

const { Router } = require('express');
const controller = require('../controllers/vendas.controller');

const router = Router();

router.get('/resumo', controller.resumo);
router.get('/por-dia', controller.porDia);
router.get('/por-loja', controller.porLoja);
router.get('/por-origem', controller.porOrigem);
router.get('/por-vendedor', controller.porVendedor);
router.get('/vendedores/:vendedor/notas', controller.notasDoVendedor);
router.get('/por-operador', controller.porOperador);
router.get('/operadores/:operador/cupons', controller.cuponsDoOperador);
router.get('/top-produtos', controller.topProdutos);
router.get('/pesquisa', controller.pesquisar);

// Listas dos cartões e produtos de cada documento
router.get('/notas', controller.todasNotas);
router.get('/cupons', controller.todosCupons);
router.get('/devolucoes', controller.listaDevolucoes);
router.get('/descontos', controller.listaDescontos);
router.get('/itens', controller.itensDoDocumento);

// Downloads em Excel
router.get('/exportar/excel', controller.exportarPainel);
router.get('/vendedores/:vendedor/notas/excel', controller.exportarNotas);
router.get('/operadores/:operador/cupons/excel', controller.exportarCupons);

module.exports = router;
