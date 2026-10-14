// Módulo ENTRADAS E SAÍDAS: o que entrou e saiu do estoque, só em quantidade (sem valores).
// Feito para quem cuida do estoque e não pode ver preço nem custo.
//
// Fonte: ESTOQUE_LANCAMENTOS (mesmas regras validadas em logistica.repository.js):
//   saldo = soma(ESTOQUE_ENTRADA) - soma(ESTOQUE_SAIDA); empresa a partir do centro de estoque.
// Tipo do movimento (validado em out/2026, 90 dias): o nome vem de TIPO_MOVIMENTO junto com a tela
// de origem (TAB_MASTER_ORIGEM). O banco não tem o cadastro com o nome das telas, por isso a
// lista abaixo foi montada a partir do que conferimos:
//   41     nota de compra (NF_COMPRA): tipo 2 = compra, conferido nota a nota no morango
//   753289 nota fiscal de saída: tipo 1 = venda por nota; tipos 3 e 5 = outras saídas por nota
//   601979 caixa (PDV): saída = venda no caixa; entrada (tipo 9) = devolução no caixa
//   o resto (poucos lançamentos) aparece como "Outra entrada/saída" com o número do tipo.
// Quem lançou a nota de compra: NF_COMPRA.USUARIO_LOGADO e DATA_HORA; o lançamento de estoque
// aponta a nota em REG_MASTER_ORIGEM (TAB_MASTER_ORIGEM 41). Se não achar por aí, procura pelo
// número da nota (DOCUMENTO) e o fornecedor (ENTIDADE).

const { sql, getPool } = require('../config/db');
const { EMPRESA_DO_CENTRO } = require('./logistica.repository');

const TAB_NOTA_COMPRA = 41;
const LIMITE_LISTA = 3000;
const LIMITE_MOVIMENTOS = 500;

function criarRequest(pool, filtros) {
  return pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null);
}

const PERIODO = `
  DECLARE @de date = CAST(@inicio AS date);
  DECLARE @ate date = DATEADD(day, 1, CAST(@fim AS date));`;

// Resumo por produto: entrou e saiu no período, saldo de hoje
async function produtos(filtros) {
  const pool = await getPool();
  const { recordsets } = await criarRequest(pool, filtros).query(`
    SET NOCOUNT ON;
    ${PERIODO}
    IF OBJECT_ID('tempdb..#MOV') IS NOT NULL DROP TABLE #MOV;

    SELECT
      EL.PRODUTO,
      SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0) - ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saldo,
      SUM(CASE WHEN EL.DATA >= @de AND EL.DATA < @ate THEN ISNULL(EL.ESTOQUE_ENTRADA, 0) ELSE 0 END) AS entrou,
      SUM(CASE WHEN EL.DATA >= @de AND EL.DATA < @ate THEN ISNULL(EL.ESTOQUE_SAIDA, 0) ELSE 0 END)   AS saiu,
      SUM(CASE WHEN EL.DATA >= @de AND EL.DATA < @ate THEN 1 ELSE 0 END)                            AS movimentos,
      MAX(CASE WHEN EL.DATA >= @de AND EL.DATA < @ate THEN EL.DATA_HORA END)                         AS ultimo
    INTO #MOV
    FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
    WHERE (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa)
    GROUP BY EL.PRODUTO;

    SELECT
      COUNT(*)     AS produtos,
      SUM(entrou)  AS entrou,
      SUM(saiu)    AS saiu,
      SUM(CASE WHEN saldo < 0 THEN 1 ELSE 0 END) AS negativos
    FROM #MOV M
    JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = M.PRODUTO
    WHERE M.movimentos > 0
      AND (@busca IS NULL OR CAST(PR.PRODUTO AS varchar(20)) = @busca OR PR.DESCRICAO LIKE '%' + @busca + '%');

    SELECT TOP (${LIMITE_LISTA})
      PR.PRODUTO                                 AS produto,
      LTRIM(RTRIM(PR.DESCRICAO))                 AS descricao,
      M.entrou, M.saiu, M.saldo, M.movimentos,
      CONVERT(varchar(19), M.ultimo, 120)        AS ultimo
    FROM #MOV M
    JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = M.PRODUTO
    WHERE M.movimentos > 0
      AND (@busca IS NULL OR CAST(PR.PRODUTO AS varchar(20)) = @busca OR PR.DESCRICAO LIKE '%' + @busca + '%')
    ORDER BY M.saiu + M.entrou DESC, PR.PRODUTO;
  `);
  const [resumo, lista] = recordsets;
  return { resumo: resumo[0] ?? {}, lista };
}

// Ficha de um produto no período: cada ENTRADA em detalhe (com quem lançou a nota de compra)
// e as SAÍDAS só somadas por tipo, porque as vendas viram centenas de linhas.
async function movimentos(codigo, filtros) {
  const pool = await getPool();
  const { recordsets } = await criarRequest(pool, filtros)
    .input('produto', sql.Int, codigo)
    .query(`
      SET NOCOUNT ON;
      ${PERIODO}

      SELECT PRODUTO AS produto, LTRIM(RTRIM(DESCRICAO)) AS descricao
      FROM PRODUTOS WITH (NOLOCK)
      WHERE PRODUTO = @produto;

      SELECT TOP (${LIMITE_MOVIMENTOS})
        CONVERT(varchar(19), EL.DATA_HORA, 120)          AS quando,
        ${EMPRESA_DO_CENTRO}                             AS empresa,
        LTRIM(RTRIM(EU.NOME_FANTASIA))                   AS nome_empresa,
        EL.TIPO_MOVIMENTO                                AS tipo,
        EL.TAB_MASTER_ORIGEM                             AS origem,
        ISNULL(EL.ESTOQUE_ENTRADA, 0)                    AS entrada,
        NULLIF(EL.DOCUMENTO, 0)                          AS documento,
        LTRIM(RTRIM(E.NOME))                             AS entidade,
        NC.NF_NUMERO                                     AS nota_compra,
        CONVERT(varchar(19), NC.DATA_HORA, 120)          AS nota_lancada_em,
        CONVERT(varchar(19), NC.DATA_PROCESSAMENTO, 120) AS nota_processada_em,
        COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS nota_lancada_por
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = ${EMPRESA_DO_CENTRO}
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = EL.ENTIDADE
      OUTER APPLY (
        SELECT TOP 1 N.NF_NUMERO, N.DATA_HORA, N.DATA_PROCESSAMENTO, N.USUARIO_LOGADO
        FROM NF_COMPRA N WITH (NOLOCK)
        WHERE EL.TAB_MASTER_ORIGEM = ${TAB_NOTA_COMPRA}
          AND (N.NF_COMPRA = EL.REG_MASTER_ORIGEM
               OR (N.NF_NUMERO = EL.DOCUMENTO AND N.ENTIDADE = EL.ENTIDADE))
        ORDER BY CASE WHEN N.NF_COMPRA = EL.REG_MASTER_ORIGEM THEN 0 ELSE 1 END, N.NF_COMPRA DESC
      ) NC
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = NC.USUARIO_LOGADO
      WHERE EL.PRODUTO = @produto
        AND EL.DATA >= @de AND EL.DATA < @ate
        AND ISNULL(EL.ESTOQUE_ENTRADA, 0) > 0
        AND (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa)
      ORDER BY EL.DATA_HORA DESC, EL.ESTOQUE DESC;

      SELECT
        EL.TIPO_MOVIMENTO                AS tipo,
        EL.TAB_MASTER_ORIGEM             AS origem,
        SUM(ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saida,
        COUNT(*)                         AS lancamentos,
        CONVERT(varchar(19), MAX(EL.DATA_HORA), 120) AS ultima
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      WHERE EL.PRODUTO = @produto
        AND EL.DATA >= @de AND EL.DATA < @ate
        AND ISNULL(EL.ESTOQUE_SAIDA, 0) > 0
        AND (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa)
      GROUP BY EL.TIPO_MOVIMENTO, EL.TAB_MASTER_ORIGEM
      ORDER BY SUM(ISNULL(EL.ESTOQUE_SAIDA, 0)) DESC;

      SELECT X.empresa, LTRIM(RTRIM(EU.NOME_FANTASIA)) AS nome, X.saldo
      FROM (
        SELECT ${EMPRESA_DO_CENTRO} AS empresa,
               SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0) - ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saldo
        FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
        WHERE EL.PRODUTO = @produto
        GROUP BY ${EMPRESA_DO_CENTRO}
      ) X
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = X.empresa
      WHERE @empresa IS NULL OR X.empresa = @empresa
      ORDER BY X.empresa;
    `);
  const [cadastro, entradas, estoque, saidas] = recordsets;
  return { produto: cadastro[0] ?? null, entradas, saidas, estoque };
}

module.exports = { TAB_NOTA_COMPRA, produtos, movimentos };
