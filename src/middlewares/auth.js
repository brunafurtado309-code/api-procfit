// Verificacao de acesso. Aceita dois tipos de credencial no cabecalho x-api-key:
//  - as chaves do .env (API_KEY abre tudo; API_KEY_VENDAS etc. abrem um setor)
//  - NOVO: o token de login de um usuario aprovado (comeca com "sess_")

const crypto = require('crypto');

const SETORES = ['vendas', 'financeiro', 'admin', 'faturamento'];
const PREFIXO_SESSAO = 'sess_';

// Monta a lista de chaves a cada requisicao (o .env pode mudar sem reiniciar tudo).
// Formato: [{ chave, setores: ['vendas'], nome: 'API_KEY_VENDAS' }]
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

// Devolve a configuracao da chave recebida, ou null se nao for nenhuma (so chaves do .env)
function identificar(req) {
  const recebida = req.get('x-api-key') || '';
  if (!recebida) return null;
  return chavesConfiguradas().find((c) => iguais(recebida, c.chave)) || null;
}

// NOVO: igual ao identificar, mas tambem reconhece o login de usuario
async function identificarComSessao(req) {
  const recebida = req.get('x-api-key') || '';
  if (!recebida.startsWith(PREFIXO_SESSAO)) return identificar(req);

  // carregado aqui dentro para evitar dependencia circular com o service
  const { sessaoPorToken } = require('../services/usuarios.service');
  const sessao = await sessaoPorToken(recebida);
  return sessao ? { setores: sessao.setores, nome: sessao.nome, usuario: true } : null;
}

// exigirChave('financeiro') protege uma rota de setor.
// exigirChave() aceita qualquer chave valida (usado por /acessos).
function exigirChave(setor = null) {
  return async function (req, res, next) {
    try {
      const recebida = req.get('x-api-key') || '';
      if (!recebida.startsWith(PREFIXO_SESSAO) && chavesConfiguradas().length === 0) {
        console.error('Nenhuma API_KEY configurada no .env');
        return res.status(500).json({ erro: 'Configura\u00e7\u00e3o do servidor incompleta' });
      }

      const identificada = await identificarComSessao(req);
      if (!identificada) {
        return res.status(401).json({ erro: 'N\u00e3o autorizado' });
      }

      // Chave valida, mas de outro setor: a mensagem diz isso, para nao parecer chave errada
      if (setor && !identificada.setores.includes(setor)) {
        return res.status(403).json({ erro: `Esta chave n\u00e3o tem acesso ao setor "${setor}"` });
      }

      req.setores = identificada.setores;
      req.usuarioNome = identificada.nome || null;
      req.ehMestra = !identificada.usuario && identificada.nome === 'API_KEY'; // NOVO
      next();
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  };
}

// NOVO: so a chave mestra (API_KEY) passa. Usado na liberacao de usuarios,
// para que nenhum usuario logado (nem do setor admin) consiga dar acesso a outros.
function exigirMestra() {
  return function (req, res, next) {
    if (!process.env.API_KEY) {
      console.error('API_KEY (chave mestra) n\u00e3o configurada');
      return res.status(500).json({ erro: 'Configura\u00e7\u00e3o do servidor incompleta' });
    }
    const recebida = req.get('x-api-key') || '';
    if (!recebida || !iguais(recebida, process.env.API_KEY)) {
      return res.status(403).json({ erro: 'Somente a administradora principal pode liberar acessos.' });
    }
    req.setores = SETORES;
    next();
  };
}

module.exports = { exigirChave, exigirMestra, identificar, identificarComSessao, SETORES, PREFIXO_SESSAO };