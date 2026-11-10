// Lojas (empresas) para o seletor de loja do painel (menu da esquerda e tela inicial).
//
// Entram as empresas de EMPRESAS_USUARIAS que tiveram venda nos últimos 90 dias (caixa ou nota,
// sem os cancelados, DOCUMENTO_TIPO 20). Assim CD, galpão e indústrias não aparecem, e uma loja
// nova entra sozinha no seletor a partir da primeira venda.

const { sql, getPool } = require('../config/db');

const DIAS_COM_VENDA = 90;

async function lojas() {
  const pool = await getPool();
  const { recordset } = await pool.request()
    .input('dias', sql.Int, DIAS_COM_VENDA)
    .query(`
      SELECT EU.EMPRESA_USUARIA AS codigo, LTRIM(RTRIM(EU.NOME_FANTASIA)) AS nome
      FROM EMPRESAS_USUARIAS EU WITH (NOLOCK)
      WHERE EXISTS (
        SELECT 1 FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
        WHERE VA.EMPRESA = EU.EMPRESA_USUARIA
          AND VA.MOVIMENTO >= DATEADD(day, -@dias, CAST(GETDATE() AS date))
          AND ISNULL(VA.DOCUMENTO_TIPO, 0) <> 20
      )
      ORDER BY EU.EMPRESA_USUARIA;
    `);
  return recordset;
}

module.exports = { lojas, DIAS_COM_VENDA };
