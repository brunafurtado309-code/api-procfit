// Auditoria (alertas de divergência). Fica sob /auditoria e só a conta principal acessa
// (definido no server.js). As regras estão em services/auditoria.service.js.

const express = require('express');
const service = require('../services/auditoria.service');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));

const responder = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    next(err);
  }
};

router.get('/', responder((req) => service.listar({ status: req.query.status })));  // ?status=aberto|ignorado|resolvido
router.get('/novos', responder(() => service.novos()));                              // bolinha do botão
router.post('/vistos', responder(() => service.marcarVistos()));
router.post('/rodar', responder(() => service.rodar()));                              // botão "Verificar agora"
router.patch('/:id', responder((req) => service.mudarStatus(req.params.id, req.body?.status, req.usuarioNome)));

module.exports = router;
