// Camada de dados: aqui ficam SOMENTE as consultas SQL de vendas.
//
// Aprendizados sobre a VENDAS_ANALITICAS (validados com dados reais):
// - MOVIMENTO é a data da venda (DATA é quando o PROCFIT processou).
// - Cancelamentos aparecem como linhas NEGATIVAS da mesma venda.
// - CMV e LUCRO_BRUTO não servem (CMV vem zerado).
//   O custo real está em CUSTO_MEDIO_PRODUTOS_VENDAS, que é POR UNIDADE
//   (fica positivo mesmo no cancelamento), por isso multiplicamos pela QUANTIDADE.
// - O custo só é preenchido nas vendas do caixa (PDV). Nas vendas por nota (NFE)
//   ele vem VAZIO, e em alguns produtos vem ZERADO. Os dois casos contam como
//   "sem custo": custo, lucro e margem voltam como null (indisponível), nunca como zero.
// - LUCRO_BRUTO_PRODUTOS_VENDAS usa preço de tabela, não o praticado: não usamos.
// - Identificação de cada venda: no PDV é CAIXA + VENDA; na NFE esses campos vêm
//   zerados e quem identifica é DOCUMENTO_NUMERO (+ SERIE_NF).
// - DOCUMENTO_TIPO (tabela TIPOS_DOCUMENTOS_VENDAS_ANALITICAS) define o grupo:
//     CAIXA     = 1, 2, 9, 10, 18, 19 (PDV e vendas manuais, com cancelamentos)
//     DEVOLUCAO       = 12, 13, 16   (notas de devolução)
//     DEVOLUCAO_CAIXA = 14           (devolução no caixa das lojas)
//     NOTA      = demais              (notas emitidas, canceladas e estornadas)
//     20 (importação de demanda) não é venda e fica fora de tudo.
// - Margem: calculada SÓ sobre as vendas que têm custo. O campo cobertura_custo_pct
//   informa quanto da venda líquida entrou nesse cálculo (0% = sem margem).

const { sql, getPool } = require('../config/db');

// Bloco base usado por todas as consultas.
// ITENS  = cada item vendido no período, já com o custo total calculado.
// VENDAS = os itens agrupados por venda (cupom), para saber o valor líquido de cada uma.
// É um texto fixo nosso (não vem do usuário). Os VALORES entram como parâmetros.
const BASE = `
  WITH ITENS AS (
    SELECT
      VA.EMPRESA,
      VA.CAIXA,
      VA.VENDA,
      VA.MOVIMENTO,
      VA.ESPECIE_FISCAL,
      VA.DOCUMENTO_NUMERO,
      VA.SERIE_NF,
      VA.PRODUTO,
      VA.VENDEDOR,
      CASE
        WHEN VA.DOCUMENTO_TIPO = 14                      THEN 'DEVOLUCAO_CAIXA'
        WHEN VA.DOCUMENTO_TIPO IN (12, 13, 16)           THEN 'DEVOLUCAO'
        WHEN VA.DOCUMENTO_TIPO IN (1, 2, 9, 10, 18, 19)  THEN 'CAIXA'
        ELSE 'NOTA'
      END AS CATEGORIA,
      VA.QUANTIDADE,
      VA.VENDA_BRUTA,
      VA.DESCONTO,
      VA.VENDA_LIQUIDA,
      CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0
           THEN VA.QUANTIDADE * VA.CUSTO_MEDIO_PRODUTOS_VENDAS END AS CUSTO,
      CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0
           THEN VA.VENDA_LIQUIDA END AS LIQUIDA_COM_CUSTO,
      CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0 THEN 0 ELSE 1 END AS SEM_CUSTO
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    WHERE VA.MOVIMENTO BETWEEN CAST(@inicio AS date) AND CAST(@fim AS date)
      AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
      AND ISNULL(VA.DOCUMENTO_TIPO, 0) <> 20
  ),
  VENDAS AS (
    SELECT
      EMPRESA, MOVIMENTO, ESPECIE_FISCAL,
      SUM(QUANTIDADE)    AS QTD_ITENS,
      SUM(VENDA_BRUTA)   AS BRUTA,
      SUM(DESCONTO)      AS DESCONTOS,
      SUM(VENDA_LIQUIDA) AS LIQUIDA,
      SUM(CUSTO)         AS CUSTO,
      SUM(LIQUIDA_COM_CUSTO) AS LIQUIDA_COM_CUSTO,
      SUM(SEM_CUSTO)     AS ITENS_SEM_CUSTO
    FROM ITENS
    GROUP BY EMPRESA, MOVIMENTO, ESPECIE_FISCAL, CAIXA, VENDA, DOCUMENTO_NUMERO, SERIE_NF
  )
`;

// Indicadores calculados a partir do bloco VENDAS.
// Só conta como venda o cupom que terminou com valor positivo (cancelados totalmente ficam de fora).
// Custo, lucro e margem consideram só as vendas com custo (null se nenhuma tiver).
const INDICADORES = `
  SUM(CASE WHEN LIQUIDA > 0 THEN 1 ELSE 0 END) AS qtd_vendas,
  SUM(LIQUIDA)                                 AS venda_liquida,
  SUM(ITENS_SEM_CUSTO)                         AS itens_sem_custo,
  ROUND(100.0 * ISNULL(SUM(LIQUIDA_COM_CUSTO), 0) / NULLIF(SUM(LIQUIDA), 0), 2) AS cobertura_custo_pct,
  SUM(CUSTO)                                   AS custo,
  SUM(LIQUIDA_COM_CUSTO) - SUM(CUSTO)          AS lucro_bruto,
  ROUND(100.0 * (SUM(LIQUIDA_COM_CUSTO) - SUM(CUSTO)) / NULLIF(SUM(LIQUIDA_COM_CUSTO), 0), 2) AS margem_pct,
  ROUND(SUM(LIQUIDA) / NULLIF(SUM(CASE WHEN LIQUIDA > 0 THEN 1 ELSE 0 END), 0), 2) AS ticket_medio
`;

async function criarRequest({ inicio, fim, empresa }) {
  const pool = await getPool();
  return pool
    .request()
    .input('inicio', sql.VarChar(10), inicio)
    .input('fim', sql.VarChar(10), fim)
    .input('empresa', sql.Int, empresa ?? null);
}

// Totais do período
async function resumo(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      ${INDICADORES},
      SUM(QTD_ITENS) AS qtd_itens,
      SUM(BRUTA)     AS venda_bruta,
      SUM(DESCONTOS) AS desconto
    FROM VENDAS
  `);
  return recordset[0];
}

// Evolução dia a dia
async function porDia(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      CONVERT(varchar(10), MOVIMENTO, 23) AS dia,
      ${INDICADORES}
    FROM VENDAS
    GROUP BY MOVIMENTO
    ORDER BY MOVIMENTO
  `);
  return recordset;
}

// Comparativo entre lojas
async function porLoja(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      V.EMPRESA        AS empresa,
      EU.NOME_FANTASIA AS loja,
      ${INDICADORES}
    FROM VENDAS V
    LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK)
      ON EU.EMPRESA_USUARIA = V.EMPRESA
    GROUP BY V.EMPRESA, EU.NOME_FANTASIA
    ORDER BY venda_liquida DESC
  `);
  return recordset;
}

// Separação entre vendas do caixa (PDV) e por nota fiscal (NFE)
async function porOrigem(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      COALESCE(CAST(ESPECIE_FISCAL AS varchar(10)), 'OUTROS') AS origem,
      ${INDICADORES}
    FROM VENDAS
    GROUP BY COALESCE(CAST(ESPECIE_FISCAL AS varchar(10)), 'OUTROS')
    ORDER BY venda_liquida DESC
  `);
  return recordset;
}

// Vendas por vendedor, separando notas, devoluções e caixa.
// DOCS = cada documento (nota, devolução ou cupom) com seu valor líquido.
// Um documento só é contado se terminou com valor (positivo para venda, negativo para devolução).
async function porVendedor(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE},
    DOCS AS (
      SELECT
        VENDEDOR, CATEGORIA,
        SUM(VENDA_LIQUIDA) AS LIQUIDA
      FROM ITENS
      GROUP BY VENDEDOR, CATEGORIA, EMPRESA, MOVIMENTO, ESPECIE_FISCAL,
               CAIXA, VENDA, DOCUMENTO_NUMERO, SERIE_NF
    )
    SELECT
      D.VENDEDOR                          AS vendedor,
      COALESCE(LTRIM(RTRIM(V.NOME)), 'Sem vendedor') AS nome,
      SUM(CASE WHEN D.CATEGORIA = 'NOTA' THEN D.LIQUIDA ELSE 0 END)                     AS notas_valor,
      SUM(CASE WHEN D.CATEGORIA = 'NOTA' AND D.LIQUIDA > 0 THEN 1 ELSE 0 END)           AS notas_qtd,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO' THEN D.LIQUIDA ELSE 0 END)                AS devolucoes_valor,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO' AND D.LIQUIDA < 0 THEN 1 ELSE 0 END)      AS devolucoes_qtd,
      SUM(CASE WHEN D.CATEGORIA = 'CAIXA' THEN D.LIQUIDA ELSE 0 END)                    AS caixa_valor,
      SUM(CASE WHEN D.CATEGORIA = 'CAIXA' AND D.LIQUIDA > 0 THEN 1 ELSE 0 END)          AS caixa_qtd,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO_CAIXA' THEN D.LIQUIDA ELSE 0 END)          AS devolucoes_caixa_valor,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO_CAIXA' AND D.LIQUIDA < 0 THEN 1 ELSE 0 END) AS devolucoes_caixa_qtd,
      SUM(D.LIQUIDA)                      AS liquido
    FROM DOCS D
    LEFT JOIN VENDEDORES V WITH (NOLOCK)
      ON V.VENDEDOR = D.VENDEDOR
    GROUP BY D.VENDEDOR, V.NOME
    ORDER BY liquido DESC
  `);
  return recordset;
}

// Produtos mais vendidos (por valor líquido)
async function topProdutos(filtros, limite) {
  const request = await criarRequest(filtros);
  request.input('limite', sql.Int, limite);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT TOP (@limite)
      I.PRODUTO                         AS produto,
      P.DESCRICAO                       AS descricao,
      SUM(I.QUANTIDADE)                 AS quantidade,
      SUM(I.VENDA_LIQUIDA)              AS venda_liquida,
      SUM(I.SEM_CUSTO)                  AS itens_sem_custo,
      ROUND(100.0 * ISNULL(SUM(I.LIQUIDA_COM_CUSTO), 0) / NULLIF(SUM(I.VENDA_LIQUIDA), 0), 2) AS cobertura_custo_pct,
      SUM(I.LIQUIDA_COM_CUSTO) - SUM(I.CUSTO) AS lucro_bruto,
      ROUND(100.0 * (SUM(I.LIQUIDA_COM_CUSTO) - SUM(I.CUSTO)) / NULLIF(SUM(I.LIQUIDA_COM_CUSTO), 0), 2) AS margem_pct
    FROM ITENS I
    LEFT JOIN PRODUTOS P WITH (NOLOCK)
      ON P.PRODUTO = I.PRODUTO
    GROUP BY I.PRODUTO, P.DESCRICAO
    HAVING SUM(I.QUANTIDADE) <> 0
    ORDER BY venda_liquida DESC
  `);
  return recordset;
}

module.exports = { resumo, porDia, porLoja, porOrigem, porVendedor, topProdutos };
