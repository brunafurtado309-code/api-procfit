// Cadastro, login, sair e "quem sou eu". Ficam sob /auth (definido no server.js) e sao publicas.

const express = require('express');
const service = require('../services/usuarios.service');
const { credencialRecebida, identificarComSessao, COOKIE_SESSAO } = require('../middlewares/auth');

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
    res.json(await fn(req, res));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Falha no servidor. Tente de novo.' });
  }
};

const opcoesCookie = (req) => ({
  path: '/',
  sameSite: 'lax',
  secure: req.secure || req.get('x-forwarded-proto') === 'https',
});

router.post('/cadastro', limitarTentativas, responder((req) => service.cadastrar(req.body || {})));

router.post(
  '/login',
  limitarTentativas,
  responder(async (req, res) => {
    const resultado = await service.entrar(req.body || {});
    res.cookie(COOKIE_SESSAO, resultado.token, { ...opcoesCookie(req), maxAge: service.HORAS_SESSAO * 60 * 60 * 1000 });
    return resultado;
  })
);

router.post(
  '/sair',
  responder(async (req, res) => {
    await service.sair(credencialRecebida(req));
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  })
);

router.get(
  '/eu',
  responder(async (req) => {
    const quem = await identificarComSessao(req);
    if (!quem) {
      const e = new Error('N\u00e3o autorizado');
      e.status = 401;
      throw e;
    }
    return { nome: quem.nome, setores: quem.setores, mestre: !!quem.mestre };
  })
);

module.exports = router;