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
// Devolução de venda por nota: a entrada é devolução quando existe a nota em
// NF_FATURAMENTO_DEVOLUCOES (a mesma que o painel de Vendas usa). O lançamento de estoque aponta a
// devolução em REG_MASTER_ORIGEM, ou traz em DOCUMENTO o nº da nota de venda ORIGINAL
// (NF_FATURAMENTO_ORIGEM), igual à VENDAS_ANALITICAS. Devolução no caixa = origem 601979.
// Nota de venda cancelada = origem 561384 (CANCELAMENTOS_NOTAS_FISCAIS, conferido em out/2026 na
// nota 10579): o cancelamento devolve ao estoque todos os itens da nota; DOCUMENTO é o nº da nota
// cancelada e ENTIDADE é o cliente dela. O lançamento aponta o cancelamento em REG_MASTER_ORIGEM
// (= NF_CANCELAMENTO), de onde vêm quem cancelou (USUARIO_LOGADO), quando (DATA_HORA) e o motivo
// (JUSTIFICATIVA).

const { sql, getPool } = require('../config/db');
const { EMPRESA_DO_CENTRO } = require('./logistica.repository');

const TAB_NOTA_COMPRA = 41;
const TAB_CAIXA = 601979;
const TAB_CANCELAMENTO_NOTA = 561384;
const TAB_TRANSFERENCIA = 339822;
const LIMITE_LISTA = 3000;
const LIMITE_NOTAS = 1000;

// Nome de quem lançou a partir do usuário do PROCFIT. O login ADMIN é genérico e não identifica uma
// pessoa (vem NULL): a nota de compra chega pelo eDoc já com o ADMIN e quem a finaliza não fica
// gravado em lugar nenhum (conferido em out/2026: NF_COMPRA, ESPELHO, conferências e
// ESTOQUE_LANCAMENTOS_LOG, que só registra exclusões de reprocessamento).
const QUEM = (u) => `CASE WHEN LTRIM(RTRIM(${u}.LOGIN)) = 'ADMIN' THEN NULL
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(${u}.NOME)), ''), LTRIM(RTRIM(${u}.LOGIN))) END`;
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

// Ficha de um produto no período: cada ENTRADA em detalhe (com quem lançou a nota de compra),
// o TOTAL que saiu (as vendas viram centenas de linhas) e os 3 clientes que mais compraram.
// Clientes: VENDAS_ANALITICAS.CLIENTE, sem o tipo 20 (mesma regra do painel de vendas); a venda
// no caixa sem cliente identificado fica fora do ranking.
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
        ${QUEM('U')} AS nota_lancada_por,
        DEV.NF_NUMERO                                    AS devolucao_nota,
        CONVERT(varchar(19), DEV.DATA_HORA, 120)         AS devolucao_lancada_em,
        ${QUEM('UD')} AS devolucao_lancada_por,
        CONVERT(varchar(19), CN.DATA_HORA, 120)          AS cancelada_em,
        ${QUEM('UC')} AS cancelada_por,
        LTRIM(RTRIM(COALESCE(NULLIF(CAST(CN.JUSTIFICATIVA AS varchar(500)), ''),
                            CAST(CN.OBSERVACAO AS varchar(500))))) AS motivo_cancelamento
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = ${EMPRESA_DO_CENTRO}
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = EL.ENTIDADE
      OUTER APPLY (
        SELECT TOP 1 N.NF_NUMERO, N.DATA_HORA, N.USUARIO_LOGADO
        FROM NF_COMPRA N WITH (NOLOCK)
        WHERE EL.TAB_MASTER_ORIGEM = ${TAB_NOTA_COMPRA}
          AND (N.NF_COMPRA = EL.REG_MASTER_ORIGEM
               OR (N.NF_NUMERO = EL.DOCUMENTO AND N.ENTIDADE = EL.ENTIDADE))
        ORDER BY CASE WHEN N.NF_COMPRA = EL.REG_MASTER_ORIGEM THEN 0 ELSE 1 END, N.NF_COMPRA DESC
      ) NC
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = NC.USUARIO_LOGADO
      OUTER APPLY (
        SELECT TOP 1 DV.NF_NUMERO, DV.DATA_HORA, DV.USUARIO_LOGADO
        FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
        LEFT JOIN NF_FATURAMENTO NFO WITH (NOLOCK) ON NFO.NF_FATURAMENTO = DV.NF_FATURAMENTO_ORIGEM
        WHERE EL.TAB_MASTER_ORIGEM NOT IN (${TAB_NOTA_COMPRA}, ${TAB_CAIXA}, ${TAB_CANCELAMENTO_NOTA}, ${TAB_TRANSFERENCIA})
          AND (DV.NF_FATURAMENTO_DEVOLUCAO = EL.REG_MASTER_ORIGEM OR NFO.NF_NUMERO = EL.DOCUMENTO)
        ORDER BY CASE WHEN DV.NF_FATURAMENTO_DEVOLUCAO = EL.REG_MASTER_ORIGEM THEN 0 ELSE 1 END,
                 DV.NF_FATURAMENTO_DEVOLUCAO DESC
      ) DEV
      LEFT JOIN USUARIOS UD WITH (NOLOCK) ON UD.USUARIO = DEV.USUARIO_LOGADO
      LEFT JOIN CANCELAMENTOS_NOTAS_FISCAIS CN WITH (NOLOCK)
        ON EL.TAB_MASTER_ORIGEM = ${TAB_CANCELAMENTO_NOTA} AND CN.NF_CANCELAMENTO = EL.REG_MASTER_ORIGEM
      LEFT JOIN USUARIOS UC WITH (NOLOCK) ON UC.USUARIO = CN.USUARIO_LOGADO
      WHERE EL.PRODUTO = @produto
        AND EL.DATA >= @de AND EL.DATA < @ate
        AND ISNULL(EL.ESTOQUE_ENTRADA, 0) > 0
        AND (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa)
      ORDER BY EL.DATA_HORA DESC, EL.ESTOQUE DESC;

      SELECT SUM(ISNULL(EL.ESTOQUE_SAIDA, 0)) AS saida
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      WHERE EL.PRODUTO = @produto
        AND EL.DATA >= @de AND EL.DATA < @ate
        AND (@empresa IS NULL OR ${EMPRESA_DO_CENTRO} = @empresa);

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

      SELECT TOP 3
        VA.CLIENTE                  AS cliente,
        LTRIM(RTRIM(E.NOME))        AS nome,
        SUM(VA.QUANTIDADE)          AS quantidade
      FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = VA.CLIENTE
      WHERE VA.PRODUTO = @produto
        AND VA.MOVIMENTO >= @de AND VA.MOVIMENTO < @ate
        AND VA.DOCUMENTO_TIPO <> 20
        AND ISNULL(VA.CLIENTE, 0) > 0
        AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
      GROUP BY VA.CLIENTE, E.NOME
      HAVING SUM(VA.QUANTIDADE) > 0
      ORDER BY SUM(VA.QUANTIDADE) DESC;
    `);
  const [cadastro, entradas, saidas, estoque, clientes] = recordsets;
  return { produto: cadastro[0] ?? null, entradas, saida: saidas[0]?.saida ?? 0, estoque, clientes };
}

// ===== Notas de entrada =====
// Cada documento que colocou mercadoria no estoque no período (nota de compra, transferência,
// devolução, nota de venda cancelada...), uma linha por documento. Os lançamentos de estoque do
// mesmo documento são juntados pela tela de origem + registro de origem + nº do documento +
// fornecedor/cliente + empresa. As regras de quem lançou são as mesmas da ficha do produto.
// A pesquisa acha pelo nº da nota, pelo nome do fornecedor/cliente ou por um produto da nota.
async function notas(filtros) {
  const pool = await getPool();
  const { recordsets } = await criarRequest(pool, filtros).query(`
    SET NOCOUNT ON;
    ${PERIODO}
    IF OBJECT_ID('tempdb..#ENT') IS NOT NULL DROP TABLE #ENT;

    SELECT
      EL.TAB_MASTER_ORIGEM                       AS origem,
      EL.REG_MASTER_ORIGEM                       AS registro,
      C.empresa,
      C.documento,
      EL.ENTIDADE                                AS entidade,
      MAX(EL.TIPO_MOVIMENTO)                     AS tipo,
      MIN(EL.DATA_HORA)                          AS quando,
      COUNT(DISTINCT EL.PRODUTO)                 AS itens,
      SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0))         AS quantidade,
      MAX(CASE WHEN PR.PRODUTO IS NOT NULL THEN 1 ELSE 0 END) AS bate_produto
    INTO #ENT
    FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
    CROSS APPLY (SELECT ${EMPRESA_DO_CENTRO} AS empresa, NULLIF(EL.DOCUMENTO, 0) AS documento) C
    LEFT JOIN PRODUTOS PR WITH (NOLOCK)
      ON @busca IS NOT NULL AND PR.PRODUTO = EL.PRODUTO
     AND (CAST(PR.PRODUTO AS varchar(20)) = @busca OR PR.DESCRICAO LIKE '%' + @busca + '%')
    WHERE EL.DATA >= @de AND EL.DATA < @ate
      AND ISNULL(EL.ESTOQUE_ENTRADA, 0) > 0
      AND (@empresa IS NULL OR C.empresa = @empresa)
    GROUP BY EL.TAB_MASTER_ORIGEM, EL.REG_MASTER_ORIGEM, C.empresa, C.documento, EL.ENTIDADE;

    SELECT TOP (${LIMITE_NOTAS})
      X.origem, X.registro, X.empresa, X.documento, X.entidade, X.tipo, X.itens, X.quantidade,
      CONVERT(varchar(19), X.quando, 120)              AS quando,
      LTRIM(RTRIM(EU.NOME_FANTASIA))                   AS nome_empresa,
      LTRIM(RTRIM(E.NOME))                             AS nome_entidade,
      NC.NF_NUMERO                                     AS nota_compra,
      CONVERT(varchar(19), NC.DATA_HORA, 120)          AS nota_lancada_em,
      ${QUEM('U')} AS nota_lancada_por,
      DEV.NF_NUMERO                                    AS devolucao_nota,
      CONVERT(varchar(19), DEV.DATA_HORA, 120)         AS devolucao_lancada_em,
      ${QUEM('UD')} AS devolucao_lancada_por,
      CONVERT(varchar(19), CN.DATA_HORA, 120)          AS cancelada_em,
      ${QUEM('UC')} AS cancelada_por
    FROM #ENT X
    LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = X.empresa
    LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = X.entidade
    OUTER APPLY (
      SELECT TOP 1 N.NF_NUMERO, N.DATA_HORA, N.USUARIO_LOGADO
      FROM NF_COMPRA N WITH (NOLOCK)
      WHERE X.origem = ${TAB_NOTA_COMPRA}
        AND (N.NF_COMPRA = X.registro OR (N.NF_NUMERO = X.documento AND N.ENTIDADE = X.entidade))
      ORDER BY CASE WHEN N.NF_COMPRA = X.registro THEN 0 ELSE 1 END, N.NF_COMPRA DESC
    ) NC
    LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = NC.USUARIO_LOGADO
    OUTER APPLY (
      SELECT TOP 1 DV.NF_NUMERO, DV.DATA_HORA, DV.USUARIO_LOGADO
      FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
      LEFT JOIN NF_FATURAMENTO NFO WITH (NOLOCK) ON NFO.NF_FATURAMENTO = DV.NF_FATURAMENTO_ORIGEM
      WHERE X.origem NOT IN (${TAB_NOTA_COMPRA}, ${TAB_CAIXA}, ${TAB_CANCELAMENTO_NOTA}, ${TAB_TRANSFERENCIA})
        AND (DV.NF_FATURAMENTO_DEVOLUCAO = X.registro OR NFO.NF_NUMERO = X.documento)
      ORDER BY CASE WHEN DV.NF_FATURAMENTO_DEVOLUCAO = X.registro THEN 0 ELSE 1 END,
               DV.NF_FATURAMENTO_DEVOLUCAO DESC
    ) DEV
    LEFT JOIN USUARIOS UD WITH (NOLOCK) ON UD.USUARIO = DEV.USUARIO_LOGADO
    LEFT JOIN CANCELAMENTOS_NOTAS_FISCAIS CN WITH (NOLOCK)
      ON X.origem = ${TAB_CANCELAMENTO_NOTA} AND CN.NF_CANCELAMENTO = X.registro
    LEFT JOIN USUARIOS UC WITH (NOLOCK) ON UC.USUARIO = CN.USUARIO_LOGADO
    WHERE @busca IS NULL
       OR X.bate_produto = 1
       OR CAST(X.documento AS varchar(20)) = @busca
       OR CAST(NC.NF_NUMERO AS varchar(20)) = @busca
       OR CAST(DEV.NF_NUMERO AS varchar(20)) = @busca
       OR E.NOME LIKE '%' + @busca + '%'
    ORDER BY X.quando DESC;
  `);
  return recordsets[0];
}

// Produtos de uma nota de entrada (a mesma junção da lista de notas)
async function itensDaNota(nota, filtros) {
  const pool = await getPool();
  const { recordset } = await criarRequest(pool, filtros)
    .input('origem', sql.Int, nota.origem)
    .input('registro', sql.Int, nota.registro)
    .input('documento', sql.BigInt, nota.documento)
    .input('entidade', sql.Int, nota.entidade)
    .input('empresaNota', sql.Int, nota.empresa)
    .query(`
      SET NOCOUNT ON;
      ${PERIODO}
      SELECT
        EL.PRODUTO                                 AS produto,
        LTRIM(RTRIM(PR.DESCRICAO))                 AS descricao,
        SUM(ISNULL(EL.ESTOQUE_ENTRADA, 0))         AS quantidade,
        CONVERT(varchar(19), MIN(EL.DATA_HORA), 120) AS quando
      FROM ESTOQUE_LANCAMENTOS EL WITH (NOLOCK)
      CROSS APPLY (SELECT ${EMPRESA_DO_CENTRO} AS empresa, NULLIF(EL.DOCUMENTO, 0) AS documento) C
      LEFT JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = EL.PRODUTO
      WHERE EL.DATA >= @de AND EL.DATA < @ate
        AND ISNULL(EL.ESTOQUE_ENTRADA, 0) > 0
        AND EL.TAB_MASTER_ORIGEM = @origem
        AND ((@registro IS NULL AND EL.REG_MASTER_ORIGEM IS NULL) OR EL.REG_MASTER_ORIGEM = @registro)
        AND ((@documento IS NULL AND C.documento IS NULL) OR C.documento = @documento)
        AND ((@entidade IS NULL AND EL.ENTIDADE IS NULL) OR EL.ENTIDADE = @entidade)
        AND C.empresa = @empresaNota
      GROUP BY EL.PRODUTO, PR.DESCRICAO
      ORDER BY PR.DESCRICAO;
    `);
  return recordset;
}

module.exports = {
  TAB_NOTA_COMPRA, TAB_CAIXA, TAB_CANCELAMENTO_NOTA, TAB_TRANSFERENCIA, LIMITE_NOTAS,
  produtos, movimentos, notas, itensDaNota,
};
