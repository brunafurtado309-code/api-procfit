// Aprovacao de usuarios. Fica sob /usuarios e so o setor admin acessa (definido no server.js).

const express = require('express');
const service = require('../services/usuarios.service');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Falha no servidor. Tente de novo.' });
  }
};

router.get('/', responder(() => service.listar()));
router.patch('/:id', responder((req) => service.atualizar(req.params.id, req.body || {})));

module.exports = router;
