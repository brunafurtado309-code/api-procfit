// Protege as rotas: só passa quem enviar o cabeçalho "x-api-key" com a chave do .env.

const crypto = require('crypto');

function exigirChave(req, res, next) {
  const esperada = process.env.API_KEY;

  // Se a chave não estiver configurada, a API recusa tudo (nunca fica "aberta" por engano).
  if (!esperada) {
    console.error('API_KEY não configurada no .env');
    return res.status(500).json({ erro: 'Configuração do servidor incompleta' });
  }

  const recebida = Buffer.from(req.get('x-api-key') || '');
  const correta = Buffer.from(esperada);

  // timingSafeEqual compara em tempo constante (evita ataques de "adivinhação por tempo").
  if (recebida.length !== correta.length || !crypto.timingSafeEqual(recebida, correta)) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  next();
}

module.exports = exigirChave;
