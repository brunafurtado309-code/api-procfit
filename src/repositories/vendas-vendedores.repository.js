// Vendas > Vendedores: o que o gestor precisa acompanhar por vendedor, além do faturado em nota.
// (o faturado em nota vem da sub-tela do Faturamento: faturamento-vendedores.repository.js)
//
// Regras conferidas no SSMS em nov/2026:
//   - Orçamento e cancelado vêm do pedido: PEDIDOS_PREVENDAS_TOTAIS.STATUS ("Orçamento",
//     "Pendente Aprovação", "Cancelado") e CANCELAMENTOS_PEDIDOS_PREVENDAS (o cancelamento do
//     pedido fica lá, não no pedido). Mesma regra da tela de Faturamento > Pedidos.
//   - Cancelamento de nota fica em CANCELAMENTOS_NOTAS_FISCAIS:
//       TIPO 1 = nota de venda (384 até nov/2026)
//       TIPO 3 = NOTA DE DEVOLUÇÃO (as 3 que existiam eram todas devoluções: CHAVE = NF_FATURAMENTO_DEVOLUCAO)
//       TIPO 2 = 1 caso, não é nota nem devolução: fica de fora
//   - Nota duplicada: nenhum pedido tinha duas notas válidas; o que apareceu foi o MESMO cliente,
//     no MESMO dia, com o MESMO valor (3 casos em nov/2026). Algumas delas são notas que o PROCFIT
//     não conta como venda (não estão como tipo 8 na VENDAS_ANALITICAS). A tela APONTA para
//     conferir; não tira nada da soma, porque pode ser uma compra que se repetiu de verdade.
//
// Leve de propósito: não monta o caminho inteiro do pedido (cupom, títulos...), que é a consulta
// pesada do "Funil dos pedidos". Tem tempo-limite próprio e, se passar, é cancelada no banco.

const { sql, getPool } = require('../config/db');
const AppError = require('../utils/AppError');

const LIMITE_MS = Number(process.env.VENDAS_VENDEDORES_TIMEOUT_MS) || 40000;
const LIMITE_LISTA = 1000; // pedidos por lista (orçamentos, cancelados)

async function controle(filtros) {
  const pool = await getPool();
  const pedido = pool.request();
  let cancelada = false;
  const relogio = setTimeout(() => {
    cancelada = true;
    pedido.cancel();
  }, LIMITE_MS);
  try {
    const { recordsets } = await pedido
      .input('inicio', sql.VarChar(10), filtros.inicio)
      .input('fim', sql.VarChar(10), filtros.fim)
      .input('empresa', sql.Int, filtros.empresa ?? null)
      .query(`
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#PED') IS NOT NULL DROP TABLE #PED;
        IF OBJECT_ID('tempdb..#ND') IS NOT NULL DROP TABLE #ND;
        IF OBJECT_ID('tempdb..#GD') IS NOT NULL DROP TABLE #GD;

        -- 1. Pedidos do período que estão em orçamento ou foram cancelados
        SELECT P.PEDIDO_PREVENDA                               AS pedido,
               P.EMPRESA                                       AS empresa,
               CONVERT(varchar(10), P.DATA_HORA, 23)           AS dia,
               DATEDIFF(day, P.DATA_HORA, GETDATE())           AS dias,
               P.CLIENTE                                       AS cod_cliente,
               LTRIM(RTRIM(E.NOME))                            AS cliente,
               P.VENDEDOR                                      AS cod_vendedor,
               LTRIM(RTRIM(V.NOME))                            AS vendedor,
               ISNULL(TOT.PRECO_TOTAL, 0)                      AS valor,
               LTRIM(RTRIM(ISNULL(TOT.STATUS, '')))            AS status,
               CONVERT(varchar(16), CAN.DATA_HORA, 120)        AS cancelado_em,
               CASE WHEN CAN.DATA_HORA IS NOT NULL OR TOT.STATUS = 'Cancelado' THEN 'cancelado'
                    WHEN TOT.STATUS = 'Pendente Aprovação'                   THEN 'aprovacao'
                    ELSE                                                          'orcamento' END AS situacao
        INTO #PED
        FROM PEDIDOS_PREVENDAS P WITH (NOLOCK)
        LEFT JOIN PEDIDOS_PREVENDAS_TOTAIS TOT WITH (NOLOCK) ON TOT.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = P.CLIENTE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = P.VENDEDOR
        OUTER APPLY (
          SELECT TOP 1 X.DATA_HORA
          FROM CANCELAMENTOS_PEDIDOS_PREVENDAS X WITH (NOLOCK)
          WHERE X.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
          ORDER BY X.CANCELAMENTO_PEDIDOS_PREVENDA DESC
        ) CAN
        WHERE P.DATA_HORA >= CAST(@inicio AS date)
          AND P.DATA_HORA < DATEADD(day, 1, CAST(@fim AS date))
          AND (@empresa IS NULL OR P.EMPRESA = @empresa)
          AND (CAN.DATA_HORA IS NOT NULL
               OR TOT.STATUS IN ('Orçamento', 'Pendente Aprovação', 'Cancelado'))
        OPTION (RECOMPILE);

        -- [0] Por vendedor
        SELECT cod_vendedor, MAX(vendedor) AS vendedor,
               SUM(CASE WHEN situacao <> 'cancelado' THEN 1 ELSE 0 END)     AS orcamentos,
               SUM(CASE WHEN situacao <> 'cancelado' THEN valor ELSE 0 END) AS valor_orcamentos,
               SUM(CASE WHEN situacao = 'cancelado' THEN 1 ELSE 0 END)      AS cancelados,
               SUM(CASE WHEN situacao = 'cancelado' THEN valor ELSE 0 END)  AS valor_cancelados
        FROM #PED
        GROUP BY cod_vendedor;

        -- [1] Pedidos em orçamento (inclui "Pendente Aprovação"), os maiores primeiro
        SELECT TOP ${LIMITE_LISTA} * FROM #PED WHERE situacao <> 'cancelado' ORDER BY valor DESC, dia;
        -- [2] Quantos são ao todo
        SELECT COUNT(*) AS total FROM #PED WHERE situacao <> 'cancelado';
        -- [3] Pedidos cancelados, os mais recentes primeiro
        SELECT TOP ${LIMITE_LISTA} * FROM #PED WHERE situacao = 'cancelado' ORDER BY ISNULL(cancelado_em, dia) DESC;
        -- [4] Quantos são ao todo
        SELECT COUNT(*) AS total FROM #PED WHERE situacao = 'cancelado';

        -- [5] Notas de devolução canceladas no período (CANCELAMENTOS_NOTAS_FISCAIS TIPO 3)
        SELECT DV.NF_NUMERO                                  AS nota_devolucao,
               CONVERT(varchar(10), DV.MOVIMENTO, 23)        AS devolucao_dia,
               CONVERT(varchar(16), NC.DATA_HORA, 120)       AS cancelado_em,
               CASE WHEN NC.PROTOCOLO IS NOT NULL THEN 1 ELSE 0 END AS com_protocolo,
               N.NF_NUMERO                                   AS nota_origem,
               N.EMPRESA                                     AS empresa,
               N.ENTIDADE                                    AS cod_cliente,
               LTRIM(RTRIM(E.NOME))                          AS cliente,
               N.VENDEDOR                                    AS cod_vendedor,
               LTRIM(RTRIM(V.NOME))                          AS vendedor,
               ISNULL(DT.TOTAL_GERAL, 0)                     AS valor
        FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
        JOIN NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK) ON DV.NF_FATURAMENTO_DEVOLUCAO = NC.CHAVE
        LEFT JOIN NF_FATURAMENTO_DEVOLUCOES_TOTAIS DT WITH (NOLOCK)
          ON DT.NF_FATURAMENTO_DEVOLUCAO = DV.NF_FATURAMENTO_DEVOLUCAO
        LEFT JOIN NF_FATURAMENTO N WITH (NOLOCK) ON N.NF_FATURAMENTO = DV.NF_FATURAMENTO_ORIGEM
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = N.ENTIDADE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = N.VENDEDOR
        WHERE NC.TIPO = 3
          AND NC.DATA_HORA >= CAST(@inicio AS date)
          AND NC.DATA_HORA < DATEADD(day, 1, CAST(@fim AS date))
          AND (@empresa IS NULL OR N.EMPRESA = @empresa)
        ORDER BY NC.DATA_HORA DESC;

        -- 2. Notas de venda do período (sem canceladas e sem transferências), para achar duplicadas
        SELECT N.NF_FATURAMENTO, N.NF_NUMERO, N.EMPRESA, N.ENTIDADE, N.VENDEDOR,
               CAST(N.MOVIMENTO AS date) AS dia,
               TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS pedido,
               ISNULL(T.TOTAL_GERAL, 0) AS valor
        INTO #ND
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

        -- Grupos suspeitos: o mesmo pedido em mais de uma nota, ou mesmo cliente + dia + valor
        SELECT 'pedido' AS motivo, CAST(pedido AS varchar(30)) AS chave
        INTO #GD
        FROM #ND WHERE pedido IS NOT NULL
        GROUP BY pedido HAVING COUNT(*) > 1;
        INSERT INTO #GD (motivo, chave)
        SELECT 'cliente_dia_valor',
               CONCAT(ENTIDADE, '|', CONVERT(varchar(10), dia, 23), '|', CAST(valor AS varchar(30)))
        FROM #ND
        GROUP BY ENTIDADE, dia, valor HAVING COUNT(*) > 1;

        -- [6] As notas de cada grupo suspeito
        SELECT G.motivo, G.chave AS grupo,
               D.NF_NUMERO AS nota, D.EMPRESA AS empresa, CONVERT(varchar(10), D.dia, 23) AS dia,
               D.pedido, D.ENTIDADE AS cod_cliente, LTRIM(RTRIM(E.NOME)) AS cliente,
               D.VENDEDOR AS cod_vendedor, LTRIM(RTRIM(V.NOME)) AS vendedor, D.valor,
               -- o PROCFIT conta esta nota como venda? (tipo 8 da VENDAS_ANALITICAS)
               CASE WHEN EXISTS (SELECT 1 FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
                                 WHERE VA.DOCUMENTO_TIPO = 8 AND VA.DOCUMENTO_NUMERO = D.NF_NUMERO
                                   AND VA.EMPRESA = D.EMPRESA)
                    THEN 1 ELSE 0 END AS conta_como_venda
        FROM #GD G
        JOIN #ND D ON (G.motivo = 'pedido' AND G.chave = CAST(D.pedido AS varchar(30)))
                   OR (G.motivo = 'cliente_dia_valor'
                       AND G.chave = CONCAT(D.ENTIDADE, '|', CONVERT(varchar(10), D.dia, 23), '|', CAST(D.valor AS varchar(30))))
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = D.ENTIDADE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = D.VENDEDOR
        ORDER BY G.motivo, G.chave, D.NF_NUMERO;
      `);
    return {
      porVendedor: recordsets[0],
      orcamentos: recordsets[1],
      totalOrcamentos: recordsets[2][0]?.total ?? recordsets[1].length,
      cancelados: recordsets[3],
      totalCancelados: recordsets[4][0]?.total ?? recordsets[3].length,
      devolucoesCanceladas: recordsets[5],
      duplicadas: recordsets[6],
      limite: LIMITE_LISTA,
    };
  } catch (err) {
    if (cancelada || err.code === 'ECANCEL') {
      throw new AppError(`A consulta passou de ${Math.round(LIMITE_MS / 1000)} segundos e foi cancelada para não travar o painel. `
        + 'Tente um período menor ou escolha uma loja.', 504);
    }
    throw err;
  } finally {
    clearTimeout(relogio);
  }
}

module.exports = { controle };
