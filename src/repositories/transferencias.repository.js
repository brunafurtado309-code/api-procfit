// Logística > TRANSFERÊNCIAS: o que foi transferido de uma loja (centro de estoque) para outra,
// as notas geradas e o recebimento no destino.
//
// Estrutura conferida no SSMS com a Bruna (nov/2026, INFORMATION_SCHEMA + amostras):
//   ESTOQUE_TRANSFERENCIAS (a transferência): ESTOQUE_TRANSFERENCIA = nº, EMPRESA, DATA_HORA,
//     USUARIO_LOGADO, MOVIMENTO (dia), CENTRO_ESTOQUE_ORIGEM -> CENTRO_ESTOQUE_DESTINO, OBSERVACAO,
//     MOTIVO (MOTIVOS_TRANSFERENCIAS.DESCRICAO), CANCELADO ('S'/'N'), EXIGE_APROVACAO.
//     Ex.: 431 = centro 10 -> centro 3; 430 = centro 10 -> centro 1, "ABASTECIMENTO FABRICA".
//   ESTOQUE_TRANSFERENCIAS_PRODUTOS: PRODUTO, QUANTIDADE, TIPO_UNIDADE, FATOR_EMBALAGEM,
//     QUANTIDADE_UNITARIA, por ESTOQUE_TRANSFERENCIA.
//   NF_FATURAMENTO_TRANSF: liga a transferência à NOTA gerada (NF_FATURAMENTO = registro da nota;
//     ex.: transferência 429 -> nota de registro 16945). A nota é uma NF_FATURAMENTO comum
//     (NF_NUMERO = nº impresso), cancelada quando está em CANCELAMENTOS_NOTAS_FISCAIS (TIPO 1).
//   ESTOQUE_TRANSFERENCIAS_RECEBIMENTOS: o RECEBIMENTO no destino (DATA_HORA, USUARIO_LOGADO, EMPRESA),
//     por ESTOQUE_TRANSFERENCIA ou pela nota (NF_FATURAMENTO); itens em
//     ESTOQUE_TRANSFERENCIAS_RECEBIMENTOS_PRODUTOS (QUANTIDADE, QTDE_CONFIRMADA, UNIDADE_MEDIDA).
//   ESTOQUE_LANCAMENTOS com TAB_MASTER_ORIGEM 339822 = só a ENTRADA no destino (tipo 4): nos últimos
//     30 dias, 963 lançamentos de 80 documentos, centros 1 a 11. A saída da origem não usa esse código.
// Centro de estoque -> empresa: a mesma regra do resto da Logística (centro 3 = empresa 3; centro de
// ajuste 1000301 = empresa 3).
// Situação: cancelada (CANCELADO = 'S') · recebida (tem recebimento) · em trânsito (tem nota, sem
// recebimento) · sem nota (ainda não faturada).
// A quantidade enviada e a recebida são mostradas cada uma com a sua unidade; a diferença só é
// destacada quando as duas estão na mesma unidade (a conferência das unidades fica para o primeiro uso).

const { sql, getPool } = require('../config/db');

const LIMITE_LISTA = 2000;
const EMPRESA = (c) => `CASE WHEN ${c} > 1000000 THEN (${c} - 1000001) / 100 ELSE ${c} END`;

function criarRequest(pool, f) {
  return pool.request()
    .input('inicio', sql.VarChar(10), f.inicio)
    .input('fim', sql.VarChar(10), f.fim)
    .input('origem', sql.Int, f.origem ?? null)
    .input('destino', sql.Int, f.destino ?? null)
    .input('busca', sql.VarChar(80), f.busca ?? null);
}

// Transferências do período (pelo dia da transferência), com notas, recebimento e totais
async function listar(filtros) {
  const pool = await getPool();
  const { recordsets } = await criarRequest(pool, filtros).query(`
    SET NOCOUNT ON;
    IF OBJECT_ID('tempdb..#T') IS NOT NULL DROP TABLE #T;
    DECLARE @ini date = CAST(@inicio AS date);
    DECLARE @ate date = DATEADD(day, 1, CAST(@fim AS date));

    SELECT ET.ESTOQUE_TRANSFERENCIA                      AS id,
           ET.DATA_HORA                                  AS feita_em,
           CAST(ET.MOVIMENTO AS date)                    AS dia,
           ET.EMPRESA                                    AS empresa,
           ET.CENTRO_ESTOQUE_ORIGEM                      AS centro_origem,
           ET.CENTRO_ESTOQUE_DESTINO                     AS centro_destino,
           ${EMPRESA('ET.CENTRO_ESTOQUE_ORIGEM')}        AS origem,
           ${EMPRESA('ET.CENTRO_ESTOQUE_DESTINO')}       AS destino,
           LTRIM(RTRIM(CAST(ET.OBSERVACAO AS varchar(300)))) AS observacao,
           ET.MOTIVO                                     AS motivo,
           ET.USUARIO_LOGADO                             AS usuario,
           CASE WHEN ET.CANCELADO = 'S' THEN 1 ELSE 0 END AS cancelada,
           ET.EXIGE_APROVACAO                            AS exige_aprovacao
    INTO #T
    FROM ESTOQUE_TRANSFERENCIAS ET WITH (NOLOCK)
    WHERE ET.MOVIMENTO >= @ini AND ET.MOVIMENTO < @ate
      AND (@origem IS NULL OR ${EMPRESA('ET.CENTRO_ESTOQUE_ORIGEM')} = @origem)
      AND (@destino IS NULL OR ${EMPRESA('ET.CENTRO_ESTOQUE_DESTINO')} = @destino)
      AND (@busca IS NULL
           OR CAST(ET.ESTOQUE_TRANSFERENCIA AS varchar(20)) = @busca
           OR CAST(ET.OBSERVACAO AS varchar(300)) LIKE '%' + @busca + '%'
           OR EXISTS (SELECT 1 FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                      JOIN NF_FATURAMENTO N WITH (NOLOCK) ON N.NF_FATURAMENTO = X.NF_FATURAMENTO
                      WHERE X.ESTOQUE_TRANSFERENCIA = ET.ESTOQUE_TRANSFERENCIA
                        AND (CAST(N.NF_NUMERO AS varchar(20)) = @busca OR CAST(N.NF_FATURAMENTO AS varchar(20)) = @busca))
           OR EXISTS (SELECT 1 FROM ESTOQUE_TRANSFERENCIAS_PRODUTOS P WITH (NOLOCK)
                      JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = P.PRODUTO
                      WHERE P.ESTOQUE_TRANSFERENCIA = ET.ESTOQUE_TRANSFERENCIA
                        AND (CAST(PR.PRODUTO AS varchar(20)) = @busca OR PR.DESCRICAO LIKE '%' + @busca + '%')))
    OPTION (RECOMPILE);

    -- [0] Uma linha por transferência
    SELECT TOP (${LIMITE_LISTA})
           T.id, CONVERT(varchar(16), T.feita_em, 120) AS feita_em, CONVERT(varchar(10), T.dia, 23) AS dia,
           T.origem, LTRIM(RTRIM(EO.NOME_FANTASIA)) AS origem_nome,
           T.destino, LTRIM(RTRIM(ED.NOME_FANTASIA)) AS destino_nome,
           T.centro_origem, T.centro_destino, T.observacao, T.cancelada, T.exige_aprovacao,
           LTRIM(RTRIM(MT.DESCRICAO)) AS motivo,
           COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS feita_por,
           ISNULL(IT.itens, 0) AS itens, ISNULL(IT.quantidade, 0) AS quantidade,
           NF.notas, NF.registros, ISNULL(NF.qtd_notas, 0) AS qtd_notas, ISNULL(NF.notas_canceladas, 0) AS notas_canceladas,
           ISNULL(NF.valor_notas, 0) AS valor_notas,
           CONVERT(varchar(16), RC.recebida_em, 120) AS recebida_em, RC.recebida_por, ISNULL(RC.recebimentos, 0) AS recebimentos
    FROM #T T
    LEFT JOIN EMPRESAS_USUARIAS EO WITH (NOLOCK) ON EO.EMPRESA_USUARIA = T.origem
    LEFT JOIN EMPRESAS_USUARIAS ED WITH (NOLOCK) ON ED.EMPRESA_USUARIA = T.destino
    LEFT JOIN MOTIVOS_TRANSFERENCIAS MT WITH (NOLOCK) ON MT.MOTIVO = T.motivo
    LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = T.usuario
    OUTER APPLY (SELECT COUNT(DISTINCT P.PRODUTO) AS itens, SUM(ISNULL(P.QUANTIDADE, 0)) AS quantidade
                 FROM ESTOQUE_TRANSFERENCIAS_PRODUTOS P WITH (NOLOCK) WHERE P.ESTOQUE_TRANSFERENCIA = T.id) IT
    OUTER APPLY (SELECT STRING_AGG(CAST(N.NF_NUMERO AS varchar(20)), ', ') AS notas,
                        STRING_AGG(CAST(N.NF_FATURAMENTO AS varchar(20)), ', ') AS registros,
                        COUNT(*) AS qtd_notas,
                        SUM(CASE WHEN C.CHAVE IS NOT NULL THEN 1 ELSE 0 END) AS notas_canceladas,
                        SUM(ISNULL(NT.TOTAL_GERAL, 0)) AS valor_notas
                 FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                 JOIN NF_FATURAMENTO N WITH (NOLOCK) ON N.NF_FATURAMENTO = X.NF_FATURAMENTO
                 LEFT JOIN NF_FATURAMENTO_TOTAIS NT WITH (NOLOCK) ON NT.NF_FATURAMENTO = N.NF_FATURAMENTO
                 -- (o SQL Server não deixa subconsulta dentro do SUM: o cancelamento vem por aqui)
                 OUTER APPLY (SELECT TOP 1 C1.CHAVE FROM CANCELAMENTOS_NOTAS_FISCAIS C1 WITH (NOLOCK)
                              WHERE C1.TIPO = 1 AND C1.CHAVE = N.NF_FATURAMENTO) C
                 WHERE X.ESTOQUE_TRANSFERENCIA = T.id) NF
    OUTER APPLY (SELECT MIN(R.DATA_HORA) AS recebida_em, COUNT(*) AS recebimentos,
                        MAX(COALESCE(NULLIF(LTRIM(RTRIM(UR.NOME)), ''), LTRIM(RTRIM(UR.LOGIN)))) AS recebida_por
                 FROM ESTOQUE_TRANSFERENCIAS_RECEBIMENTOS R WITH (NOLOCK)
                 LEFT JOIN USUARIOS UR WITH (NOLOCK) ON UR.USUARIO = R.USUARIO_LOGADO
                 WHERE R.ESTOQUE_TRANSFERENCIA = T.id
                    OR R.NF_FATURAMENTO IN (SELECT X.NF_FATURAMENTO FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                                            WHERE X.ESTOQUE_TRANSFERENCIA = T.id)) RC
    ORDER BY T.feita_em DESC;

    -- [1] Resumo por rota (origem -> destino), sem as canceladas
    SELECT T.origem, LTRIM(RTRIM(EO.NOME_FANTASIA)) AS origem_nome, T.destino, LTRIM(RTRIM(ED.NOME_FANTASIA)) AS destino_nome,
           COUNT(*) AS transferencias, SUM(ISNULL(IT.quantidade, 0)) AS quantidade, SUM(ISNULL(IT.itens, 0)) AS itens
    FROM #T T
    LEFT JOIN EMPRESAS_USUARIAS EO WITH (NOLOCK) ON EO.EMPRESA_USUARIA = T.origem
    LEFT JOIN EMPRESAS_USUARIAS ED WITH (NOLOCK) ON ED.EMPRESA_USUARIA = T.destino
    OUTER APPLY (SELECT COUNT(DISTINCT P.PRODUTO) AS itens, SUM(ISNULL(P.QUANTIDADE, 0)) AS quantidade
                 FROM ESTOQUE_TRANSFERENCIAS_PRODUTOS P WITH (NOLOCK) WHERE P.ESTOQUE_TRANSFERENCIA = T.id) IT
    WHERE T.cancelada = 0
    GROUP BY T.origem, EO.NOME_FANTASIA, T.destino, ED.NOME_FANTASIA
    ORDER BY COUNT(*) DESC;

    -- [2] Produtos mais transferidos no período, por rota (sem as canceladas)
    SELECT TOP 300 P.PRODUTO AS produto, LTRIM(RTRIM(PR.DESCRICAO)) AS descricao,
           T.origem, T.destino, LTRIM(RTRIM(MAX(P.TIPO_UNIDADE))) AS unidade,
           SUM(ISNULL(P.QUANTIDADE, 0)) AS quantidade, COUNT(DISTINCT T.id) AS transferencias
    FROM #T T
    JOIN ESTOQUE_TRANSFERENCIAS_PRODUTOS P WITH (NOLOCK) ON P.ESTOQUE_TRANSFERENCIA = T.id
    LEFT JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = P.PRODUTO
    WHERE T.cancelada = 0
    GROUP BY P.PRODUTO, PR.DESCRICAO, T.origem, T.destino
    ORDER BY SUM(ISNULL(P.QUANTIDADE, 0)) DESC;
  `);
  return { transferencias: recordsets[0], rotas: recordsets[1], produtos: recordsets[2], limite: LIMITE_LISTA };
}

// Uma transferência: os produtos (enviado x recebido), as notas e os recebimentos
async function detalhe(id) {
  const pool = await getPool();
  const { recordsets } = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SET NOCOUNT ON;
      -- [0] Produtos: enviado (transferência) x recebido (recebimento no destino)
      SELECT P.PRODUTO AS produto, LTRIM(RTRIM(PR.DESCRICAO)) AS descricao,
             LTRIM(RTRIM(MAX(P.TIPO_UNIDADE))) AS unidade, MAX(P.FATOR_EMBALAGEM) AS fator,
             SUM(ISNULL(P.QUANTIDADE, 0)) AS enviada,
             SUM(ISNULL(P.QUANTIDADE_UNITARIA, 0)) AS enviada_unitaria,
             MAX(RP.recebida) AS recebida, MAX(RP.confirmada) AS confirmada, MAX(RP.unidade_recebida) AS unidade_recebida
      FROM ESTOQUE_TRANSFERENCIAS_PRODUTOS P WITH (NOLOCK)
      LEFT JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = P.PRODUTO
      OUTER APPLY (
        SELECT SUM(ISNULL(RI.QUANTIDADE, 0)) AS recebida, SUM(ISNULL(RI.QTDE_CONFIRMADA, 0)) AS confirmada,
               MAX(LTRIM(RTRIM(RI.UNIDADE_MEDIDA))) AS unidade_recebida
        FROM ESTOQUE_TRANSFERENCIAS_RECEBIMENTOS R WITH (NOLOCK)
        JOIN ESTOQUE_TRANSFERENCIAS_RECEBIMENTOS_PRODUTOS RI WITH (NOLOCK) ON RI.ESTOQUE_RECEBIMENTO = R.ESTOQUE_RECEBIMENTO
        WHERE RI.PRODUTO = P.PRODUTO
          AND (R.ESTOQUE_TRANSFERENCIA = @id
               OR R.NF_FATURAMENTO IN (SELECT X.NF_FATURAMENTO FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                                       WHERE X.ESTOQUE_TRANSFERENCIA = @id))
      ) RP
      WHERE P.ESTOQUE_TRANSFERENCIA = @id
      GROUP BY P.PRODUTO, PR.DESCRICAO
      ORDER BY PR.DESCRICAO;

      -- [1] Notas geradas pela transferência
      SELECT N.NF_FATURAMENTO AS registro, N.NF_NUMERO AS nota, CONVERT(varchar(10), N.MOVIMENTO, 23) AS dia,
             N.EMPRESA AS empresa, ISNULL(NT.TOTAL_GERAL, 0) AS valor,
             CASE WHEN C.CHAVE IS NOT NULL THEN 1 ELSE 0 END AS cancelada,
             CONVERT(varchar(16), C.DATA_HORA, 120) AS cancelada_em
      FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
      JOIN NF_FATURAMENTO N WITH (NOLOCK) ON N.NF_FATURAMENTO = X.NF_FATURAMENTO
      LEFT JOIN NF_FATURAMENTO_TOTAIS NT WITH (NOLOCK) ON NT.NF_FATURAMENTO = N.NF_FATURAMENTO
      OUTER APPLY (SELECT TOP 1 C1.CHAVE, C1.DATA_HORA FROM CANCELAMENTOS_NOTAS_FISCAIS C1 WITH (NOLOCK)
                   WHERE C1.TIPO = 1 AND C1.CHAVE = N.NF_FATURAMENTO ORDER BY C1.DATA_HORA DESC) C
      WHERE X.ESTOQUE_TRANSFERENCIA = @id
      ORDER BY N.NF_NUMERO;

      -- [2] Recebimentos no destino
      SELECT R.ESTOQUE_RECEBIMENTO AS recebimento, CONVERT(varchar(16), R.DATA_HORA, 120) AS recebido_em,
             R.EMPRESA AS empresa, R.NF_NUMERO AS nota,
             COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS recebido_por
      FROM ESTOQUE_TRANSFERENCIAS_RECEBIMENTOS R WITH (NOLOCK)
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = R.USUARIO_LOGADO
      WHERE R.ESTOQUE_TRANSFERENCIA = @id
         OR R.NF_FATURAMENTO IN (SELECT X.NF_FATURAMENTO FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                                 WHERE X.ESTOQUE_TRANSFERENCIA = @id)
      ORDER BY R.DATA_HORA;
    `);
  return { produtos: recordsets[0], notas: recordsets[1], recebimentos: recordsets[2] };
}

module.exports = { listar, detalhe, LIMITE_LISTA };
