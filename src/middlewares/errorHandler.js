// Tratamento central de erros: todo erro das rotas termina aqui.

// Codigos que o pacote mssql usa quando nao consegue falar com o banco
const FALHAS_DE_CONEXAO = ['ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ELOGIN', 'EINSTLOOKUP', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EALREADYCONNECTING'];

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Erro esperado (AppError): mostra a mensagem.
  if (err.status) {
    return res.status(err.status).json({ erro: err.message });
  }

  const quando = new Date().toLocaleString('pt-BR');

  // Banco do PROCFIT fora do ar ou inacessivel: mensagem clara para quem usa o painel.
  // A conexao se refaz sozinha na proxima tentativa (ver config/db.js).
  if (err.name === 'ConnectionError' || (err.code && FALHAS_DE_CONEXAO.includes(err.code) && err.name !== 'RequestError')) {
    console.error(`[${quando}] Sem conexao com o banco (${err.code}): ${err.message}`);
    return res.status(503).json({ erro: 'Sem conex\u00e3o com o banco do PROCFIT agora. Tente de novo em alguns minutos.' });
  }

  // Consulta que passou do tempo limite
  if (err.name === 'RequestError' && err.code === 'ETIMEOUT') {
    console.error(`[${quando}] Consulta demorou demais: ${err.message}`);
    return res.status(504).json({ erro: 'A consulta demorou demais para responder. Tente um per\u00edodo menor ou tente de novo.' });
  }

  // Erro tecnico: detalhe so no terminal, resposta generica para quem chamou.
  console.error(`[${quando}]`, err);
  res.status(500).json({ erro: 'Erro interno' });
}

module.exports = errorHandler;