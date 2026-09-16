// Tratamento central de erros: todo erro das rotas termina aqui.

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Erro esperado (AppError): mostra a mensagem.
  if (err.status) {
    return res.status(err.status).json({ erro: err.message });
  }

  // Erro técnico: detalhe só no terminal, resposta genérica para quem chamou.
  console.error(err);
  res.status(500).json({ erro: 'Erro interno' });
}

module.exports = errorHandler;
