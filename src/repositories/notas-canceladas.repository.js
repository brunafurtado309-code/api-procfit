// Faturamento > Notas canceladas / financeiro: notas canceladas que ainda mexem no financeiro.
//
// Regras conferidas no SSMS com a Bruna (nov/2026, 129 devoluções dos últimos 6 meses):
//   - Cancelamento de nota fica em CANCELAMENTOS_NOTAS_FISCAIS (CHAVE = id da nota):
//       TIPO 1 = nota de venda (CHAVE = NF_FATURAMENTO)   TIPO 3 = nota de DEVOLUÇÃO (CHAVE = NF_FATURAMENTO_DEVOLUCAO)
//     PROTOCOLO preenchido = cancelamento autorizado na SEFAZ.
//   - A devolução mexe no financeiro ABATENDO o título da nota original: transação 16 (abatimento) em
//     TITULOS_RECEBER_TRANSACOES com TAB_MASTER_ORIGEM = 753293 (a tabela da nota de devolução) e
//     REG_MASTER_ORIGEM = NF_FATURAMENTO_DEVOLUCAO. Apareceu em 81 das 129 devoluções — e as 3 devoluções
//     canceladas continuavam com o abatimento. A devolução não cria título a receber próprio.
//     (Os outros códigos que casaram pelo número eram coincidência: milhares de linhas para 129 devoluções.)
//   - Por isso, devolução cancelada "gerando financeiro" = o abatimento dela continua valendo no título:
//       gerando = soma(DEBITO - CREDITO) das transações com origem na devolução (se o abatimento foi desfeito
//                 pela própria devolução, o crédito entra aqui e zera)
//     Sobrou mais de R$ 0,01 = o cliente continua com o desconto de uma devolução que não existe mais.
//     Estornos (51..55) lançados nesses títulos depois do cancelamento, por outra tela, aparecem à parte
//     ("estorno depois") para conferir: podem ser a correção, ou o estorno de um pagamento — a tela não
//     desconta sozinha, para não esconder uma divergência.
//   - Nota de VENDA cancelada "gerando financeiro" = o título da nota (TAB_MASTER_ORIGEM 753289,
//     REG_MASTER_ORIGEM = NF_FATURAMENTO) ainda tem saldo em aberto, ou recebeu dinheiro.
//     Saldo pelo extrato: CREDITO aumenta a dívida, DEBITO diminui; recebido = DEBITO da transação 12;
//     cancelamento do título = 13 (regras do financeiro.repository.js).
//     Fica de fora o título gerado pelo acerto de despacho (455510): ele não aponta para a nota.

const { sql, getPool } = require('../config/db');

const TAB_NOTA_VENDA = 753289;
const TAB_NOTA_DEVOLUCAO = 753293;

async function listar(filtros) {
  const pool = await getPool();
  const { recordsets } = await pool.request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .query(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#DC') IS NOT NULL DROP TABLE #DC;
      IF OBJECT_ID('tempdb..#NC') IS NOT NULL DROP TABLE #NC;
      IF OBJECT_ID('tempdb..#TNC') IS NOT NULL DROP TABLE #TNC;
      DECLARE @ini date = CAST(@inicio AS date);
      DECLARE @ate date = DATEADD(day, 1, CAST(@fim AS date));

      -- ===== A. Notas de devolução canceladas no período (pelo dia do cancelamento) =====
      SELECT DV.NF_FATURAMENTO_DEVOLUCAO                    AS id,
             DV.NF_NUMERO                                   AS nota_devolucao,
             CONVERT(varchar(10), DV.MOVIMENTO, 23)         AS devolucao_dia,
             C.DATA_HORA                                    AS cancelado_em,
             CASE WHEN C.PROTOCOLO IS NOT NULL THEN 1 ELSE 0 END AS com_protocolo,
             N.NF_NUMERO                                    AS nota_origem,
             TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS pedido,
             N.EMPRESA                                      AS empresa,
             N.ENTIDADE                                     AS cod_cliente,
             LTRIM(RTRIM(E.NOME))                           AS cliente,
             N.VENDEDOR                                     AS cod_vendedor,
             LTRIM(RTRIM(V.NOME))                           AS vendedor,
             ISNULL(DT.TOTAL_GERAL, 0)                      AS valor_devolucao
      INTO #DC
      FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
      CROSS APPLY (SELECT TOP 1 NC.DATA_HORA, NC.PROTOCOLO
                   FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                   WHERE NC.TIPO = 3 AND NC.CHAVE = DV.NF_FATURAMENTO_DEVOLUCAO
                   ORDER BY NC.DATA_HORA DESC) C
      LEFT JOIN NF_FATURAMENTO_DEVOLUCOES_TOTAIS DT WITH (NOLOCK) ON DT.NF_FATURAMENTO_DEVOLUCAO = DV.NF_FATURAMENTO_DEVOLUCAO
      LEFT JOIN NF_FATURAMENTO N WITH (NOLOCK) ON N.NF_FATURAMENTO = DV.NF_FATURAMENTO_ORIGEM
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = N.ENTIDADE
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = N.VENDEDOR
      WHERE C.DATA_HORA >= @ini AND C.DATA_HORA < @ate
        AND (@empresa IS NULL OR N.EMPRESA = @empresa)
      OPTION (RECOMPILE);

      -- [0] Uma linha por devolução cancelada, com o que ela ainda faz no financeiro
      SELECT D.id, D.nota_devolucao, D.devolucao_dia, CONVERT(varchar(16), D.cancelado_em, 120) AS cancelado_em,
             D.com_protocolo, D.nota_origem, D.pedido, D.empresa, D.cod_cliente, D.cliente, D.cod_vendedor, D.vendedor,
             D.valor_devolucao,
             ISNULL(F.abatido, 0)                              AS abatido,
             ISNULL(F.desfeito, 0)                             AS desfeito,
             ISNULL(EST.estornado, 0)                          AS estornado_depois,
             ISNULL(F.efeito, 0)                               AS gerando,
             ISNULL(F.titulos, 0)                              AS titulos,
             NT.numeros_titulos,
             ISNULL(SLD.pendente, 0)                           AS titulos_pendente
      FROM #DC D
      -- Transações com origem na própria devolução (o abatimento e, se houver, o estorno dele)
      OUTER APPLY (
        SELECT SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 16 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END) AS abatido,
               SUM(ISNULL(TX.CREDITO, 0))                                                    AS desfeito,
               SUM(ISNULL(TX.DEBITO, 0) - ISNULL(TX.CREDITO, 0))                             AS efeito,
               COUNT(DISTINCT TX.TITULO_RECEBER)                                             AS titulos
        FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
        WHERE TX.TAB_MASTER_ORIGEM = ${TAB_NOTA_DEVOLUCAO} AND TX.REG_MASTER_ORIGEM = D.id
      ) F
      -- Números dos títulos abatidos (cada um uma vez)
      OUTER APPLY (
        SELECT STRING_AGG(CAST(LTRIM(RTRIM(T.TITULO)) AS varchar(max)), ', ') AS numeros_titulos
        FROM TITULOS_RECEBER T WITH (NOLOCK)
        WHERE T.TITULO_RECEBER IN (SELECT TX.TITULO_RECEBER FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
                                   WHERE TX.TAB_MASTER_ORIGEM = ${TAB_NOTA_DEVOLUCAO} AND TX.REG_MASTER_ORIGEM = D.id)
      ) NT
      -- Estornos (51..55) lançados nesses títulos depois do cancelamento, por outra tela (só para conferir)
      OUTER APPLY (
        SELECT SUM(ISNULL(X.CREDITO, 0)) AS estornado
        FROM TITULOS_RECEBER_TRANSACOES X WITH (NOLOCK)
        WHERE X.TRANSACAO_FINANCEIRA BETWEEN 51 AND 55
          AND X.DATA >= CAST(D.cancelado_em AS date)
          AND ISNULL(X.TAB_MASTER_ORIGEM, 0) <> ${TAB_NOTA_DEVOLUCAO}
          AND X.TITULO_RECEBER IN (SELECT TX.TITULO_RECEBER FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
                                   WHERE TX.TAB_MASTER_ORIGEM = ${TAB_NOTA_DEVOLUCAO} AND TX.REG_MASTER_ORIGEM = D.id)
      ) EST
      -- Quanto ainda está em aberto nesses títulos hoje
      OUTER APPLY (
        SELECT SUM(ISNULL(X.CREDITO, 0)) - SUM(ISNULL(X.DEBITO, 0)) AS pendente
        FROM TITULOS_RECEBER_TRANSACOES X WITH (NOLOCK)
        WHERE X.TITULO_RECEBER IN (SELECT TX.TITULO_RECEBER FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
                                   WHERE TX.TAB_MASTER_ORIGEM = ${TAB_NOTA_DEVOLUCAO} AND TX.REG_MASTER_ORIGEM = D.id)
      ) SLD
      ORDER BY ISNULL(F.efeito, 0) DESC, D.cancelado_em DESC;

      -- ===== B. Notas de VENDA canceladas no período com título da nota em aberto ou recebido =====
      SELECT N.NF_FATURAMENTO AS id, N.NF_NUMERO AS nota, CONVERT(varchar(10), N.MOVIMENTO, 23) AS nota_dia,
             C.DATA_HORA AS cancelado_em, CASE WHEN C.PROTOCOLO IS NOT NULL THEN 1 ELSE 0 END AS com_protocolo,
             TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS pedido,
             N.EMPRESA AS empresa, N.ENTIDADE AS cod_cliente, N.VENDEDOR AS cod_vendedor
      INTO #NC
      FROM NF_FATURAMENTO N WITH (NOLOCK)
      CROSS APPLY (SELECT TOP 1 NC.DATA_HORA, NC.PROTOCOLO
                   FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                   WHERE NC.TIPO = 1 AND NC.CHAVE = N.NF_FATURAMENTO
                   ORDER BY NC.DATA_HORA DESC) C
      WHERE C.DATA_HORA >= @ini AND C.DATA_HORA < @ate
        AND (@empresa IS NULL OR N.EMPRESA = @empresa)
      OPTION (RECOMPILE);

      SELECT T.REG_MASTER_ORIGEM AS nota_id, T.TITULO_RECEBER, LTRIM(RTRIM(T.TITULO)) AS titulo,
             CONVERT(varchar(10), T.VENCIMENTO, 23) AS vencimento, T.VALOR AS valor,
             SUM(ISNULL(X.CREDITO, 0)) - SUM(ISNULL(X.DEBITO, 0))                              AS pendente,
             SUM(CASE WHEN X.TRANSACAO_FINANCEIRA = 12 THEN ISNULL(X.DEBITO, 0) ELSE 0 END)    AS recebido,
             SUM(CASE WHEN X.TRANSACAO_FINANCEIRA = 13 THEN ISNULL(X.DEBITO, 0) ELSE 0 END)    AS cancelado
      INTO #TNC
      FROM TITULOS_RECEBER T WITH (NOLOCK)
      JOIN #NC NC ON T.TAB_MASTER_ORIGEM = ${TAB_NOTA_VENDA} AND T.REG_MASTER_ORIGEM = NC.id
      LEFT JOIN TITULOS_RECEBER_TRANSACOES X WITH (NOLOCK) ON X.TITULO_RECEBER = T.TITULO_RECEBER
      GROUP BY T.REG_MASTER_ORIGEM, T.TITULO_RECEBER, T.TITULO, T.VENCIMENTO, T.VALOR;

      -- [1] Uma linha por nota de venda cancelada que ainda tem financeiro
      SELECT NC.id, NC.nota, NC.nota_dia, CONVERT(varchar(16), NC.cancelado_em, 120) AS cancelado_em, NC.com_protocolo,
             NC.pedido, NC.empresa, NC.cod_cliente, LTRIM(RTRIM(E.NOME)) AS cliente, NC.cod_vendedor, LTRIM(RTRIM(V.NOME)) AS vendedor,
             ISNULL(NT.TOTAL_GERAL, 0) AS valor_nota,
             COUNT(*) AS titulos, SUM(TT.valor) AS valor_titulos,
             SUM(CASE WHEN TT.pendente > 0.009 THEN TT.pendente ELSE 0 END) AS pendente,
             SUM(TT.recebido) AS recebido,
             SUM(TT.cancelado) AS titulos_cancelado,
             STRING_AGG(CAST(TT.titulo AS varchar(max)), ', ') AS numeros_titulos,
             MIN(CASE WHEN TT.pendente > 0.009 THEN TT.vencimento END) AS vence
      FROM #NC NC
      JOIN #TNC TT ON TT.nota_id = NC.id
      LEFT JOIN NF_FATURAMENTO_TOTAIS NT WITH (NOLOCK) ON NT.NF_FATURAMENTO = NC.id
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = NC.cod_cliente
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = NC.cod_vendedor
      GROUP BY NC.id, NC.nota, NC.nota_dia, NC.cancelado_em, NC.com_protocolo, NC.pedido, NC.empresa, NC.cod_cliente,
               E.NOME, NC.cod_vendedor, V.NOME, NT.TOTAL_GERAL
      HAVING SUM(CASE WHEN TT.pendente > 0.009 THEN TT.pendente ELSE 0 END) > 0.009 OR SUM(TT.recebido) > 0.009
      ORDER BY SUM(CASE WHEN TT.pendente > 0.009 THEN TT.pendente ELSE 0 END) + SUM(TT.recebido) DESC;

      -- [2] Quantas notas de cada tipo foram canceladas no período (para o resumo)
      SELECT (SELECT COUNT(*) FROM #DC) AS devolucoes_canceladas, (SELECT COUNT(*) FROM #NC) AS vendas_canceladas;
    `);
  return { devolucoes: recordsets[0], vendas: recordsets[1], contagem: recordsets[2][0] ?? {} };
}

module.exports = { listar, TAB_NOTA_DEVOLUCAO };
