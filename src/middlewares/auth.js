// Verificacao de acesso. Aceita dois tipos de credencial no cabecalho x-api-key:
//  - as chaves do .env (API_KEY abre tudo; API_KEY_VENDAS etc. abrem um setor)
//  - NOVO: o token de login de um usuario aprovado (comeca com "sess_")

const crypto = require('crypto');

const SETORES = ['vendas', 'financeiro', 'admin', 'faturamento'];
const PREFIXO_SESSAO = 'sess_';

// Monta a lista de chaves a cada requisição (o .env pode mudar sem reiniciar tudo).
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

// Compara em tempo constante (evita adivinhação por tempo de resposta)
function iguais(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Devolve a configuração da chave recebida, ou null se não for nenhuma (só chaves do .env)
function identificar(req) {
  const recebida = req.get('x-api-key') || '';
  if (!recebida) return null;
  return chavesConfiguradas().find((c) => iguais(recebida, c.chave)) || null;
}

// NOVO: igual ao identificar, mas também reconhece o login de usuário
async function identificarComSessao(req) {
  const recebida = req.get('x-api-key') || '';
  if (!recebida.startsWith(PREFIXO_SESSAO)) return identificar(req);

  // carregado aqui dentro para evitar dependência circular com o service
  const { sessaoPorToken } = require('../services/usuarios.service');
  const sessao = await sessaoPorToken(recebida);
  return sessao ? { setores: sessao.setores, nome: sessao.nome } : null;
}

// exigirChave('financeiro') protege uma rota de setor.
// exigirChave() aceita qualquer chave válida (usado por /acessos).
function exigirChave(setor = null) {
  return async function (req, res, next) {
    try {
      const recebida = req.get('x-api-key') || '';
      if (!recebida.startsWith(PREFIXO_SESSAO) && chavesConfiguradas().length === 0) {
        console.error('Nenhuma API_KEY configurada no .env');
        return res.status(500).json({ erro: 'Configuração do servidor incompleta' });
      }

      const identificada = await identificarComSessao(req);
      if (!identificada) {
        return res.status(401).json({ erro: 'Não autorizado' });
      }

      // Chave válida, mas de outro setor: a mensagem diz isso, para não parecer chave errada
      if (setor && !identificada.setores.includes(setor)) {
        return res.status(403).json({ erro: `Esta chave não tem acesso ao setor "${setor}"` });
      }

      req.setores = identificada.setores;
      req.usuarioNome = identificada.nome || null;
      next();
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  };
}

module.exports = { exigirChave, identificar, identificarComSessao, SETORES, PREFIXO_SESSAO };
