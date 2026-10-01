// Cadastro, login e sair. Ficam sob /auth (definido no server.js) e sao publicas.

const express = require('express');
const service = require('../services/usuarios.service');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));

// Freio contra quem tenta adivinhar senha: 10 tentativas a cada 15 minutos por endereco
const tentativas = new Map();
function limitarTentativas(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const agora = Date.now();
  const registro = tentativas.get(ip) || { vezes: 0, desde: agora };
  if (agora - registro.desde > 15 * 60 * 1000) {
    registro.vezes = 0;
    registro.desde = agora;
  }
  registro.vezes += 1;
  tentativas.set(ip, registro);
  if (registro.vezes > 10) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  }
  next();
}

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Falha no servidor. Tente de novo.' });
  }
};

router.post('/cadastro', limitarTentativas, responder((req) => service.cadastrar(req.body || {})));
router.post('/login', limitarTentativas, responder((req) => service.entrar(req.body || {})));
router.post('/sair', responder((req) => service.sair(req.get('x-api-key'))));

module.exports = router;
