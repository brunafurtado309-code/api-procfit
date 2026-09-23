// Módulo FATURAMENTO: o ciclo da venda, do orçamento até o pagamento.
//
// Etapas no PROCFIT (validado em set/2026, últimos 3 meses):
//   13.101 pedidos · 12.902 processados · 9.416 com checkout · 2.532 com cupom · 562 cancelados
//   PEDIDOS_PREVENDAS_TOTAIS.STATUS: "Orçamento", "Pendente Aprovação", "Pedido Processado", "Cancelado"
//   CHECKOUT_PREVENDAS.NF_NUMERO quase nunca é preenchido (10 em 13 mil): a nota vem de
//   NF_FATURAMENTO.PEDIDO_CLIENTE, e é assim que o painel liga pedido e nota.
//   O cancelamento não fica no pedido (CANCELADA = 'N' em tudo): fica em CANCELAMENTOS_PEDIDOS_PREVENDAS.

const { sql, getPool } = require('../config/db');

const TAB_NOTA_FISCAL = 753289;

// Um pedido com tudo o que aconteceu com ele: totais, checkout, cupom, nota, títulos e cancelamento
const PEDIDOS = `
  WITH PEDIDOS AS (
    SELECT
      P.PEDIDO_PREVENDA                                  AS pedido,
      P.EMPRESA                                          AS empresa,
      CONVERT(varchar(10), P.DATA_HORA, 23)              AS dia,
      P.DATA_HORA                                        AS dia_hora,
      CONVERT(varchar(16), P.DATA_HORA, 120)             AS criado_em,
      CONVERT(varchar(16), P.DATA_HORA_PROCESSAR, 120)   AS processado_em,
      P.CLIENTE                                          AS cod_cliente,
      LTRIM(RTRIM(E.NOME))                               AS cliente,
      P.VENDEDOR                                         AS cod_vendedor,
      LTRIM(RTRIM(V.NOME))                               AS vendedor,
      P.USUARIO_LOGADO                                   AS usuario,
      COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome,
      LTRIM(RTRIM(ISNULL(TOT.STATUS, 'Sem status')))     AS status,
      ISNULL(TOT.PRECO_TOTAL, 0)                         AS valor,
      ISNULL(TOT.DESCONTO_TOTAL, 0)                      AS desconto,
      CK.CHECKOUT_PREVENDA                               AS checkout,
      CONVERT(varchar(16), CK.DATA_HORA, 120)            AS checkout_em,
      CK.usuario_checkout                                AS cod_usuario_checkout,
      CK.nome_checkout                                   AS usuario_checkout,
      NF.NF_NUMERO                                       AS nota,
      CONVERT(varchar(10), NF.MOVIMENTO, 23)             AS nota_dia,
      NF.NF_FATURAMENTO                                  AS nota_id,
      CUP.ECF_CUPOM                                      AS cupom,
      CUP.CAIXA                                          AS caixa,
      CONVERT(varchar(10), CUP.MOVIMENTO, 23)            AS cupom_dia,
      ISNULL(TIT.titulos, 0)                             AS titulos,
      ISNULL(TIT.valor_titulos, 0)                       AS valor_titulos,
      ISNULL(TIT.recebido, 0)                            AS recebido,
      ISNULL(TIT.pendente, 0)                            AS pendente,
      CAN.CANCELAMENTO_PEDIDO_PREVENDA                   AS cancelamento,
      CONVERT(varchar(10), CAN.DATA_HORA, 23)            AS cancelado_em,
      -- Em que etapa a venda está hoje
      CASE
        WHEN CAN.CANCELAMENTO_PEDIDO_PREVENDA IS NOT NULL OR TOT.STATUS = 'Cancelado' THEN 'CANCELADO'
        WHEN TOT.STATUS = 'Orçamento'                                                 THEN 'ORCAMENTO'
        WHEN TOT.STATUS = 'Pendente Aprovação'                                        THEN 'APROVACAO'
        WHEN ISNULL(TIT.recebido, 0) > 0.009 AND ISNULL(TIT.pendente, 0) <= 0.009     THEN 'PAGO'
        WHEN CUP.ECF_CUPOM IS NOT NULL                                                THEN 'PAGO'
        WHEN NF.NF_NUMERO IS NOT NULL                                                 THEN 'FATURADO'
        WHEN CK.CHECKOUT_PREVENDA IS NOT NULL                                         THEN 'CHECKOUT'
        ELSE                                                                               'PEDIDO'
      END                                                AS etapa,
      -- Divergências entre as telas do sistema
      CASE WHEN CUP.ECF_CUPOM IS NOT NULL AND ISNULL(TIT.pendente, 0) > 0.009 THEN 1 ELSE 0 END
                                                         AS pago_com_titulo_aberto,
      CASE WHEN NF.NF_NUMERO IS NOT NULL AND CUP.ECF_CUPOM IS NULL AND ISNULL(TIT.titulos, 0) = 0
           THEN 1 ELSE 0 END                             AS nota_sem_cobranca,
      CASE WHEN (CAN.CANCELAMENTO_PEDIDO_PREVENDA IS NOT NULL OR TOT.STATUS = 'Cancelado')
            AND (NF.NF_NUMERO IS NOT NULL OR ISNULL(TIT.titulos, 0) > 0)
           THEN 1 ELSE 0 END                             AS cancelado_com_nota,
      CASE WHEN CAN.CANCELAMENTO_PEDIDO_PREVENDA IS NULL AND ISNULL(TOT.STATUS, '') = 'Pedido Processado'
            AND NF.NF_NUMERO IS NULL AND CUP.ECF_CUPOM IS NULL
            AND P.DATA_HORA < DATEADD(day, -7, GETDATE())
           THEN 1 ELSE 0 END                             AS parado_sem_faturar
    FROM PEDIDOS_PREVENDAS P WITH (NOLOCK)
    LEFT JOIN PEDIDOS_PREVENDAS_TOTAIS TOT WITH (NOLOCK) ON TOT.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
    LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = P.CLIENTE
    LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = P.VENDEDOR
    LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = P.USUARIO_LOGADO
    OUTER APPLY (
      SELECT TOP 1 C.CHECKOUT_PREVENDA, C.DATA_HORA, C.USUARIO_LOGADO AS usuario_checkout,
             COALESCE(NULLIF(LTRIM(RTRIM(UC.NOME)), ''), LTRIM(RTRIM(UC.LOGIN))) AS nome_checkout
      FROM CHECKOUT_PREVENDAS C WITH (NOLOCK)
      LEFT JOIN USUARIOS UC WITH (NOLOCK) ON UC.USUARIO = C.USUARIO_LOGADO
      WHERE C.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
      ORDER BY C.CHECKOUT_PREVENDA DESC
    ) CK
    OUTER APPLY (
      SELECT TOP 1 N.NF_NUMERO, N.NF_FATURAMENTO, N.MOVIMENTO
      FROM NF_FATURAMENTO N WITH (NOLOCK)
      WHERE TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) = P.PEDIDO_PREVENDA
      ORDER BY N.NF_FATURAMENTO DESC
    ) NF
    OUTER APPLY (
      SELECT TOP 1 PV.ECF_CUPOM, PV.CAIXA, PV.MOVIMENTO
      FROM PDV_VENDAS PV WITH (NOLOCK)
      WHERE PV.PREVENDA = P.PEDIDO_PREVENDA
      ORDER BY PV.MOVIMENTO DESC
    ) CUP
    OUTER APPLY (
      SELECT COUNT(*) AS titulos, SUM(ISNULL(TR.VALOR, 0)) AS valor_titulos,
             SUM(ISNULL(S.RECEBIDO, 0)) AS recebido, SUM(ISNULL(S.PENDENTE, TR.VALOR)) AS pendente
      FROM TITULOS_RECEBER TR WITH (NOLOCK)
      OUTER APPLY (
        SELECT SUM(ISNULL(TX.CREDITO, 0)) - SUM(ISNULL(TX.DEBITO, 0)) AS PENDENTE,
               SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END) AS RECEBIDO
        FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
        WHERE TX.TITULO_RECEBER = TR.TITULO_RECEBER
      ) S
      WHERE TR.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
    ) TIT
    OUTER APPLY (
      SELECT TOP 1 X.CANCELAMENTO_PEDIDO_PREVENDA, X.DATA_HORA
      FROM CANCELAMENTOS_PEDIDOS_PREVENDAS X WITH (NOLOCK)
      WHERE X.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
      ORDER BY X.CANCELAMENTO_PEDIDO_PREVENDA DESC
    ) CAN
  )`;

// Filtros da lista: por etapa do funil ou por divergência encontrada
const FILTROS = {
  orcamento: "etapa = 'ORCAMENTO'",
  aprovacao: "etapa = 'APROVACAO'",
  pedido: "etapa = 'PEDIDO'",
  checkout: "etapa = 'CHECKOUT'",
  faturado: "etapa = 'FATURADO'",
  pago: "etapa = 'PAGO'",
  cancelado: "etapa = 'CANCELADO'",
  pago_com_titulo_aberto: 'pago_com_titulo_aberto = 1',
  nota_sem_cobranca: 'nota_sem_cobranca = 1',
  cancelado_com_nota: 'cancelado_com_nota = 1',
  parado_sem_faturar: 'parado_sem_faturar = 1',
};

const ONDE = `
  WHERE (@inicio IS NULL OR dia >= @inicio)
    AND (@fim IS NULL OR dia <= @fim)
    AND (@vendedor IS NULL OR cod_vendedor = @vendedor)
    AND (@busca IS NULL
      OR CAST(pedido AS varchar(20)) = @busca
      OR CAST(nota AS varchar(20)) = @busca
      OR CAST(cupom AS varchar(20)) = @busca
      OR CAST(cod_cliente AS varchar(20)) = @busca
      OR cliente LIKE '%' + @busca + '%')`;

const criarRequest = (pool, filtros) => pool
  .request()
  .input('inicio', sql.VarChar(10), filtros.inicio ?? null)
  .input('fim', sql.VarChar(10), filtros.fim ?? null)
  .input('busca', sql.VarChar(60), filtros.busca ?? null)
  .input('vendedor', sql.Int, filtros.vendedor ?? null);

// Funil do período, divergências e a lista de pedidos
async function analise(filtros) {
  const pool = await getPool();
  const filtro = FILTROS[filtros.filtro] ?? '1 = 1';
  const { recordsets } = await criarRequest(pool, filtros).query(`
    ${PEDIDOS}
    SELECT
      COUNT(*)                                                                  AS pedidos,
      SUM(valor)                                                                AS valor,
      SUM(CASE WHEN etapa = 'ORCAMENTO' THEN 1 ELSE 0 END)                      AS orcamentos,
      SUM(CASE WHEN etapa = 'ORCAMENTO' THEN valor ELSE 0 END)                  AS valor_orcamentos,
      SUM(CASE WHEN etapa = 'APROVACAO' THEN 1 ELSE 0 END)                      AS aprovacao,
      SUM(CASE WHEN etapa = 'APROVACAO' THEN valor ELSE 0 END)                  AS valor_aprovacao,
      SUM(CASE WHEN etapa = 'PEDIDO' THEN 1 ELSE 0 END)                         AS pedidos_abertos,
      SUM(CASE WHEN etapa = 'PEDIDO' THEN valor ELSE 0 END)                     AS valor_pedidos_abertos,
      SUM(CASE WHEN etapa = 'CHECKOUT' THEN 1 ELSE 0 END)                       AS checkouts,
      SUM(CASE WHEN etapa = 'CHECKOUT' THEN valor ELSE 0 END)                   AS valor_checkouts,
      SUM(CASE WHEN etapa = 'FATURADO' THEN 1 ELSE 0 END)                       AS faturados,
      SUM(CASE WHEN etapa = 'FATURADO' THEN valor ELSE 0 END)                   AS valor_faturados,
      SUM(CASE WHEN etapa = 'PAGO' THEN 1 ELSE 0 END)                           AS pagos,
      SUM(CASE WHEN etapa = 'PAGO' THEN valor ELSE 0 END)                       AS valor_pagos,
      SUM(CASE WHEN etapa = 'CANCELADO' THEN 1 ELSE 0 END)                      AS cancelados,
      SUM(CASE WHEN etapa = 'CANCELADO' THEN valor ELSE 0 END)                  AS valor_cancelados,
      SUM(pago_com_titulo_aberto)                                               AS div_pago_titulo,
      SUM(CASE WHEN pago_com_titulo_aberto = 1 THEN pendente ELSE 0 END)        AS valor_pago_titulo,
      SUM(nota_sem_cobranca)                                                    AS div_nota_sem_cobranca,
      SUM(CASE WHEN nota_sem_cobranca = 1 THEN valor ELSE 0 END)                AS valor_nota_sem_cobranca,
      SUM(cancelado_com_nota)                                                   AS div_cancelado_com_nota,
      SUM(CASE WHEN cancelado_com_nota = 1 THEN valor ELSE 0 END)               AS valor_cancelado_com_nota,
      SUM(parado_sem_faturar)                                                   AS div_parado,
      SUM(CASE WHEN parado_sem_faturar = 1 THEN valor ELSE 0 END)               AS valor_parado
    FROM PEDIDOS
    ${ONDE};

    ${PEDIDOS}
    SELECT TOP 3000 *
    FROM PEDIDOS
    ${ONDE} AND ${filtro}
    ORDER BY dia_hora DESC, pedido DESC;

    ${PEDIDOS}
    SELECT dia, COUNT(*) AS pedidos, SUM(valor) AS valor,
           SUM(CASE WHEN etapa = 'PAGO' THEN valor ELSE 0 END) AS pago
    FROM PEDIDOS
    ${ONDE}
    GROUP BY dia
    ORDER BY dia;
  `);
  return { resumo: recordsets[0][0] ?? {}, lista: recordsets[1], porDia: recordsets[2] };
}

// Um pedido inteiro: a linha do tempo e os títulos gerados
async function detalhe(pedido) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('pedido', sql.Int, pedido)
    .input('inicio', sql.VarChar(10), null)
    .input('fim', sql.VarChar(10), null)
    .input('busca', sql.VarChar(60), null)
    .input('vendedor', sql.Int, null)
    .query(`
      ${PEDIDOS}
      SELECT * FROM PEDIDOS WHERE pedido = @pedido;

      -- Títulos gerados pelo pedido, com o que já foi recebido em cada um
      SELECT
        LTRIM(RTRIM(TR.TITULO))                       AS titulo,
        CONVERT(varchar(10), TR.VENCIMENTO, 23)       AS vencimento,
        TR.VALOR                                      AS valor,
        ISNULL(S.RECEBIDO, 0)                         AS recebido,
        ISNULL(S.PENDENTE, TR.VALOR)                  AS pendente,
        CONVERT(varchar(10), S.ULTIMO, 23)            AS ultimo_recebimento
      FROM TITULOS_RECEBER TR WITH (NOLOCK)
      OUTER APPLY (
        SELECT SUM(ISNULL(TX.CREDITO, 0)) - SUM(ISNULL(TX.DEBITO, 0)) AS PENDENTE,
               SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END) AS RECEBIDO,
               MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN TX.DATA END) AS ULTIMO
        FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
        WHERE TX.TITULO_RECEBER = TR.TITULO_RECEBER
      ) S
      WHERE TR.PEDIDO_PREVENDA = @pedido
      ORDER BY TR.VENCIMENTO;
    `);
  return { pedido: recordsets[0][0] ?? null, titulos: recordsets[1] };
}

// Vendedores que aparecem no período (para o filtro da tela)
async function vendedores(filtros) {
  const pool = await getPool();
  const { recordset } = await criarRequest(pool, filtros).query(`
    ${PEDIDOS}
    SELECT cod_vendedor, MAX(vendedor) AS vendedor, COUNT(*) AS pedidos, SUM(valor) AS valor,
           SUM(CASE WHEN etapa = 'PAGO' THEN valor ELSE 0 END) AS pago,
           SUM(CASE WHEN etapa = 'CANCELADO' THEN 1 ELSE 0 END) AS cancelados
    FROM PEDIDOS
    ${ONDE}
    GROUP BY cod_vendedor
    ORDER BY valor DESC;
  `);
  return recordset;
}

module.exports = { analise, detalhe, vendedores, FILTROS, TAB_NOTA_FISCAL };
