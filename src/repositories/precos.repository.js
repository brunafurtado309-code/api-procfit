// Módulo TABELA DE PREÇOS: só código, produto e preço de varejo.
// Feito para quem precisa consultar preço e não pode ver mais nada do painel.
// Preço = PRODUTOS_VENDAS, tabela de preço 1 (varejo); entram só os produtos com preço
// maior que zero (mesma regra da Logística: logistica.repository.js).

const { getPool } = require('../config/db');

const TABELA_VAREJO = 1;

async function varejo() {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT
      P.PRODUTO                   AS codigo,
      LTRIM(RTRIM(P.DESCRICAO))   AS produto,
      PV.PRECO_VENDA              AS preco
    FROM PRODUTOS_VENDAS PV WITH (NOLOCK)
    JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = PV.PRODUTO
    WHERE PV.GRUPO_PRECO = ${TABELA_VAREJO}
      AND PV.PRECO_VENDA > 0
    ORDER BY LTRIM(RTRIM(P.DESCRICAO));
  `);
  return recordset;
}

module.exports = { varejo };
