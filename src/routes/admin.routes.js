// Rotas do módulo administrativo (usuários e rastreio de uso do PROCFIT)

const express = require('express');
const controller = require('../controllers/admin.controller');

const router = express.Router();

router.get('/usuarios', controller.usuarios);
router.get('/usuarios/excel', controller.excel);
router.get('/atividade', controller.atividade);
router.get('/recebimentos', controller.recebimentos);

module.exports = router;
