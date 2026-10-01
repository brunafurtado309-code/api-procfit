// Verificacao de acesso. Aceita:
//  - o login de usuario (token "sess_...", no cabecalho x-api-key ou no cookie painel_sessao)
//  - as chaves do .env (API_KEY abre tudo; API_KEY_VENDAS etc. abrem um setor) - so para emergencia

const crypto = require('crypto');

const SETORES = ['vendas', 'financeiro', 'admin', 'faturamento'];
const PREFIXO_SESSAO = 'sess_';
const COOKIE_SESSAO = 'painel_sessao';

// Monta a lista de chaves a cada requisicao (o .env pode mudar sem reiniciar tudo).
function chavesConfiguradas() {
  const lista = [];
  if (process.env.API_KEY) {
    lista.push({ chave: process.env.API_KEY, setores: SETORES, nome: 'API_KEY' });
  }
  for (const setor of SETORES) {
    const valor = process.env[`API_KEY_${setor.toUpperCase()}`];
    if (valor) {
      lista.push({ chave: valor, setores: [setor], nome: `API_KEY_${setor.toUpperCase()}` });
    }
  }
  return lista;
}

// Compara em tempo constante (evita adivinhacao por tempo de resposta)
function iguais(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lerCookie(req, nome) {
  const cabecalho = req.headers.cookie || '';
  for (const parte of cabecalho.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) return decodeURIComponent(resto.join('='));
  }
  return '';
}

// O token pode vir no cabecalho (como o painel sempre fez) ou no cookie do login
function credencialRecebida(req) {
  return req.get('x-api-key') || lerCookie(req, COOKIE_SESSAO) || '';
}

// So as chaves do .env
function identificar(req) {
  const recebida = req.get('x-api-key') || '';
  if (!recebida) return null;
  return chavesConfiguradas().find((c) => iguais(recebida, c.chave)) || null;
}

// Reconhece login de usuario e chaves do .env
async function identificarComSessao(req) {
  const recebida = credencialRecebida(req);
  if (!recebida) return null;

  if (recebida.startsWith(PREFIXO_SESSAO)) {
    // carregado aqui dentro para evitar dependencia circular com o service
    const { sessaoPorToken } = require('../services/usuarios.service');
    const sessao = await sessaoPorToken(recebida);
    return sessao ? { setores: sessao.setores, nome: sessao.nome, usuario: true, mestre: sessao.mestre } : null;
  }

  const chave = chavesConfiguradas().find((c) => iguais(recebida, c.chave)) || null;
  return chave ? { ...chave, mestre: chave.nome === 'API_KEY' } : null;
}

// exigirChave('financeiro') protege uma rota de setor; exigirChave() aceita qualquer acesso valido.
function exigirChave(setor = null) {
  return async function (req, res, next) {
    try {
      const identificada = await identificarComSessao(req);
      if (!identificada) {
        return res.status(401).json({ erro: 'N\u00e3o autorizado' });
      }
      if (setor && !identificada.setores.includes(setor)) {
        return res.status(403).json({ erro: `Voc\u00ea n\u00e3o tem acesso ao setor "${setor}"` });
      }
      req.setores = identificada.setores;
      req.usuarioNome = identificada.nome || null;
      req.ehMestra = !!identificada.mestre;
      next();
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  };
}

// So a conta principal (ADMIN_EMAIL) ou a chave mestra de emergencia (API_KEY)
function exigirMestra() {
  return async function (req, res, next) {
    try {
      const identificada = await identificarComSessao(req);
      if (!identificada || !identificada.mestre) {
        return res.status(403).json({ erro: 'Somente a administradora principal pode liberar acessos.' });
      }
      req.setores = identificada.setores;
      req.ehMestra = true;
      next();
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  };
}

// Sem login valido, qualquer tela do painel leva para a tela de login
async function exigirLoginNaPagina(req, res, next) {
  if (req.method !== 'GET') return next();
  const caminho = req.path;
  const ehTela = caminho === '/painel/' || /^\/painel\/[^/]+\.html$/.test(caminho);
  if (!ehTela || caminho === '/painel/login.html') return next();

  try {
    const token = lerCookie(req, COOKIE_SESSAO);
    if (token.startsWith(PREFIXO_SESSAO)) {
      const { sessaoPorToken } = require('../services/usuarios.service');
      if (await sessaoPorToken(token)) return next();
    }
  } catch (err) {
    console.error('Falha ao conferir o login:', err.message);
  }

  res.clearCookie(COOKIE_SESSAO, { path: '/' });
  return res.redirect('/painel/login.html');
}

module.exports = {
  exigirChave,
  exigirMestra,
  exigirLoginNaPagina,
  identificar,
  identificarComSessao,
  credencialRecebida,
  SETORES,
  PREFIXO_SESSAO,
  COOKIE_SESSAO,
};