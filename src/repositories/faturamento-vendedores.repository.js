// Sub-tela do FATURAMENTO: notas faturadas por vendedor.
//
// Regra validada em nov/2026 (consultas no SSMS, mês de novembro até o dia 12):
//   - parte da NOTA, não do pedido. A própria NF_FATURAMENTO guarda o VENDEDOR (nenhuma nota
//     sem vendedor). O NF_FATURAMENTO.PEDIDO_VENDA NÃO é o nº do pedido do pré-venda (não bateu
//     em nenhuma nota); o nº do pedido vem do texto de PEDIDO_CLIENTE.
//   - valor da nota: NF_FATURAMENTO_TOTAIS.TOTAL_GERAL (TOTAL_NF quase igual; TOTAL_COMISSAO vem zerada).
//   - fica de fora: nota cancelada na SEFAZ (CANCELAMENTOS_NOTAS_FISCAIS, como no resto do painel)
//     e TRANSFERÊNCIA entre lojas (NF_FATURAMENTO_TRANSF): 48 notas e R$ 1,19 mi no mês, que não
//     são venda de vendedor.
//   - conferência: 1.148 notas e R$ 1.107.969,52, igual à soma das notas de venda (tipo 8 da
//     VENDAS_ANALITICAS) mais 24 notas geradas no checkout que a analítica não marcou como tipo 8.
//   - devolução: mesma regra do painel (faturamento.repository.js): NF_FATURAMENTO_DEVOLUCOES
//     aponta a nota original; o valor vem da VENDAS_ANALITICAS (tipos 12, 13, 16).

const { sql, getPool } = require('../config/db');

// Até quantas notas a lista devolve de uma vez (o resumo por vendedor sempre soma todas)
const LIMITE_LISTA = 5000;

async function notasPorVendedor(filtros) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .input('vendedor', sql.Int, filtros.vendedor ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null)
    .query(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#N') IS NOT NULL DROP TABLE #N;
      IF OBJECT_ID('tempdb..#VADEV') IS NOT NULL DROP TABLE #VADEV;
      IF OBJECT_ID('tempdb..#NOTAS') IS NOT NULL DROP TABLE #NOTAS;

      -- 1. As notas de venda do período (sem canceladas e sem transferências)
      SELECT N.NF_FATURAMENTO, N.NF_NUMERO, N.EMPRESA, N.MOVIMENTO, N.VENDEDOR, N.ENTIDADE,
             TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS PEDIDO,
             ISNULL(T.TOTAL_PRODUTOS, 0) AS TOTAL_PRODUTOS,
             ISNULL(T.TOTAL_DESCONTOS, 0) AS TOTAL_DESCONTOS,
             ISNULL(T.TOTAL_GERAL, 0) AS TOTAL_GERAL
      INTO #N
      FROM NF_FATURAMENTO N WITH (NOLOCK)
      JOIN NF_FATURAMENTO_TOTAIS T WITH (NOLOCK) ON T.NF_FATURAMENTO = N.NF_FATURAMENTO
      WHERE N.MOVIMENTO >= CAST(@inicio AS date)
        AND N.MOVIMENTO < DATEADD(day, 1, CAST(@fim AS date))
        AND (@empresa IS NULL OR N.EMPRESA = @empresa)
        AND NOT EXISTS (SELECT 1 FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                        WHERE NC.TIPO = 1 AND NC.CHAVE = N.NF_FATURAMENTO AND NC.PROTOCOLO IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                        WHERE X.NF_FATURAMENTO = N.NF_FATURAMENTO)
      OPTION (RECOMPILE);
      CREATE CLUSTERED INDEX IX_N ON #N (NF_FATURAMENTO);

      -- 2. Linhas de devolução por nota da VENDAS_ANALITICAS, numa leitura só
      --    (a devolução nunca é anterior à nota)
      SELECT VA.DOCUMENTO_NUMERO, VA.CLIENTE, VA.VENDA_LIQUIDA
      INTO #VADEV
      FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
      WHERE VA.DOCUMENTO_TIPO IN (12, 13, 16)
        AND VA.MOVIMENTO >= CAST(@inicio AS date);

      -- 3. Cada nota com cliente, vendedor e devolução
      SELECT
          N.NF_NUMERO                                     AS nota,
          N.NF_FATURAMENTO                                AS nota_id,
          CONVERT(varchar(10), N.MOVIMENTO, 23)           AS dia,
          N.EMPRESA                                       AS empresa,
          N.PEDIDO                                        AS pedido,
          N.ENTIDADE                                      AS cod_cliente,
          LTRIM(RTRIM(E.NOME))                            AS cliente,
          N.VENDEDOR                                      AS cod_vendedor,
          LTRIM(RTRIM(V.NOME))                            AS vendedor,
          N.TOTAL_PRODUTOS                                AS produtos,
          N.TOTAL_DESCONTOS                               AS desconto,
          N.TOTAL_GERAL                                   AS valor,
          CASE WHEN DVI.qtd > 0 THEN 1 ELSE 0 END         AS tem_devolucao,
          DVI.numero                                      AS nota_devolucao,
          CONVERT(varchar(10), DVI.dia, 23)               AS devolucao_dia,
          CASE WHEN DVI.qtd > 0 THEN ISNULL(-VAL.valor, 0) ELSE 0 END AS devolvido
      INTO #NOTAS
      FROM #N N
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = N.ENTIDADE
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = N.VENDEDOR
      OUTER APPLY (
        SELECT COUNT(*) AS qtd, MAX(DV.NF_NUMERO) AS numero, MAX(DV.DATA_HORA) AS dia
        FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
        WHERE DV.NF_FATURAMENTO_ORIGEM = N.NF_FATURAMENTO
      ) DVI
      OUTER APPLY (
        SELECT SUM(D.VENDA_LIQUIDA) AS valor
        FROM #VADEV D
        WHERE D.DOCUMENTO_NUMERO = N.NF_NUMERO AND D.CLIENTE = N.ENTIDADE
      ) VAL;

      -- Resumo por vendedor: sempre todos os vendedores do período (a escolha de um vendedor
      -- e a pesquisa filtram só a lista de notas)
      SELECT cod_vendedor,
             MAX(vendedor)                                 AS vendedor,
             COUNT(*)                                      AS notas,
             SUM(valor)                                    AS valor,
             SUM(desconto)                                 AS desconto,
             SUM(tem_devolucao)                            AS notas_devolvidas,
             SUM(devolvido)                                AS devolvido,
             SUM(valor) - SUM(devolvido)                   AS liquido,
             COUNT(DISTINCT cod_cliente)                   AS clientes
      FROM #NOTAS
      GROUP BY cod_vendedor
      ORDER BY SUM(valor) DESC;

      -- Lista de notas (do vendedor escolhido e da pesquisa)
      SELECT TOP ${LIMITE_LISTA} *, valor - devolvido AS liquido
      FROM #NOTAS
      WHERE (@vendedor IS NULL OR cod_vendedor = @vendedor)
        AND (@busca IS NULL
          OR CAST(nota AS varchar(20)) = @busca
          OR CAST(pedido AS varchar(20)) = @busca
          OR CAST(cod_cliente AS varchar(20)) = @busca
          OR cliente LIKE '%' + @busca + '%')
      ORDER BY dia DESC, nota DESC;

      -- Quantas notas a lista teria sem o limite
      SELECT COUNT(*) AS total
      FROM #NOTAS
      WHERE (@vendedor IS NULL OR cod_vendedor = @vendedor)
        AND (@busca IS NULL
          OR CAST(nota AS varchar(20)) = @busca
          OR CAST(pedido AS varchar(20)) = @busca
          OR CAST(cod_cliente AS varchar(20)) = @busca
          OR cliente LIKE '%' + @busca + '%');
    `);
  return {
    vendedores: recordsets[0],
    notas: recordsets[1],
    totalNotas: recordsets[2][0]?.total ?? recordsets[1].length,
    limite: LIMITE_LISTA,
  };
}

module.exports = { notasPorVendedor };
