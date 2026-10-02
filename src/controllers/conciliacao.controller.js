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

// ===== Extratos guardados no painel =====
const extratos = require('../repositories/extratos.repository');
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// POST /conciliacao/extratos  { arquivo, conta, origem, entradas: [{ data, valor, desc, nome, doc, chave, agrupado, pix }] }
async function guardarExtrato(req, res, next) {
  try {
    const { arquivo, conta, origem, entradas } = req.body || {};
    if (!arquivo || !Array.isArray(entradas)) {
      return res.status(400).json({ erro: 'Envie o nome do arquivo e a lista de lançamentos.' });
    }
    if (!['banco', 'rede', 'boletos'].includes(origem)) {
      return res.status(400).json({ erro: 'Origem do arquivo deve ser banco, rede ou boletos.' });
    }
    if (entradas.length > 50000) return res.status(400).json({ erro: 'Arquivo grande demais (mais de 50 mil lançamentos).' });
    const validas = entradas.filter((e) => e && DATA_ISO.test(String(e.data)) && Number(e.valor) > 0);
    const resultado = await extratos.guardar({ arquivo, conta, origem, entradas: validas }, req.usuarioNome);
    return res.json({ ...resultado, ignorados: entradas.length - validas.length });
  } catch (err) {
    return next(err);
  }
}

// GET /conciliacao/extratos?mes=2026-09
async function extratosDoMes(req, res, next) {
  try {
    const mes = lerMes(req, res);
    if (!mes) return;
    res.json(await extratos.doMes(mes));
  } catch (err) {
    next(err);
  }
}

// GET /conciliacao/extratos/arquivos
async function arquivosGuardados(req, res, next) {
  try {
    res.json(await extratos.importacoes());
  } catch (err) {
    next(err);
  }
}

// DELETE /conciliacao/extratos?arquivo=nome.xlsx
async function removerExtrato(req, res, next) {
  try {
    const arquivo = String(req.query.arquivo || '').trim();
    if (!arquivo) return res.status(400).json({ erro: 'Informe o arquivo a remover.' });
    return res.json(await extratos.removerArquivo(arquivo));
  } catch (err) {
    return next(err);
  }
}

module.exports = { titulos, pedidosSemNota, guardarExtrato, extratosDoMes, arquivosGuardados, removerExtrato };
