// Rotas da Conciliação de títulos (protegidas pela chave do setor financeiro no server.js)
const express = require('express');
const controller = require('../controllers/conciliacao.controller');

const router = express.Router();

// GET /conciliacao/titulos?mes=2026-09
router.get('/titulos', controller.titulos);

// GET /conciliacao/pedidos-sem-nota?mes=2026-09
router.get('/pedidos-sem-nota', controller.pedidosSemNota);

// Extratos guardados no painel: envia uma vez, a conciliação lê sozinha depois
router.post('/extratos', controller.guardarExtrato);           // { arquivo, conta, origem, entradas }
router.get('/extratos', controller.extratosDoMes);             // ?mes=2026-09
router.get('/extratos/arquivos', controller.arquivosGuardados);
router.delete('/extratos', controller.removerExtrato);         // ?arquivo=nome.xlsx

module.exports = router;
