// Painel da Precificação — aba ANÁLISE: os dados brutos que a análise usa.
// Aqui só tem leitura do PROCFIT; todas as contas (margem, curva ABC, decisões) ficam no service.
//
// Uma consulta só, com cinco resultados, lida de uma vez e guardada por alguns minutos no service:
//   1. Hoje           a data do banco (a mesma régua de "hoje" das outras telas)
//   2. Venda por dia  uma linha por produto e por dia, desde 1º de janeiro do ano passado
//                     (assim dá para comparar mês com mês e ano com ano).
//                     Mesmas regras do painel de vendas (vendas.repository.js):
//                       - sem o tipo 20 (importação de demanda, não é venda);
//                       - cancelamentos e devoluções entram negativos e já descontam;
//                       - custo = QUANTIDADE x CUSTO_MEDIO_PRODUTOS_VENDAS, só nas linhas que têm
//                         custo (PDV). Nas vendas por nota ele vem vazio: por isso guardamos a parte
//                         da venda que tem custo (qc, vc) separada do total (q, v), e a margem é
//                         calculada só sobre ela.
//                       - imposto = IMPOSTOS, preenchido em toda venda (caixa e nota). Conferido em
//                         nov/2026: é ICMS 20% + PIS 1,65% + COFINS 7,6% = 29,25% nos tributados, e zero
//                         nos isentos e nos produtos da fábrica. Guardado também só da parte com custo (ic).
//                         MARGEM_BRUTA e LUCRO_BRUTO da venda NÃO servem: copiam a margem da tabela de
//                         varejo, não a do que foi vendido.
//   3. Produtos       cadastro, preço de varejo (tabela 1) e custo médio do PROCFIT
//                     (PRODUTOS_VENDAS, mesma regra da Logística), e o saldo de estoque
//                     (ESTOQUE_LANCAMENTOS: entradas - saídas, a coluna de saldo vem vazia).
//   4. Mudanças de    LOG_PRODUTOS_VENDAS, tabelas de varejo (1) e atacado (4), com o preço de antes e o
//      preço          de depois (mesma consulta da Logística). O log começa em mai/2026.
//                     As decisões da aba usam só o varejo; a lista e a janela do produto mostram as duas.
//   5. Custo real     o que foi PAGO nas compras dos últimos DIAS_CUSTO_REAL dias, dividido pelas
//                     unidades compradas + as bonificadas. Item a item, pelo CFOP (nunca pelo texto
//                     da nota, que engana: a Carino 200363 é "VENDA/BONIF" com itens das duas coisas):
//                       final 910                          = bonificação (unidade grátis);
//                       final 101, 102, 401, 403, 404, 405 = compra (o resto, como transferência e
//                                                            devolução, fica fora).
//                     Por quê: o PROCFIT põe a bonificação no custo médio PELO VALOR DA NOTA. Conferido
//                     no Cerelis 1kg (411): 840 unidades bonificadas em 120 dias e o custo médio
//                     continuou R$ 21,25; pago ÷ recebido dá R$ 16,95.
//                     Valor = TOTAL_PRODUTO, a mesma base do custo médio do PROCFIT (no Cerelis,
//                     21,25 = TOTAL_PRODUTO ÷ QUANTIDADE_ESTOQUE). Conta as notas ainda sem entrada no
//                     estoque também: a mercadoria já chegou e já foi (ou será) paga.
//
// Nomes curtos nas colunas da venda por dia (p, d, q...) porque são muitas linhas.

const { getPool } = require('../config/db');
const { MUDANCAS_DE_PRECO, TABELA_VAREJO, TABELA_ATACADO } = require('./logistica.repository');

const DIAS_CUSTO_REAL = 120;
// Últimos 3 números do CFOP do item, sem ponto ("6.910" e "6910" viram "910")
const FINAL_CFOP = "RIGHT(REPLACE(ISNULL(P.CFOP, ''), '.', ''), 3)";
const CFOP_BONIFICACAO = "('910')";
const CFOP_COMPRA = "('101', '102', '401', '403', '404', '405')";

async function base() {
  const pool = await getPool();
  const { recordsets } = await pool.request().query(`
    SET NOCOUNT ON;
    DECLARE @hoje date = CAST(GETDATE() AS date);
    DECLARE @desde date = DATEFROMPARTS(YEAR(@hoje) - 1, 1, 1);

    -- 1. Hoje
    SELECT CONVERT(varchar(10), @hoje, 23) AS hoje;

    -- 2. Venda por produto e por dia
    SELECT
      VA.PRODUTO                                         AS p,
      CONVERT(varchar(10), CAST(VA.MOVIMENTO AS date), 23) AS d,
      SUM(VA.QUANTIDADE)                                 AS q,
      SUM(VA.VENDA_LIQUIDA)                              AS v,
      SUM(CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0 THEN VA.QUANTIDADE END)    AS qc,
      SUM(CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0 THEN VA.VENDA_LIQUIDA END) AS vc,
      SUM(CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0
               THEN VA.QUANTIDADE * VA.CUSTO_MEDIO_PRODUTOS_VENDAS END)          AS c,
      SUM(ISNULL(VA.IMPOSTOS, 0))                                                AS i,
      SUM(CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0 THEN ISNULL(VA.IMPOSTOS, 0) END) AS ic
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    WHERE VA.MOVIMENTO >= @desde
      AND VA.MOVIMENTO < DATEADD(day, 1, @hoje)
      AND ISNULL(VA.DOCUMENTO_TIPO, 0) <> 20
      AND VA.PRODUTO IS NOT NULL
    GROUP BY VA.PRODUTO, CAST(VA.MOVIMENTO AS date);

    -- 3. Produtos: cadastro, preço de varejo, custo médio e saldo de estoque
    WITH PRECOS AS (
      SELECT
        PRODUTO,
        MAX(CASE WHEN GRUPO_PRECO = ${TABELA_VAREJO} THEN PRECO_VENDA END) AS varejo,
        MAX(CUSTO_MEDIO)                                                  AS custo_medio
      FROM PRODUTOS_VENDAS WITH (NOLOCK)
      GROUP BY PRODUTO
    ),
    SALDOS AS (
      SELECT EL.PRODUTO, SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0) - ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saldo
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      GROUP BY EL.PRODUTO
    )
    SELECT
      PR.PRODUTO                                           AS codigo,
      LTRIM(RTRIM(PR.DESCRICAO))                           AS descricao,
      LTRIM(RTRIM(PR.UNIDADE_MEDIDA))                      AS unidade,
      CASE WHEN PR.INDUSTRIALIZADO = 'S' THEN 1 ELSE 0 END AS industrializado,
      CASE WHEN PR.INSUMO = 'S' THEN 1 ELSE 0 END          AS insumo,
      PC.varejo,
      PC.custo_medio,
      S.saldo
    FROM PRODUTOS PR WITH (NOLOCK)
    LEFT JOIN PRECOS PC ON PC.PRODUTO = PR.PRODUTO
    LEFT JOIN SALDOS S  ON S.PRODUTO  = PR.PRODUTO;

    -- 4. Mudanças do preço de varejo e de atacado, da mais antiga para a mais nova
    SELECT
      M.produto,
      M.tabela,
      CONVERT(varchar(16), M.quando, 120) AS quando,
      M.antes,
      M.depois,
      M.quem,
      M.fora_do_sistema
    FROM (${MUDANCAS_DE_PRECO}) M
    WHERE M.tabela IN (${TABELA_VAREJO}, ${TABELA_ATACADO})
      AND M.quando >= @desde
    ORDER BY M.produto, M.quando;

    -- 5. Custo real: pago nas compras ÷ (unidades compradas + bonificadas)
    SELECT
      P.PRODUTO                                                                         AS produto,
      SUM(CASE WHEN ${FINAL_CFOP} IN ${CFOP_COMPRA} THEN P.TOTAL_PRODUTO ELSE 0 END)       AS pago,
      SUM(CASE WHEN ${FINAL_CFOP} IN ${CFOP_COMPRA} THEN P.QUANTIDADE_ESTOQUE ELSE 0 END)  AS comprado,
      SUM(CASE WHEN ${FINAL_CFOP} IN ${CFOP_BONIFICACAO} THEN P.QUANTIDADE_ESTOQUE ELSE 0 END) AS bonificado,
      SUM(CASE WHEN ${FINAL_CFOP} IN ${CFOP_BONIFICACAO} THEN P.TOTAL_PRODUTO ELSE 0 END)  AS valor_bonificado
    FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
    JOIN NF_COMPRA N WITH (NOLOCK) ON N.NF_COMPRA = P.NF_COMPRA
    WHERE N.EMISSAO >= DATEADD(day, -${DIAS_CUSTO_REAL}, @hoje)
      AND P.PRODUTO IS NOT NULL
      AND P.QUANTIDADE_ESTOQUE > 0
      AND ${FINAL_CFOP} IN ('910', '101', '102', '401', '403', '404', '405')
    GROUP BY P.PRODUTO;
  `);
  const [[{ hoje }], vendas, produtos, mudancas, custosReais] = recordsets;
  return { hoje, vendas, produtos, mudancas, custosReais };
}

module.exports = { base, DIAS_CUSTO_REAL };
