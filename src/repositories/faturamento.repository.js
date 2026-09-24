// Módulo FATURAMENTO: o ciclo da venda, do orçamento até o pagamento.
//
// Etapas no PROCFIT (validado em set/2026, últimos 3 meses):
//   13.101 pedidos · 12.902 processados · 9.416 com checkout · 2.532 com cupom · 562 cancelados
//   PEDIDOS_PREVENDAS_TOTAIS.STATUS: "Orçamento", "Pendente Aprovação", "Pedido Processado", "Cancelado"
//   CHECKOUT_PREVENDAS.NF_NUMERO quase nunca é preenchido (10 em 13 mil): a nota vem de
//   NF_FATURAMENTO.PEDIDO_CLIENTE, e é assim que o painel liga pedido e nota.
//   O cancelamento não fica no pedido (CANCELADA = 'N' em tudo): fica em CANCELAMENTOS_PEDIDOS_PREVENDAS.
//
// Desempenho (set/2026): a consulta estourava o limite de 15 s do banco com 30 dias. Motivos:
//   1. o período era filtrado DEPOIS de montar tudo, sobre a data convertida em texto;
//   2. a ligação pedido x nota usava "OR TRY_CAST(PEDIDO_CLIENTE)", que lia a tabela de notas
//      inteira uma vez PARA CADA pedido;
//   3. a mesma montagem rodava 3 vezes seguidas (resumo, lista e gráfico).
// Agora a montagem é feita uma vez só, em tabelas temporárias: primeiro os pedidos do período
// (#P), depois as notas ligadas a eles numa leitura única (#NF), e por fim a linha completa
// de cada pedido (#BASE). Resumo, lista e gráfico leem de #BASE. O resultado é o mesmo de antes.
//
// Devoluções (set/2026): a devolução NÃO muda a etapa do pedido (quem foi pago continua "Pago",
// porque a venda aconteceu). Ela entra como um fato a mais, com o valor devolvido. Mesma regra
// do painel de Vendas (vendas.repository.js):
//   - por nota: NF_FATURAMENTO_DEVOLUCOES.NF_FATURAMENTO_ORIGEM aponta a nota original; o valor
//     vem da VENDAS_ANALITICAS (tipos 12, 13, 16), onde DOCUMENTO_NUMERO é o nº da nota ORIGINAL;
//   - no caixa: DEV_PRODUTOS.REG_MASTER_ORIGEM_RELACIONADO aponta o cupom (PDV_VENDAS.REG_MASTER_ORIGEM);
//     o valor vem da VENDAS_ANALITICAS tipo 14, pelo REG_MASTER_ORIGEM (= DEVOLUCAO_PRODUTO).

const { sql, getPool } = require('../config/db');

const TAB_NOTA_FISCAL = 753289;

// Monta, uma vez só, a linha completa de cada pedido (totais, checkout, cupom, nota, títulos e
// cancelamento) na tabela temporária #BASE. "ondePedidos" escolhe os pedidos em PEDIDOS_PREVENDAS P.
// As tabelas temporárias existem só durante esta consulta e somem sozinhas no fim.
const montarBase = (ondePedidos) => `
  SET NOCOUNT ON;
  IF OBJECT_ID('tempdb..#P') IS NOT NULL DROP TABLE #P;
  IF OBJECT_ID('tempdb..#NF') IS NOT NULL DROP TABLE #NF;
  IF OBJECT_ID('tempdb..#BASE') IS NOT NULL DROP TABLE #BASE;
  IF OBJECT_ID('tempdb..#VADEV') IS NOT NULL DROP TABLE #VADEV;
  IF OBJECT_ID('tempdb..#DEV') IS NOT NULL DROP TABLE #DEV;
  IF OBJECT_ID('tempdb..#DEVP') IS NOT NULL DROP TABLE #DEVP;

  -- 1. Só os pedidos que interessam (período, vendedor ou um pedido específico)
  SELECT P.PEDIDO_PREVENDA, P.EMPRESA, P.DATA_HORA, P.DATA_HORA_PROCESSAR,
         P.CLIENTE, P.VENDEDOR, P.USUARIO_LOGADO
  INTO #P
  FROM PEDIDOS_PREVENDAS P WITH (NOLOCK)
  WHERE ${ondePedidos}
  OPTION (RECOMPILE);
  CREATE CLUSTERED INDEX IX_P ON #P (PEDIDO_PREVENDA);

  -- 2. As notas desses pedidos, numa leitura só da NF_FATURAMENTO.
  --    A nota se liga ao pedido por PEDIDO_VENDA ou pelo texto de PEDIDO_CLIENTE (ver acima);
  --    fica a nota mais recente de cada pedido, como antes.
  SELECT X.pedido, X.NF_NUMERO, X.NF_FATURAMENTO, X.MOVIMENTO,
         ROW_NUMBER() OVER (PARTITION BY X.pedido ORDER BY X.NF_FATURAMENTO DESC) AS ordem
  INTO #NF
  FROM (
    SELECT N.PEDIDO_VENDA AS pedido, N.NF_NUMERO, N.NF_FATURAMENTO, N.MOVIMENTO
    FROM NF_FATURAMENTO N WITH (NOLOCK)
    JOIN #P PP ON PP.PEDIDO_PREVENDA = N.PEDIDO_VENDA
    UNION
    SELECT C.pedido, C.NF_NUMERO, C.NF_FATURAMENTO, C.MOVIMENTO
    FROM (
      SELECT TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS pedido,
             N.NF_NUMERO, N.NF_FATURAMENTO, N.MOVIMENTO
      FROM NF_FATURAMENTO N WITH (NOLOCK)
    ) C
    JOIN #P PP ON PP.PEDIDO_PREVENDA = C.pedido
  ) X;
  CREATE CLUSTERED INDEX IX_NF ON #NF (pedido, ordem);

  -- 3. Devoluções desses pedidos (valor positivo = quanto voltou)
  --    Primeiro, só as linhas de devolução da VENDAS_ANALITICAS desde o pedido mais antigo:
  --    uma leitura só, em vez de procurar nota por nota.
  DECLARE @desde date = (SELECT CAST(MIN(DATA_HORA) AS date) FROM #P);
  SELECT VA.DOCUMENTO_TIPO, VA.DOCUMENTO_NUMERO, VA.CLIENTE, VA.REG_MASTER_ORIGEM,
         VA.MOVIMENTO, VA.VENDA_LIQUIDA
  INTO #VADEV
  FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
  WHERE VA.DOCUMENTO_TIPO IN (12, 13, 14, 16)
    AND VA.MOVIMENTO >= @desde;

  CREATE TABLE #DEV (pedido numeric(18, 0), tipo varchar(10), documento varchar(30),
                     dia date, valor decimal(18, 2), usuario int);

  -- 3a. Devolução por nota: uma linha por nota original que teve devolução
  INSERT INTO #DEV (pedido, tipo, documento, dia, valor, usuario)
  SELECT NF.pedido, 'nota', CAST(DVI.numero AS varchar(30)), CAST(DVI.data_hora AS date),
         -VAL.valor, DVI.usuario
  FROM #NF NF
  JOIN #P PP ON PP.PEDIDO_PREVENDA = NF.pedido
  CROSS APPLY (
    SELECT MAX(DV.NF_NUMERO) AS numero, MAX(DV.DATA_HORA) AS data_hora, MAX(DV.USUARIO_LOGADO) AS usuario
    FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
    WHERE DV.NF_FATURAMENTO_ORIGEM = NF.NF_FATURAMENTO
    HAVING COUNT(*) > 0
  ) DVI
  OUTER APPLY (
    SELECT SUM(V.VENDA_LIQUIDA) AS valor
    FROM #VADEV V
    WHERE V.DOCUMENTO_TIPO IN (12, 13, 16)
      AND V.DOCUMENTO_NUMERO = NF.NF_NUMERO
      AND V.CLIENTE = PP.CLIENTE
  ) VAL;

  -- 3b. Devolução no caixa: uma linha por devolução ligada a um cupom do pedido
  INSERT INTO #DEV (pedido, tipo, documento, dia, valor, usuario)
  SELECT D.pedido, 'caixa', CAST(D.DEVOLUCAO_PRODUTO AS varchar(30)), VAL.dia, -VAL.valor, NULL
  FROM (
    SELECT DISTINCT PV.PREVENDA AS pedido, DP.DEVOLUCAO_PRODUTO
    FROM PDV_VENDAS PV WITH (NOLOCK)
    JOIN #P PP ON PP.PEDIDO_PREVENDA = PV.PREVENDA
    JOIN DEV_PRODUTOS DP WITH (NOLOCK)
      ON DP.REG_MASTER_ORIGEM_RELACIONADO = PV.REG_MASTER_ORIGEM
     AND DP.REG_MASTER_ORIGEM_RELACIONADO > 0
  ) D
  OUTER APPLY (
    SELECT SUM(V.VENDA_LIQUIDA) AS valor, MIN(V.MOVIMENTO) AS dia
    FROM #VADEV V
    WHERE V.DOCUMENTO_TIPO = 14 AND V.REG_MASTER_ORIGEM = D.DEVOLUCAO_PRODUTO
  ) VAL;

  -- 3c. Resumo das devoluções por pedido
  SELECT pedido, SUM(valor) AS devolvido, COUNT(*) AS devolucoes, MAX(dia) AS dia
  INTO #DEVP
  FROM #DEV
  GROUP BY pedido;
  CREATE CLUSTERED INDEX IX_DEVP ON #DEVP (pedido);

  -- 4. A linha completa de cada pedido
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
      CAN.CANCELAMENTO_PEDIDOS_PREVENDA                  AS cancelamento,
      CONVERT(varchar(10), CAN.DATA_HORA, 23)            AS cancelado_em,
      -- Em que etapa a venda está hoje
      CASE
        WHEN CAN.CANCELAMENTO_PEDIDOS_PREVENDA IS NOT NULL OR TOT.STATUS = 'Cancelado' THEN 'CANCELADO'
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
      CASE WHEN (CAN.CANCELAMENTO_PEDIDOS_PREVENDA IS NOT NULL OR TOT.STATUS = 'Cancelado')
            AND (NF.NF_NUMERO IS NOT NULL OR ISNULL(TIT.titulos, 0) > 0)
           THEN 1 ELSE 0 END                             AS cancelado_com_nota,
      CASE WHEN CAN.CANCELAMENTO_PEDIDOS_PREVENDA IS NULL AND ISNULL(TOT.STATUS, '') = 'Pedido Processado'
            AND NF.NF_NUMERO IS NULL AND CUP.ECF_CUPOM IS NULL
            AND P.DATA_HORA < DATEADD(day, -7, GETDATE())
           THEN 1 ELSE 0 END                             AS parado_sem_faturar,
      -- Devolução: não muda a etapa, é um fato a mais
      ISNULL(DEVP.devolvido, 0)                          AS devolvido,
      ISNULL(DEVP.devolucoes, 0)                         AS devolucoes,
      CONVERT(varchar(10), DEVP.dia, 23)                 AS devolucao_dia,
      CASE
        WHEN DEVP.pedido IS NULL                                            THEN NULL
        WHEN DEVP.devolvido IS NULL                                         THEN 'SEM_VALOR'
        WHEN DEVP.devolvido >= ISNULL(TOT.PRECO_TOTAL, 0) - 0.01            THEN 'TOTAL'
        ELSE                                                                     'PARCIAL'
      END                                                AS devolucao
  INTO #BASE
  FROM #P P
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
  LEFT JOIN #NF NF ON NF.pedido = P.PEDIDO_PREVENDA AND NF.ordem = 1
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
    SELECT TOP 1 X.CANCELAMENTO_PEDIDOS_PREVENDA, X.DATA_HORA
    FROM CANCELAMENTOS_PEDIDOS_PREVENDAS X WITH (NOLOCK)
    WHERE X.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
    ORDER BY X.CANCELAMENTO_PEDIDOS_PREVENDA DESC
  ) CAN
  LEFT JOIN #DEVP DEVP ON DEVP.pedido = P.PEDIDO_PREVENDA
;
`;

// Pedidos do período (e do vendedor, se escolhido). A data é comparada direto na coluna,
// sem converter para texto, para o banco conseguir usar o índice.
const PEDIDOS_DO_PERIODO = `
      (@inicio IS NULL OR P.DATA_HORA >= CAST(@inicio AS date))
  AND (@fim IS NULL OR P.DATA_HORA < DATEADD(day, 1, CAST(@fim AS date)))
  AND (@vendedor IS NULL OR P.VENDEDOR = @vendedor)`;

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
  devolvido: 'devolucoes > 0',
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
    ${montarBase(PEDIDOS_DO_PERIODO)}
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
      SUM(CASE WHEN parado_sem_faturar = 1 THEN valor ELSE 0 END)               AS valor_parado,
      SUM(CASE WHEN devolucoes > 0 THEN 1 ELSE 0 END)                           AS devolvidos,
      SUM(CASE WHEN devolucao = 'TOTAL' THEN 1 ELSE 0 END)                      AS devolvidos_total,
      SUM(devolvido)                                                            AS valor_devolvido
    FROM #BASE
    ${ONDE};

    SELECT TOP 3000 *
    FROM #BASE
    ${ONDE} AND ${filtro}
    ORDER BY dia_hora DESC, pedido DESC;

    SELECT dia, COUNT(*) AS pedidos, SUM(valor) AS valor,
           SUM(CASE WHEN etapa = 'PAGO' THEN valor ELSE 0 END) AS pago
    FROM #BASE
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
      ${montarBase('P.PEDIDO_PREVENDA = @pedido')}
      SELECT * FROM #BASE WHERE pedido = @pedido;

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

      -- Devoluções do pedido (por nota e no caixa), com quem lançou quando existe
      SELECT D.tipo, D.documento, CONVERT(varchar(10), D.dia, 23) AS dia, D.valor,
             COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome
      FROM #DEV D
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = D.usuario
      ORDER BY D.dia;
    `);
  return { pedido: recordsets[0][0] ?? null, titulos: recordsets[1], devolucoes: recordsets[2] };
}

// Vendedores que aparecem no período (para o filtro da tela)
async function vendedores(filtros) {
  const pool = await getPool();
  const { recordset } = await criarRequest(pool, filtros).query(`
    ${montarBase(PEDIDOS_DO_PERIODO)}
    SELECT cod_vendedor, MAX(vendedor) AS vendedor, COUNT(*) AS pedidos, SUM(valor) AS valor,
           SUM(CASE WHEN etapa = 'PAGO' THEN valor ELSE 0 END) AS pago,
           SUM(CASE WHEN etapa = 'CANCELADO' THEN 1 ELSE 0 END) AS cancelados
    FROM #BASE
    ${ONDE}
    GROUP BY cod_vendedor
    ORDER BY valor DESC;
  `);
  return recordset;
}

module.exports = { analise, detalhe, vendedores, FILTROS, TAB_NOTA_FISCAL };
