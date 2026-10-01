/* =====================================================================
   TÍTULOS PARA A CONCILIAÇÃO  (usado pela rota /conciliacao/titulos)

   Segue as mesmas regras do financeiro.repository.js (validadas em set/2026):
   - Um título é UMA PARCELA; TITULO vem como "nota/parcela" (ex.: 10302/1).
   - Saldo pelo extrato TITULOS_RECEBER_TRANSACOES: CREDITO aumenta a dívida,
     DEBITO diminui. Recebido = DEBITO da transação 12. Cancelamento = 13.
   - Nota fiscal só quando TAB_MASTER_ORIGEM = 753289 (NF_FATURAMENTO).
   - Adquirente (maquininha) vem do cadastro ADQUIRENTES.

   Parâmetros enviados pela API:
     @inicio = primeiro dia do mês escolhido
     @fim    = primeiro dia do mês seguinte

   Entram no mês:
     - títulos com vencimento no mês
     - títulos de outros meses recebidos no mês
     - títulos vencidos antes do mês e ainda em aberto
   Ficam de fora: títulos cancelados (transação 13).

   {{CPF_CNPJ}} é trocado pela API pela coluna de documento do cadastro
   ENTIDADES (ela procura sozinha qual é a coluna).
   ===================================================================== */

WITH SALDOS AS (
  SELECT
    TX.TITULO_RECEBER,
    SUM(ISNULL(TX.CREDITO, 0)) - SUM(ISNULL(TX.DEBITO, 0))                                   AS PENDENTE,
    SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)         AS RECEBIDO,
    MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN TX.DATA END)                             AS ULTIMO_RECEBIMENTO,
    COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 THEN 1 END)                                 AS QTD_CANCELAMENTOS
  FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
  GROUP BY TX.TITULO_RECEBER
)
SELECT
  T.TITULO_RECEBER                                                     AS id_titulo,
  COALESCE(NULLIF(T.PEDIDO_PREVENDA, 0), NULLIF(NF.PEDIDO_CLIENTE, 0)) AS pedido,
  NF.NF_NUMERO                                                         AS nota_fiscal,
  CASE WHEN CHARINDEX('/', T.TITULO) > 0
       THEN LTRIM(RTRIM(SUBSTRING(T.TITULO, CHARINDEX('/', T.TITULO) + 1, 20)))
       ELSE '1' END                                                    AS parcela,
  LTRIM(RTRIM(T.TITULO))                                               AS titulo,
  T.ENTIDADE                                                           AS cod_cliente,
  LTRIM(RTRIM(E.NOME))                                                 AS nome_cliente,
  {{CPF_CNPJ}}                                                         AS cpf_cnpj,
  T.VENCIMENTO                                                         AS vencimento,
  T.VALOR                                                              AS valor,
  S.RECEBIDO                                                           AS valor_pago,
  CASE WHEN S.PENDENTE < 0 THEN 0 ELSE S.PENDENTE END                  AS pendente,
  S.ULTIMO_RECEBIMENTO                                                 AS data_pagamento,
  -- Dinheiro não cai no extrato título a título (vai em depósito): fica fora do confronto com o banco
  CASE WHEN T.MODALIDADE = 4 THEN 'Caixa interno' ELSE NULL END        AS conta_caixa,
  CASE
    WHEN ADQ.ADQUIRENTE_ID IS NOT NULL THEN CONCAT('Cartão - ', ADQ.DESCRICAO)
    ELSE CASE T.MODALIDADE
      WHEN 0  THEN 'Carteira'        WHEN 1  THEN 'Boleto'
      WHEN 2  THEN 'Depósito'        WHEN 3  THEN 'Cheque'
      WHEN 4  THEN 'Dinheiro'        WHEN 5  THEN 'Débito em conta'
      WHEN 6  THEN 'Cartão crédito'  WHEN 7  THEN 'Promissória'
      WHEN 8  THEN 'Vale'            WHEN 9  THEN 'Devolução'
      WHEN 11 THEN 'PIX'             WHEN 12 THEN 'Cartão débito'
      WHEN 13 THEN 'Convênio'
      ELSE CASE WHEN T.MODALIDADE IS NULL THEN NULL ELSE CONCAT('Modalidade ', T.MODALIDADE) END
    END
  END                                                                  AS forma_pagamento,
  CAST(NULL AS varchar(30))                                            AS nosso_numero,
  CAST(NULL AS varchar(30))                                            AS nsu,
  -- "Faturado" = nasceu de nota fiscal ou de acerto de despacho (notas entregues).
  -- Só conta como "pedido sem nota" o título que tem pedido e não tem nota.
  CASE
    WHEN T.TAB_MASTER_ORIGEM IN (753289, 455510)    THEN 1
    WHEN NULLIF(T.PEDIDO_PREVENDA, 0) IS NOT NULL   THEN 0
    ELSE 1
  END                                                                  AS faturado,
  CASE
    WHEN T.TAB_MASTER_ORIGEM = 753289      THEN 'Nota fiscal'
    WHEN ADQ.ADQUIRENTE_ID IS NOT NULL     THEN 'Recebível de cartão'
    WHEN T.TAB_MASTER_ORIGEM = 757539      THEN 'Recebível de cartão (conciliação)'
    WHEN T.TAB_MASTER_ORIGEM = 455510      THEN 'Gerado no acerto de despacho'
    WHEN T.TAB_MASTER_ORIGEM = 999999      THEN 'Carga inicial (sistema antigo)'
    WHEN T.TAB_MASTER_ORIGEM IS NULL       THEN 'Sem origem registrada'
    ELSE CONCAT('Lançado sem nota (tela ', T.TAB_MASTER_ORIGEM, ')')
  END                                                                  AS origem,
  T.EMPRESA                                                            AS empresa
FROM TITULOS_RECEBER T WITH (NOLOCK)
JOIN SALDOS S ON S.TITULO_RECEBER = T.TITULO_RECEBER
-- Só quando a origem é a nota fiscal; senão o REG_MASTER_ORIGEM aponta para outra tabela
LEFT JOIN NF_FATURAMENTO NF WITH (NOLOCK)
       ON T.TAB_MASTER_ORIGEM = 753289
      AND NF.NF_FATURAMENTO = T.REG_MASTER_ORIGEM
LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
-- A entidade do título é uma adquirente cadastrada?
OUTER APPLY (
  SELECT TOP 1 A.ADQUIRENTE_ID, A.DESCRICAO
  FROM ADQUIRENTES A WITH (NOLOCK)
  WHERE A.ENTIDADE = T.ENTIDADE AND A.ENTIDADE > 1
) ADQ
WHERE S.QTD_CANCELAMENTOS = 0
  AND (
       (T.VENCIMENTO >= @inicio AND T.VENCIMENTO < @fim)
    OR (S.ULTIMO_RECEBIMENTO >= @inicio AND S.ULTIMO_RECEBIMENTO < @fim)
    OR (T.VENCIMENTO < @inicio AND S.PENDENTE > 0.009)
  )
ORDER BY nome_cliente, pedido, T.TITULO;
