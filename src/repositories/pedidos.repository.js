// Camada de dados do PEDIDO (pré-venda): cabeçalho, produtos e o que ele gerou.
//
// Tabelas (validadas com o pedido 4313 em set/2026: soma dos produtos = total = título):
//   PEDIDOS_PREVENDAS           cabeçalho: cliente, vendedor, empresa, data, tabela de preço
//   PEDIDOS_PREVENDAS_PRODUTOS  um registro por produto: QUANTIDADE, PRECO_VENDA,
//                               PRECO_BRUTO_TOTAL, DESCONTO_TOTAL, PRECO_TOTAL
//   PEDIDOS_PREVENDAS_TOTAIS    totais do pedido e STATUS (ex.: "Pedido Processado")
//   PEDIDOS_PREVENDAS_OBSERVACOES  observação digitada (ntext)
// O que o pedido gerou:
//   nota fiscal -> NF_FATURAMENTO.PEDIDO_CLIENTE = nº do pedido
//   cupom       -> PDV_VENDAS.PREVENDA = nº do pedido

const { sql, getPool } = require('../config/db');
const { nomearTabelas } = require('./vendas.repository');

async function pedido(numero) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('pedido', sql.Decimal(18, 0), numero)
    .query(`
      -- 1) Cabeçalho + totais + observação
      SELECT
        PP.PEDIDO_PREVENDA                         AS pedido,
        CONVERT(varchar(16), PP.DATA_HORA, 120)    AS data_hora,
        PP.EMPRESA                                 AS empresa,
        PP.CLIENTE                                 AS codigo_cliente,
        LTRIM(RTRIM(E.NOME))                       AS cliente,
        LTRIM(RTRIM(E.NOME_FANTASIA))              AS fantasia,
        E.INSCRICAO_FEDERAL                        AS cnpj_cpf,
        PP.VENDEDOR                                AS codigo_vendedor,
        LTRIM(RTRIM(V.NOME))                       AS vendedor,
        PP.GRUPO_PRECO                             AS grupo_preco,
        CASE WHEN PP.CANCELADA = 'S' THEN 1 ELSE 0 END AS cancelado,
        T.PRECO_BRUTO_TOTAL                        AS bruto,
        T.DESCONTO_TOTAL                           AS desconto,
        T.PRECO_TOTAL                              AS total,
        LTRIM(RTRIM(T.STATUS))                     AS status,
        OBS.OBSERVACAO                             AS observacao
      FROM PEDIDOS_PREVENDAS PP WITH (NOLOCK)
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = PP.CLIENTE
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = PP.VENDEDOR
      OUTER APPLY (
        SELECT TOP 1 PT.PRECO_BRUTO_TOTAL, PT.DESCONTO_TOTAL, PT.PRECO_TOTAL, PT.STATUS
        FROM PEDIDOS_PREVENDAS_TOTAIS PT WITH (NOLOCK)
        WHERE PT.PEDIDO_PREVENDA = PP.PEDIDO_PREVENDA
        ORDER BY PT.PEDIDO_PREVENDA_TOTAL DESC
      ) T
      OUTER APPLY (
        SELECT TOP 1 CAST(PO.OBSERVACAO AS nvarchar(max)) AS OBSERVACAO
        FROM PEDIDOS_PREVENDAS_OBSERVACOES PO WITH (NOLOCK)
        WHERE PO.PEDIDO_PREVENDA = PP.PEDIDO_PREVENDA
        ORDER BY PO.PEDIDO_PREVENDA_OBS DESC
      ) OBS
      WHERE PP.PEDIDO_PREVENDA = @pedido;

      -- 2) Produtos, na ordem em que foram lançados
      SELECT
        PPP.PRODUTO                   AS produto,
        LTRIM(RTRIM(P.DESCRICAO))     AS descricao,
        PPP.QUANTIDADE                AS quantidade,
        PPP.PRECO_VENDA               AS preco,
        PPP.PRECO_BRUTO_TOTAL         AS bruto,
        PPP.DESCONTO_TOTAL            AS desconto,
        PPP.PRECO_TOTAL               AS total
      FROM PEDIDOS_PREVENDAS_PRODUTOS PPP WITH (NOLOCK)
      LEFT JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = PPP.PRODUTO
      WHERE PPP.PEDIDO_PREVENDA = @pedido
      ORDER BY PPP.PEDIDO_PREVENDA_PRODUTO;

      -- 3) Notas fiscais geradas pelo pedido
      SELECT DISTINCT NF.NF_NUMERO AS nota
      FROM NF_FATURAMENTO NF WITH (NOLOCK)
      WHERE TRY_CAST(LTRIM(RTRIM(NF.PEDIDO_CLIENTE)) AS numeric(18, 0)) = @pedido;

      -- 4) Cupons do caixa gerados pelo pedido
      SELECT DISTINCT
        PV.CAIXA                              AS caixa,
        LTRIM(RTRIM(PV.ECF_CUPOM))            AS cupom,
        CONVERT(varchar(10), PV.MOVIMENTO, 23) AS data
      FROM PDV_VENDAS PV WITH (NOLOCK)
      WHERE PV.PREVENDA = @pedido;
    `);

  const [cabecalho] = recordsets[0];
  if (!cabecalho) return null;
  await nomearTabelas([cabecalho]);

  return {
    pedido: cabecalho,
    produtos: recordsets[1],
    notas: recordsets[2].map((n) => n.nota),
    cupons: recordsets[3],
  };
}

module.exports = { pedido };
