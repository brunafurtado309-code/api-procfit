// Módulo LOGÍSTICA: o que entrou, o que saiu, quanto sobra e quanto custa cada produto.
//
// De onde vem cada número (validado no banco em out/2026, produtos 150 e 1653):
//   Compra        NF_COMPRA + NF_COMPRA_PRODUTOS. QUANTIDADE_ESTOQUE já vem convertida para a
//                 unidade do estoque (ex.: 80 CX x 4 = 320 bandejas). O fornecedor é o da nota
//                 (NF_COMPRA_ENTIDADE): PRODUTOS_FORNECEDORES está incompleto e não é usado.
//                 Valor unitário = TOTAL_PRODUTO / QUANTIDADE_ESTOQUE (preço por unidade do
//                 estoque); CUSTO_UNITARIO vem zerado em parte das notas.
//   Venda         VENDAS_ANALITICAS, sem o tipo 20 (importação de demanda), mesma regra do
//                 painel de vendas. Cancelamentos e devoluções já entram descontando.
//   Estoque       ESTOQUE_LANCAMENTOS: saldo = soma(ESTOQUE_ENTRADA) - soma(ESTOQUE_SAIDA).
//                 A coluna ESTOQUE_SALDO vem vazia, por isso o saldo é calculado.
//                 Conferido: comprado nas notas = entrou no estoque e vendido = saiu, mês a mês.
//                 Local de estoque = empresa: o centro 3 é a empresa 3, e cada empresa tem um
//                 centro de AJUSTE (1000301 = empresa 3). Os dois somam no saldo da empresa.
//   Preço         PRODUTOS_VENDAS, uma linha por tabela de preço (1 = varejo, 4 = atacado),
//                 com o custo médio calculado pelo PROCFIT. PRODUTOS_PARAMETROS_EMPRESAS não é
//                 usado: a maioria das empresas está com preço zerado.
//   Histórico     LOG_PRODUTOS_VENDAS, gravado pelo gatilho TR_PRODUTOS_VENDAS_LOG (ligado).
//   de preço      Cada alteração grava um par na mesma hora: 'D' = como estava, 'A' = como
//                 ficou. Só conta como mudança quando o preço de venda é diferente entre os dois.
//                 O log começa em mai/2026 (carga inicial do sistema); antes disso não há histórico.
//                 APP_NAME começando com "PROCFIT" = alterado pelo sistema; qualquer outro
//                 (ex.: SQL Server Management Studio) = alterado direto no banco.
//                 USER_NAME pelo sistema é sempre "PROCFIT"; HOST_NAME (o computador) ajuda a
//                 saber quem foi. Em PRODUTOS_VENDAS, USUARIO_ALTERACAO é quem salvou por último,
//                 mas a rotina da madrugada regrava a linha com o nome do servidor (SQL-...).
//                 A margem do PROCFIT (MARGEM_BRUTA_PERCENTUAL) desconta encargos que variam por
//                 tabela; o painel mostra a conta simples: (preço - custo médio) / preço.
//
// O que o banco mostrou e a tela aponta como alerta:
//   - açaí (produto 150): vende sem dar entrada (a produção da indústria não entra no estoque),
//     saldo de -20 mil;
//   - morango (1653): compra 3 a 4 mil por mês e vende 150 a 190 por esse código.

const { sql, getPool } = require('../config/db');

const TABELA_VAREJO = 1;
const TABELA_ATACADO = 4;
const LIMITE_LISTA = 2000;

// Empresa do lançamento de estoque, a partir do centro (ver acima)
const EMPRESA_DO_CENTRO = `
  CASE WHEN EL.CENTRO_ESTOQUE > 1000000
       THEN (EL.CENTRO_ESTOQUE - 1000001) / 100
       ELSE EL.CENTRO_ESTOQUE END`;

// Mudanças reais de preço de venda (par D/A com valor diferente)
const MUDANCAS_DE_PRECO = `
  SELECT
    A.PRODUTO                                   AS produto,
    A.GRUPO_PRECO                               AS tabela,
    A.DATA_HORA_GRAVACAO_LOG                    AS quando,
    D.PRECO_VENDA                               AS antes,
    A.PRECO_VENDA                               AS depois,
    LTRIM(RTRIM(A.USER_NAME))                   AS usuario,
    LTRIM(RTRIM(A.HOST_NAME))                   AS computador,
    CASE WHEN A.APP_NAME LIKE 'PROCFIT%' THEN 0 ELSE 1 END AS fora_do_sistema
  FROM LOG_PRODUTOS_VENDAS A WITH (NOLOCK)
  JOIN LOG_PRODUTOS_VENDAS D WITH (NOLOCK)
    ON D.PRODUTO_VENDA = A.PRODUTO_VENDA
   AND D.DATA_HORA_GRAVACAO_LOG = A.DATA_HORA_GRAVACAO_LOG
   AND D.TIPO_LOG = 'D'
  WHERE A.TIPO_LOG = 'A'
    AND ISNULL(A.PRECO_VENDA, 0) <> ISNULL(D.PRECO_VENDA, 0)`;

// Alertas da lista (o filtro da tela usa as mesmas regras)
const ALERTAS = {
  NEGATIVO: 'saldo < 0',
  SOBRA: 'entrou > 0 AND entrou >= 2 * saiu',
  PRECO_ALTERADO: 'precos_alterados > 0',
  PRECO_FORA: 'precos_fora > 0',
};

function criarRequest(pool, filtros) {
  return pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null);
}

// Monta #LINHAS: uma linha por produto com movimento no período (compra, venda, estoque ou preço)
const MONTAR_LINHAS = `
  SET NOCOUNT ON;
  DECLARE @de date = CAST(@inicio AS date);
  DECLARE @ate date = DATEADD(day, 1, CAST(@fim AS date));

  IF OBJECT_ID('tempdb..#COMP') IS NOT NULL DROP TABLE #COMP;
  IF OBJECT_ID('tempdb..#ULT') IS NOT NULL DROP TABLE #ULT;
  IF OBJECT_ID('tempdb..#VEND') IS NOT NULL DROP TABLE #VEND;
  IF OBJECT_ID('tempdb..#EST') IS NOT NULL DROP TABLE #EST;
  IF OBJECT_ID('tempdb..#PRECO') IS NOT NULL DROP TABLE #PRECO;
  IF OBJECT_ID('tempdb..#MUD') IS NOT NULL DROP TABLE #MUD;
  IF OBJECT_ID('tempdb..#LINHAS') IS NOT NULL DROP TABLE #LINHAS;

  -- 1. Compras do período
  SELECT P.PRODUTO, SUM(P.QUANTIDADE_ESTOQUE) AS qtd, SUM(P.TOTAL_PRODUTO) AS valor
  INTO #COMP
  FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
  JOIN NF_COMPRA N WITH (NOLOCK) ON N.NF_COMPRA = P.NF_COMPRA
  WHERE N.MOVIMENTO >= @de AND N.MOVIMENTO < @ate
    AND (@empresa IS NULL OR N.EMPRESA = @empresa)
    AND P.PRODUTO IS NOT NULL
  GROUP BY P.PRODUTO;

  -- 2. Última compra de cada produto (de qualquer data): fornecedor e valor unitário
  SELECT X.PRODUTO, X.data, X.nota, X.cod_fornecedor, X.fornecedor, X.valor_unitario
  INTO #ULT
  FROM (
    SELECT
      P.PRODUTO,
      CONVERT(varchar(10), N.MOVIMENTO, 23)                     AS data,
      N.NF_NUMERO                                               AS nota,
      N.ENTIDADE                                                AS cod_fornecedor,
      LTRIM(RTRIM(NE.NOME))                                     AS fornecedor,
      P.TOTAL_PRODUTO / NULLIF(P.QUANTIDADE_ESTOQUE, 0)         AS valor_unitario,
      ROW_NUMBER() OVER (PARTITION BY P.PRODUTO ORDER BY N.MOVIMENTO DESC, N.NF_COMPRA DESC) AS ordem
    FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
    JOIN NF_COMPRA N WITH (NOLOCK) ON N.NF_COMPRA = P.NF_COMPRA
    LEFT JOIN NF_COMPRA_ENTIDADE NE WITH (NOLOCK) ON NE.NF_COMPRA = N.NF_COMPRA
    WHERE (@empresa IS NULL OR N.EMPRESA = @empresa)
      AND P.PRODUTO IS NOT NULL
  ) X
  WHERE X.ordem = 1;

  -- 3. Vendas do período
  SELECT VA.PRODUTO, SUM(VA.QUANTIDADE) AS qtd, SUM(VA.VENDA_LIQUIDA) AS valor
  INTO #VEND
  FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
  WHERE VA.MOVIMENTO >= @de AND VA.MOVIMENTO < @ate
    AND VA.DOCUMENTO_TIPO <> 20
    AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
  GROUP BY VA.PRODUTO;

  -- 4. Estoque: saldo de hoje e o que entrou e saiu no período
  SELECT
    EL.PRODUTO,
    SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0) - ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saldo,
    SUM(CASE WHEN EL.DATA >= @de AND EL.DATA < @ate THEN ISNULL(EL.ESTOQUE_ENTRADA, 0) ELSE 0 END) AS entrou,
    SUM(CASE WHEN EL.DATA >= @de AND EL.DATA < @ate THEN ISNULL(EL.ESTOQUE_SAIDA, 0) ELSE 0 END)   AS saiu
  INTO #EST
  FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
  WHERE (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa)
  GROUP BY EL.PRODUTO;

  -- 5. Preço de venda atual (varejo e atacado) e custo médio
  SELECT
    PRODUTO,
    MAX(CASE WHEN GRUPO_PRECO = ${TABELA_VAREJO} THEN PRECO_VENDA END)  AS varejo,
    MAX(CASE WHEN GRUPO_PRECO = ${TABELA_ATACADO} THEN PRECO_VENDA END) AS atacado,
    MAX(CUSTO_MEDIO)                                                    AS custo_medio
  INTO #PRECO
  FROM PRODUTOS_VENDAS WITH (NOLOCK)
  GROUP BY PRODUTO;

  -- 6. Mudanças de preço no período
  SELECT M.produto, COUNT(*) AS alterados, SUM(M.fora_do_sistema) AS fora, MAX(M.quando) AS ultima
  INTO #MUD
  FROM (${MUDANCAS_DE_PRECO}) M
  WHERE M.quando >= @de AND M.quando < @ate
  GROUP BY M.produto;

  -- 7. Uma linha por produto com algum movimento no período
  SELECT
    PR.PRODUTO                                        AS produto,
    LTRIM(RTRIM(PR.DESCRICAO))                        AS descricao,
    ISNULL(C.qtd, 0)                                  AS comprado,
    ISNULL(C.valor, 0)                                AS valor_comprado,
    ISNULL(E.entrou, 0)                               AS entrou,
    ISNULL(V.qtd, 0)                                  AS vendido,
    ISNULL(V.valor, 0)                                AS valor_vendido,
    ISNULL(E.saiu, 0)                                 AS saiu,
    ISNULL(E.saldo, 0)                                AS saldo,
    U.data                                            AS ultima_compra,
    U.nota                                            AS ultima_nota,
    U.cod_fornecedor,
    U.fornecedor,
    U.valor_unitario,
    PC.custo_medio,
    PC.varejo,
    PC.atacado,
    ISNULL(MU.alterados, 0)                           AS precos_alterados,
    ISNULL(MU.fora, 0)                                AS precos_fora,
    MU.ultima                                         AS ultima_alteracao
  INTO #LINHAS
  FROM (
    SELECT PRODUTO FROM #COMP
    UNION SELECT PRODUTO FROM #VEND
    UNION SELECT PRODUTO FROM #EST WHERE entrou <> 0 OR saiu <> 0
    UNION SELECT produto FROM #MUD
  ) ATIVOS
  JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = ATIVOS.PRODUTO
  LEFT JOIN #COMP  C  ON C.PRODUTO  = PR.PRODUTO
  LEFT JOIN #VEND  V  ON V.PRODUTO  = PR.PRODUTO
  LEFT JOIN #EST   E  ON E.PRODUTO  = PR.PRODUTO
  LEFT JOIN #ULT   U  ON U.PRODUTO  = PR.PRODUTO
  LEFT JOIN #PRECO PC ON PC.PRODUTO = PR.PRODUTO
  LEFT JOIN #MUD   MU ON MU.produto = PR.PRODUTO
  WHERE @busca IS NULL
     OR CAST(PR.PRODUTO AS varchar(20)) = @busca
     OR PR.DESCRICAO LIKE '%' + @busca + '%'
     OR U.fornecedor LIKE '%' + @busca + '%';`;

// Lista do período: resumo (com a contagem de cada alerta) e as linhas do alerta escolhido
async function painel(filtros) {
  const pool = await getPool();
  const alerta = ALERTAS[filtros.alerta] ?? '1 = 1';
  const { recordsets } = await criarRequest(pool, filtros).query(`
    ${MONTAR_LINHAS}

    SELECT
      COUNT(*)                                                      AS produtos,
      SUM(valor_comprado)                                           AS valor_comprado,
      SUM(valor_vendido)                                            AS valor_vendido,
      SUM(CASE WHEN ${ALERTAS.NEGATIVO} THEN 1 ELSE 0 END)          AS negativos,
      SUM(CASE WHEN ${ALERTAS.SOBRA} THEN 1 ELSE 0 END)             AS sobras,
      SUM(CASE WHEN ${ALERTAS.PRECO_ALTERADO} THEN 1 ELSE 0 END)    AS precos_alterados,
      SUM(CASE WHEN ${ALERTAS.PRECO_FORA} THEN 1 ELSE 0 END)        AS precos_fora
    FROM #LINHAS;

    SELECT TOP (${LIMITE_LISTA}) *,
      CONVERT(varchar(19), ultima_alteracao, 120) AS ultima_alteracao_texto
    FROM #LINHAS
    WHERE ${alerta}
    ORDER BY valor_vendido DESC, comprado DESC, produto;
  `);
  const [resumo, lista] = recordsets;
  return { resumo: resumo[0] ?? {}, lista };
}

// Ficha de um produto: preço atual, histórico de preço, compras, estoque por empresa e meses
async function produto(codigo, filtros) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('produto', sql.Int, codigo)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .query(`
      SET NOCOUNT ON;

      -- 1. O produto
      SELECT PRODUTO AS produto, LTRIM(RTRIM(DESCRICAO)) AS descricao
      FROM PRODUTOS WITH (NOLOCK)
      WHERE PRODUTO = @produto;

      -- 2. Preço de venda atual por tabela, com quem atualizou por último
      SELECT
        PV.GRUPO_PRECO                                         AS tabela,
        PV.PRECO_VENDA                                         AS preco,
        PV.CUSTO_MEDIO                                         AS custo_medio,
        CONVERT(varchar(19), PV.DATA_HORA_ATUALIZACAO_PRECO, 120) AS atualizado_em,
        LTRIM(RTRIM(PV.USUARIO_ALTERACAO))                     AS atualizado_por
      FROM PRODUTOS_VENDAS PV WITH (NOLOCK)
      WHERE PV.PRODUTO = @produto
      ORDER BY PV.GRUPO_PRECO;

      -- 3. Histórico de preço de venda (mudanças reais, desde o início do log)
      SELECT TOP 200
        M.tabela,
        CONVERT(varchar(19), M.quando, 120) AS quando,
        M.antes, M.depois, M.usuario, M.computador, M.fora_do_sistema
      FROM (${MUDANCAS_DE_PRECO}) M
      WHERE M.produto = @produto
      ORDER BY M.quando DESC;

      -- 4. Compras, nota a nota
      SELECT TOP 100
        CONVERT(varchar(10), N.MOVIMENTO, 23)                AS data,
        N.EMPRESA                                            AS empresa,
        N.NF_NUMERO                                          AS nota,
        N.ENTIDADE                                           AS cod_fornecedor,
        LTRIM(RTRIM(NE.NOME))                                AS fornecedor,
        LTRIM(RTRIM(P.UNIDADE_MEDIDA))                       AS unidade,
        P.QUANTIDADE                                         AS quantidade,
        P.QUANTIDADE_EMBALAGEM                               AS embalagem,
        P.QUANTIDADE_ESTOQUE                                 AS quantidade_estoque,
        P.VALOR_UNITARIO                                     AS valor_nota,
        P.TOTAL_PRODUTO / NULLIF(P.QUANTIDADE_ESTOQUE, 0)    AS valor_unitario,
        P.TOTAL_PRODUTO                                      AS total
      FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
      JOIN NF_COMPRA N WITH (NOLOCK) ON N.NF_COMPRA = P.NF_COMPRA
      LEFT JOIN NF_COMPRA_ENTIDADE NE WITH (NOLOCK) ON NE.NF_COMPRA = N.NF_COMPRA
      WHERE P.PRODUTO = @produto
        AND (@empresa IS NULL OR N.EMPRESA = @empresa)
      ORDER BY N.MOVIMENTO DESC, N.NF_COMPRA DESC;

      -- 5. Saldo de estoque por empresa
      SELECT
        X.empresa,
        LTRIM(RTRIM(EU.NOME_FANTASIA)) AS nome,
        X.entradas, X.saidas, X.entradas - X.saidas AS saldo
      FROM (
        SELECT ${EMPRESA_DO_CENTRO} AS empresa,
               SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0)) AS entradas,
               SUM(ISNULL(EL.ESTOQUE_SAIDA, 0))   AS saidas
        FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
        WHERE EL.PRODUTO = @produto
        GROUP BY ${EMPRESA_DO_CENTRO}
      ) X
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = X.empresa
      WHERE @empresa IS NULL OR X.empresa = @empresa
      ORDER BY X.empresa;

      -- 6. Mês a mês: comprado, entrou, vendido e saiu
      WITH COMPRAS AS (
        SELECT CONVERT(varchar(7), N.MOVIMENTO, 120) AS mes, SUM(P.QUANTIDADE_ESTOQUE) AS qtd
        FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
        JOIN NF_COMPRA N WITH (NOLOCK) ON N.NF_COMPRA = P.NF_COMPRA
        WHERE P.PRODUTO = @produto AND (@empresa IS NULL OR N.EMPRESA = @empresa)
        GROUP BY CONVERT(varchar(7), N.MOVIMENTO, 120)
      ),
      VENDAS AS (
        SELECT CONVERT(varchar(7), VA.MOVIMENTO, 120) AS mes, SUM(VA.QUANTIDADE) AS qtd
        FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
        WHERE VA.PRODUTO = @produto AND VA.DOCUMENTO_TIPO <> 20
          AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
        GROUP BY CONVERT(varchar(7), VA.MOVIMENTO, 120)
      ),
      ESTOQUE AS (
        SELECT CONVERT(varchar(7), EL.DATA, 120) AS mes,
               SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0)) AS entrou,
               SUM(ISNULL(EL.ESTOQUE_SAIDA, 0))   AS saiu
        FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
        WHERE EL.PRODUTO = @produto
          AND (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa)
        GROUP BY CONVERT(varchar(7), EL.DATA, 120)
      ),
      MESES AS (
        SELECT mes FROM COMPRAS UNION SELECT mes FROM VENDAS UNION SELECT mes FROM ESTOQUE
      )
      SELECT TOP 12
        M.mes,
        ISNULL(C.qtd, 0)     AS comprado,
        ISNULL(E.entrou, 0)  AS entrou,
        ISNULL(V.qtd, 0)     AS vendido,
        ISNULL(E.saiu, 0)    AS saiu
      FROM MESES M
      LEFT JOIN COMPRAS C ON C.mes = M.mes
      LEFT JOIN VENDAS  V ON V.mes = M.mes
      LEFT JOIN ESTOQUE E ON E.mes = M.mes
      ORDER BY M.mes DESC;
    `);
  const [cadastro, precos, historico, compras, estoque, meses] = recordsets;
  return { produto: cadastro[0] ?? null, precos, historico, compras, estoque, meses };
}

// Empresas que têm estoque ou vendas (para o filtro da tela)
async function empresas() {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT EU.EMPRESA_USUARIA AS empresa, LTRIM(RTRIM(EU.NOME_FANTASIA)) AS nome
    FROM EMPRESAS_USUARIAS EU WITH (NOLOCK)
    ORDER BY EU.EMPRESA_USUARIA;
  `);
  return recordset;
}

module.exports = { ALERTAS, TABELA_VAREJO, TABELA_ATACADO, painel, produto, empresas };
