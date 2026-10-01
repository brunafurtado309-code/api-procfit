// Recebe o pedido da tela, valida o mês e devolve a resposta.
const service = require('../services/conciliacao.service');

function lerMes(req, res) {
  const mes = String(req.query.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    res.status(400).json({ erro: 'Informe o mês no formato AAAA-MM, por exemplo 2026-09.' });
    return null;
  }
  return mes;
}

function responder(res, resultado) {
  if (resultado.naoConfigurado) return res.status(501).json({ erro: resultado.mensagem });
  return res.json(resultado.dados);
}

async function titulos(req, res, next) {
  try {
    const mes = lerMes(req, res);
    if (!mes) return;
    responder(res, await service.listarTitulos(mes));
  } catch (err) {
    next(err);
  }
}

async function pedidosSemNota(req, res, next) {
  try {
    const mes = lerMes(req, res);
    if (!mes) return;
    responder(res, await service.listarPedidosSemNota(mes));
  } catch (err) {
    next(err);
  }
}

module.exports = { titulos, pedidosSemNota };
