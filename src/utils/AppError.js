// Erro "esperado" (ex.: parâmetro inválido).
// Diferente de um erro técnico, a mensagem PODE ser mostrada a quem chamou a API.

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = AppError;
