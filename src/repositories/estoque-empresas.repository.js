// Logística > Estoque por empresa (nov/2026): saldo de cada produto em cada empresa e a venda dos
// últimos dias, para o comprador ver o estoque loja a loja ou da rede toda.
//
// Mesmas regras já validadas na tela de Logística (logistica.repository.js):
//   Estoque  ESTOQUE_LANCAMENTOS: saldo = soma(ESTOQUE_ENTRADA) - soma(ESTOQUE_SAIDA). Local = empresa:
//            o centro 3 é a empresa 3 e o centro de AJUSTE 1000301 também é a empresa 3.
//   Venda    VENDAS_ANALITICAS sem o tipo 20 (importação de demanda), por empresa.
// Conferido no SSMS com a Bruna (nov/2026): creme de dorella 4kg (10009) = 1.018 na empresa 1,
// -742 na Serrinha (3), 30 em Quixadá (8) e 42 em Juazeiro (11), igual à tela de Logística.

const { sql, getPool } = require('../config/db');

// Empresa do lançamento de estoque, como número inteiro (a conta com o centro vinha com decimais)
const EMPRESA_DO_CENTRO = `
  CASE WHEN CAST(EL.CENTRO_ESTOQUE AS int) > 1000000
       THEN (CAST(EL.CENTRO_ESTOQUE AS int) - 1000001) / 100
       ELSE CAST(EL.CENTRO_ESTOQUE AS int) END`;

// Uma linha por produto e empresa: saldo de hoje e quanto vendeu nos últimos @dias.
// Só entra produto com saldo diferente de zero ou com venda no período (o resto não interessa a compras).
async function estoque({ busca = null, dias = 30 }) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('busca', sql.VarChar(60), busca)
    .input('dias', sql.Int, dias)
    .query(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#EST') IS NOT NULL DROP TABLE #EST;
      IF OBJECT_ID('tempdb..#VEND') IS NOT NULL DROP TABLE #VEND;
      DECLARE @desde date = DATEADD(day, -@dias, CAST(GETDATE() AS date));

      -- Produtos da pesquisa (código exato ou parte da descrição); sem pesquisa, todos
      SELECT EL.PRODUTO, ${EMPRESA_DO_CENTRO} AS empresa,
             SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0) - ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saldo
      INTO #EST
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      WHERE @busca IS NULL
         OR CAST(EL.PRODUTO AS varchar(20)) = @busca
         OR EXISTS (SELECT 1 FROM PRODUTOS P WITH (NOLOCK)
                    WHERE P.PRODUTO = EL.PRODUTO AND P.DESCRICAO LIKE '%' + @busca + '%')
      GROUP BY EL.PRODUTO, ${EMPRESA_DO_CENTRO};

      SELECT VA.PRODUTO, CAST(VA.EMPRESA AS int) AS empresa, SUM(VA.QUANTIDADE) AS vendido
      INTO #VEND
      FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
      WHERE VA.MOVIMENTO >= @desde
        AND VA.DOCUMENTO_TIPO <> 20
        AND (@busca IS NULL
          OR CAST(VA.PRODUTO AS varchar(20)) = @busca
          OR EXISTS (SELECT 1 FROM PRODUTOS P WITH (NOLOCK)
                     WHERE P.PRODUTO = VA.PRODUTO AND P.DESCRICAO LIKE '%' + @busca + '%'))
      GROUP BY VA.PRODUTO, CAST(VA.EMPRESA AS int);

      SELECT
        COALESCE(E.PRODUTO, V.PRODUTO)             AS produto,
        LTRIM(RTRIM(PR.DESCRICAO))                 AS descricao,
        COALESCE(E.empresa, V.empresa)             AS empresa,
        LTRIM(RTRIM(EU.NOME_FANTASIA))             AS empresa_nome,
        ISNULL(E.saldo, 0)                         AS saldo,
        ISNULL(V.vendido, 0)                       AS vendido
      FROM #EST E
      FULL JOIN #VEND V ON V.PRODUTO = E.PRODUTO AND V.empresa = E.empresa
      LEFT JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = COALESCE(E.PRODUTO, V.PRODUTO)
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = COALESCE(E.empresa, V.empresa)
      WHERE ABS(ISNULL(E.saldo, 0)) > 0.0001 OR ISNULL(V.vendido, 0) <> 0
      ORDER BY produto, empresa
      OPTION (RECOMPILE);
    `);
  return recordset;
}

module.exports = { estoque };
