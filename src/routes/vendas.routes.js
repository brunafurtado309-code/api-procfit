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

// Janelas de detalhe (clique no nome do vendedor/operador, nos cartões e na pesquisa)
router.get('/vendedores/:vendedor/notas', controller.notasDoVendedor);
router.get('/vendedores/:vendedor/notas/excel', controller.excelNotasVendedor);
router.get('/operadores/:operador/cupons', controller.cuponsDoOperador);
router.get('/operadores/:operador/cupons/excel', controller.excelCuponsOperador);
router.get('/pesquisa', controller.pesquisar);
router.get('/notas', controller.todasNotas);
router.get('/cupons', controller.todosCupons);
router.get('/devolucoes', controller.listaDevolucoes);
router.get('/descontos', controller.listaDescontos);
router.get('/itens', controller.itensDoDocumento);
router.get('/exportar/excel', controller.excelPainel);              // botão "Baixar Excel" do painel
router.get('/faturamento-vendedores', faturamento.vendedores);       // resumo por vendedor
router.get('/faturamento-vendedores/pedidos', faturamento.analise);  // pedidos de um vendedor
router.get('/pedidos/:pedido', pedidos.detalhe);                     // janela do pedido

module.exports = router;
