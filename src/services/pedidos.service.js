// Regras do pedido: valida o número antes de ir ao banco.
// Usado pelas duas telas (vendas e financeiro), cada uma pela sua chave.

const AppError = require('../utils/AppError');
const repo = require('../repositories/pedidos.repository');

async function detalhe(query, params) {
  const numero = Number(params.pedido);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new AppError('Número do pedido inválido');
  }
  const dados = await repo.pedido(numero);
  if (!dados) throw new AppError(`Pedido ${numero} não encontrado`, 404);
  return dados;
}

module.exports = { detalhe };
