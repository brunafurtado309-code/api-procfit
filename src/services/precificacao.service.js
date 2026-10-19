// Regras do módulo precificação. Cada passo da construção acrescenta as suas aqui.

const repo = require('../repositories/precificacao.repository');

const inicio = () => repo.inicio();

module.exports = { inicio };
