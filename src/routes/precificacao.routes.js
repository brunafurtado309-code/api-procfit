// Rotas do Painel da Precificação (custo, preço, margem, estoque e giro por produto)

const express = require('express');
const controller = require('../controllers/precificacao.controller');

const router = express.Router();

// Análise: venda, margem, categorias, giro e as decisões de preço (só leitura)
// ?dias=30|60|90|180 &tipo=revenda|producao &categoria=Nome (ou __sem) &atualizar=1 (lê o PROCFIT de novo)
router.get('/analise', controller.analise);
// Um produto: venda por dia, semana e mês, com o pico, a maior queda e as mudanças de preço perto deles
router.get('/analise/produto/:codigo', controller.produtoAnalise);

// Margem desejada por produto: só quem tem a permissão "Edita preço" (a pessoa da precificação)
// { produtos: [códigos], margem: 0.15 } ou { produtos: [...], margem: null } para tirar
const exigirEdicaoDePreco = (req, res, next) => (controller.podeEditarPreco(req)
  ? next()
  : res.status(403).json({ erro: 'Só quem tem a permissão "Edita preço" muda a margem desejada.' }));
router.put('/margens', exigirEdicaoDePreco, controller.definirMargens);

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
