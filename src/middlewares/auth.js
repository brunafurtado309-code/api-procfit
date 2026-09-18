// Protege as rotas: cada chave do .env libera um ou mais SETORES.
//
// No .env:
//   API_KEY=...                  chave geral (abre todos os setores) - opcional
//   API_KEY_VENDAS=...           abre só /vendas
//   API_KEY_FINANCEIRO=...       abre só /financeiro
//
// Assim dá para entregar a chave do financeiro ao setor financeiro sem que ele
// enxergue vendas, e trocar a chave de um setor sem mexer nos outros.

const crypto = require('crypto');

const SETORES = ['vendas', 'financeiro'];

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

// Devolve a configuração da chave recebida, ou null se não for nenhuma
function identificar(req) {
  const recebida = req.get('x-api-key') || '';
  if (!recebida) return null;
  return chavesConfiguradas().find((c) => iguais(recebida, c.chave)) || null;
}

// exigirChave('financeiro') protege uma rota de setor.
// exigirChave() aceita qualquer chave válida (usado por /acessos).
function exigirChave(setor = null) {
  return function (req, res, next) {
    if (chavesConfiguradas().length === 0) {
      console.error('Nenhuma API_KEY configurada no .env');
      return res.status(500).json({ erro: 'Configuração do servidor incompleta' });
    }

    const identificada = identificar(req);
    if (!identificada) {
      return res.status(401).json({ erro: 'Não autorizado' });
    }

    // Chave válida, mas de outro setor: a mensagem diz isso, para não parecer chave errada
    if (setor && !identificada.setores.includes(setor)) {
      return res.status(403).json({ erro: `Esta chave não tem acesso ao setor "${setor}"` });
    }

    req.setores = identificada.setores;
    next();
  };
}

module.exports = { exigirChave, identificar, SETORES };
