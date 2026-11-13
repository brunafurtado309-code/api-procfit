// Faturamento > Notas canceladas / financeiro: notas canceladas que ainda mexem no financeiro.
//
// Regras conferidas no SSMS com a Bruna (nov/2026, 129 devoluções dos últimos 6 meses):
//   - Cada nota tem DOIS números: o registro (NF_FATURAMENTO, o campo "NF de Faturamento" da tela de
//     digitação do PROCFIT) e o número da NF-e (NF_NUMERO, o impresso). A tela mostra os dois, para
//     procurar no PROCFIT pelo registro (nov/2026: a nota 7987 é o registro 8315; o registro 7987 é a nota 7662).
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
//     REG_MASTER_ORIGEM = NF_FATURAMENTO) ainda tem saldo em aberto, ou ficou com dinheiro recebido.
//     Saldo pelo extrato: CREDITO aumenta a dívida, DEBITO diminui; recebido = DEBITO da transação 12;
//     cancelamento do título = 13 (regras do financeiro.repository.js).
//     Recebido LÍQUIDO = recebido - estornos (51..55, crédito): nota cancelada com o recebimento já
//     estornado foi corrigida do jeito certo e não aparece. Nota cancelada NÃO pode ter recebimento.
//     Fica de fora o título gerado pelo acerto de despacho (455510): ele não aponta para a nota.
//   - ONDE a baixa foi feita (nov/2026), pelo TAB_MASTER_ORIGEM da transação 12 (mesma regra de
//     despachos.repository.js): 668401 Bancos por títulos (RECEBIMENTOS_BANCOS, o registro é o
//     RECEBIMENTO_BANCO; FORM_ORIGEM 456558 = PIX lançado pelo acerto de despacho) · 356928 caixa
//     (RECEBIMENTOS_CAIXA) · 249008 cofre da loja (COFRES_LOJAS_LANCAMENTOS) · 455510 retorno de despacho.
//   - Nota que SUBSTITUIU a cancelada (nov/2026): outra nota de venda válida (sem cancelamento) da mesma
//     loja, pelo mesmo pedido (PEDIDO_CLIENTE); sem pedido, a do mesmo cliente e mesmo valor emitida até
//     15 dias depois do cancelamento. Se o título dela está em aberto e a cancelada ficou com o
//     recebimento, o cliente pode ser cobrado DUAS vezes.

const { sql, getPool } = require('../config/db');

const TAB_NOTA_VENDA = 753289;

// Cabeçalho do recebimento de Bancos (tela "Recebimentos de Título a Receber (Bancos)"):
// conferidas no SSMS (nov/2026) RECEBIMENTO_BANCO, EMPRESA, DATA_HORA, DATA_RECEBIMENTO, MOVIMENTO,
// USUARIO_LOGADO, CONTA_BANCARIA, MODALIDADE, FORM_ORIGEM e REG_ORIGEM. A entidade e a descrição
// ainda não: a API procura essas colunas sozinha na primeira consulta (sem elas, a tela segue sem esses campos).
let colunasRecebimento; // undefined = ainda não procurou
async function extrasDoRecebimento(pool) {
  if (colunasRecebimento === undefined) {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'RECEBIMENTOS_BANCOS' AND COLUMN_NAME IN ('ENTIDADE', 'DESCRICAO', 'HISTORICO', 'OBSERVACAO')`);
      colunasRecebimento = new Set(r.recordset.map((l) => l.COLUMN_NAME));
    } catch (_) {
      colunasRecebimento = new Set();
    }
    console.log(`[canceladas] colunas extras de RECEBIMENTOS_BANCOS: ${[...colunasRecebimento].join(', ') || 'nenhuma'}`);
  }
  const campos = [];
  let junta = '';
  if (colunasRecebimento.has('ENTIDADE')) {
    campos.push('RB.ENTIDADE AS rb_entidade', 'LTRIM(RTRIM(ERB.NOME)) AS rb_entidade_nome');
    junta = 'LEFT JOIN ENTIDADES ERB WITH (NOLOCK) ON ERB.ENTIDADE = RB.ENTIDADE';
  }
  const descricao = ['DESCRICAO', 'HISTORICO', 'OBSERVACAO'].find((c) => colunasRecebimento.has(c));
  if (descricao) campos.push(`LTRIM(RTRIM(CAST(RB.[${descricao}] AS varchar(200)))) AS rb_descricao`);
  const separador = ',\n             ';
  return { campos: campos.length ? separador + campos.join(separador) : '', junta };
}
const TAB_NOTA_DEVOLUCAO = 753293;

async function listar(filtros) {
  const pool = await getPool();
  const rb = await extrasDoRecebimento(pool);
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
             N.NF_FATURAMENTO                               AS nota_origem_registro,
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
             D.com_protocolo, D.nota_origem, D.nota_origem_registro, D.pedido, D.empresa, D.cod_cliente, D.cliente, D.cod_vendedor, D.vendedor,
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
             SUM(CASE WHEN X.TRANSACAO_FINANCEIRA BETWEEN 51 AND 55 THEN ISNULL(X.CREDITO, 0) ELSE 0 END) AS estornado,
             SUM(CASE WHEN X.TRANSACAO_FINANCEIRA = 13 THEN ISNULL(X.DEBITO, 0) ELSE 0 END)    AS cancelado,
             MIN(CASE WHEN X.TRANSACAO_FINANCEIRA = 12 THEN X.DATA END)                         AS primeiro_recebimento,
             MAX(CASE WHEN X.TRANSACAO_FINANCEIRA = 12 THEN X.DATA END)                         AS ultimo_recebimento
      INTO #TNC
      FROM TITULOS_RECEBER T WITH (NOLOCK)
      JOIN #NC NC ON T.TAB_MASTER_ORIGEM = ${TAB_NOTA_VENDA} AND T.REG_MASTER_ORIGEM = NC.id
      LEFT JOIN TITULOS_RECEBER_TRANSACOES X WITH (NOLOCK) ON X.TITULO_RECEBER = T.TITULO_RECEBER
      GROUP BY T.REG_MASTER_ORIGEM, T.TITULO_RECEBER, T.TITULO, T.VENCIMENTO, T.VALOR;

      -- [1] Uma linha por nota de venda cancelada que ainda tem financeiro
      SELECT NC.id, NC.nota, NC.nota_dia, CONVERT(varchar(16), NC.cancelado_em, 120) AS cancelado_em, NC.com_protocolo,
             NC.pedido, NC.empresa, NC.cod_cliente, LTRIM(RTRIM(E.NOME)) AS cliente, NC.cod_vendedor, LTRIM(RTRIM(V.NOME)) AS vendedor,
             ISNULL(NT.TOTAL_GERAL, 0) AS valor_nota,
             TT.titulos, TT.valor_titulos, TT.pendente, TT.recebido_bruto, TT.estornado,
             TT.recebido_bruto - TT.estornado AS recebido,
             TT.numeros_titulos, TT.vence,
             CONVERT(varchar(16), TT.primeiro_recebimento, 120) AS primeiro_recebimento,
             CONVERT(varchar(16), TT.ultimo_recebimento, 120)   AS ultimo_recebimento,
             -- Recebido depois do cancelamento = baixa dada no título errado
             CASE WHEN TT.ultimo_recebimento >= CAST(NC.cancelado_em AS date) THEN 1 ELSE 0 END AS recebido_depois,
             SUB.nota       AS nota_substituta,
             SUB.registro   AS nota_substituta_registro,
             SUB.dia        AS nota_substituta_dia,
             SUB.como       AS substituta_por,
             SUB.pendente   AS substituta_pendente
      FROM #NC NC
      CROSS APPLY (
        SELECT COUNT(*) AS titulos, SUM(T.valor) AS valor_titulos,
               SUM(CASE WHEN T.pendente > 0.009 THEN T.pendente ELSE 0 END) AS pendente,
               SUM(T.recebido) AS recebido_bruto, SUM(T.estornado) AS estornado,
               STRING_AGG(CAST(T.titulo AS varchar(max)), ', ') AS numeros_titulos,
               MIN(CASE WHEN T.pendente > 0.009 THEN T.vencimento END) AS vence,
               MIN(T.primeiro_recebimento) AS primeiro_recebimento, MAX(T.ultimo_recebimento) AS ultimo_recebimento
        FROM #TNC T WHERE T.nota_id = NC.id
      ) TT
      LEFT JOIN NF_FATURAMENTO_TOTAIS NT WITH (NOLOCK) ON NT.NF_FATURAMENTO = NC.id
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = NC.cod_cliente
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = NC.cod_vendedor
      -- A nota que substituiu: mesmo pedido; sem pedido, mesmo cliente e valor até 15 dias depois
      OUTER APPLY (
        SELECT TOP 1 N2.NF_NUMERO AS nota, N2.NF_FATURAMENTO AS registro, CONVERT(varchar(10), N2.MOVIMENTO, 23) AS dia,
               CASE WHEN NC.pedido IS NOT NULL THEN 'pedido' ELSE 'cliente_valor' END AS como,
               (SELECT SUM(ISNULL(X2.CREDITO, 0)) - SUM(ISNULL(X2.DEBITO, 0))
                  FROM TITULOS_RECEBER T2 WITH (NOLOCK)
                  JOIN TITULOS_RECEBER_TRANSACOES X2 WITH (NOLOCK) ON X2.TITULO_RECEBER = T2.TITULO_RECEBER
                 WHERE T2.TAB_MASTER_ORIGEM = ${TAB_NOTA_VENDA} AND T2.REG_MASTER_ORIGEM = N2.NF_FATURAMENTO) AS pendente
        FROM NF_FATURAMENTO N2 WITH (NOLOCK)
        LEFT JOIN NF_FATURAMENTO_TOTAIS NT2 WITH (NOLOCK) ON NT2.NF_FATURAMENTO = N2.NF_FATURAMENTO
        WHERE N2.NF_FATURAMENTO <> NC.id
          AND N2.EMPRESA = NC.empresa
          AND NOT EXISTS (SELECT 1 FROM CANCELAMENTOS_NOTAS_FISCAIS C2 WITH (NOLOCK)
                          WHERE C2.TIPO = 1 AND C2.CHAVE = N2.NF_FATURAMENTO)
          AND (
                (NC.pedido IS NOT NULL AND TRY_CAST(LTRIM(RTRIM(N2.PEDIDO_CLIENTE)) AS numeric(18, 0)) = NC.pedido)
             OR (NC.pedido IS NULL AND N2.ENTIDADE = NC.cod_cliente
                 AND ABS(ISNULL(NT2.TOTAL_GERAL, 0) - ISNULL(NT.TOTAL_GERAL, 0)) < 0.01
                 AND N2.MOVIMENTO >= CAST(NC.nota_dia AS date)
                 AND N2.MOVIMENTO < DATEADD(day, 16, CAST(NC.cancelado_em AS date)))
          )
        ORDER BY N2.MOVIMENTO DESC
      ) SUB
      WHERE TT.pendente > 0.009 OR TT.recebido_bruto - TT.estornado > 0.009
      ORDER BY TT.pendente + (TT.recebido_bruto - TT.estornado) DESC;

      -- [2] Onde cada recebimento foi baixado (só das notas que ficaram com recebimento)
      SELECT T.REG_MASTER_ORIGEM                              AS nota_id,
             LTRIM(RTRIM(T.TITULO))                           AS titulo,
             CONVERT(varchar(10), TX.DATA, 23)                AS dia,
             ISNULL(TX.DEBITO, 0)                             AS valor,
             TX.TAB_MASTER_ORIGEM                             AS tab,
             TX.REG_MASTER_ORIGEM                             AS registro,
             CASE WHEN TX.TAB_MASTER_ORIGEM = 668401 AND ISNULL(RB.FORM_ORIGEM, 0) = 456558 THEN 'Acerto de despacho (PIX, em Bancos por títulos)'
                  WHEN TX.TAB_MASTER_ORIGEM = 668401 THEN 'Bancos por títulos'
                  WHEN TX.TAB_MASTER_ORIGEM = 356928 THEN 'Caixa'
                  WHEN TX.TAB_MASTER_ORIGEM = 249008 THEN 'Cofre da loja'
                  WHEN TX.TAB_MASTER_ORIGEM = 455510 THEN 'Retorno de despacho'
                  ELSE CONCAT('Tela ', TX.TAB_MASTER_ORIGEM) END AS onde,
             CASE WHEN RB.FORM_ORIGEM = 456558 THEN RB.REG_ORIGEM ELSE DT.RECEBIMENTO_FATURAMENTO_DESPACHO END AS acerto,
             CONVERT(varchar(16), RB.DATA_HORA, 120) AS lancado_em,
             RB.CONTA_BANCARIA                                AS conta_bancaria,
             CASE COALESCE(RB.MODALIDADE, RC.MODALIDADE, DT.MODALIDADE, T.MODALIDADE)
               WHEN 0 THEN 'Carteira'  WHEN 1 THEN 'Boleto'   WHEN 2 THEN 'Depósito'
               WHEN 3 THEN 'Cheque'    WHEN 4 THEN 'Dinheiro' WHEN 5 THEN 'Débito em conta'
               WHEN 6 THEN 'Cartão crédito' WHEN 7 THEN 'Promissória' WHEN 8 THEN 'Vale'
               WHEN 9 THEN 'Devolução' WHEN 11 THEN 'PIX'     WHEN 12 THEN 'Cartão débito'
               WHEN 13 THEN 'Convênio' ELSE NULL END          AS forma,
             COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario,
             -- Cabeçalho do recebimento de Bancos, com os campos da consulta do PROCFIT
             RB.RECEBIMENTO_BANCO                             AS rb_recebimento,
             LTRIM(RTRIM(U.LOGIN))                            AS login,
             RB.EMPRESA                                       AS rb_empresa,
             CONVERT(varchar(10), RB.MOVIMENTO, 23)           AS rb_movimento,
             CONVERT(varchar(10), RB.DATA_RECEBIMENTO, 23)    AS rb_data_recebimento,
             T.ENTIDADE                                       AS titulo_entidade${rb.campos}
      FROM #TNC TT
      JOIN TITULOS_RECEBER T WITH (NOLOCK) ON T.TITULO_RECEBER = TT.TITULO_RECEBER
      JOIN TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK) ON TX.TITULO_RECEBER = TT.TITULO_RECEBER
      LEFT JOIN RECEBIMENTOS_BANCOS RB WITH (NOLOCK) ON TX.TAB_MASTER_ORIGEM = 668401 AND RB.RECEBIMENTO_BANCO = TX.REG_MASTER_ORIGEM
      LEFT JOIN RECEBIMENTOS_CAIXA RC WITH (NOLOCK) ON TX.TAB_MASTER_ORIGEM = 356928 AND RC.RECEBIMENTO_CAIXA = TX.REG_MASTER_ORIGEM
      LEFT JOIN COFRES_LOJAS_LANCAMENTOS CF WITH (NOLOCK) ON TX.TAB_MASTER_ORIGEM = 249008 AND CF.COFRE_LANCAMENTO = TX.REG_MASTER_ORIGEM
      LEFT JOIN RECEBIMENTOS_FATURAMENTO_DESPACHO_DETALHES DT WITH (NOLOCK)
        ON TX.TAB_MASTER_ORIGEM = 455510 AND DT.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE = TX.REG_MASTER_ORIGEM
      LEFT JOIN RECEBIMENTOS_FATURAMENTO_DESPACHO RD WITH (NOLOCK) ON RD.RECEBIMENTO_FATURAMENTO_DESPACHO = DT.RECEBIMENTO_FATURAMENTO_DESPACHO
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = COALESCE(RB.USUARIO_LOGADO, RC.USUARIO_LOGADO, CF.USUARIO_LOGADO, RD.USUARIO_LOGADO)
      ${rb.junta}
      WHERE TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
        AND TT.recebido - TT.estornado > 0.009
      ORDER BY T.REG_MASTER_ORIGEM, TX.DATA;

      -- [3] Quantas notas de cada tipo foram canceladas no período (para o resumo)
      SELECT (SELECT COUNT(*) FROM #DC) AS devolucoes_canceladas, (SELECT COUNT(*) FROM #NC) AS vendas_canceladas;
    `);
  return { devolucoes: recordsets[0], vendas: recordsets[1], baixas: recordsets[2], contagem: recordsets[3][0] ?? {} };
}

module.exports = { listar, TAB_NOTA_DEVOLUCAO };
