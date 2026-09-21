// Camada de dados dos ACERTOS DE DESPACHO (recebimento da carga entregue).
//
// Um acerto (RECEBIMENTOS_FATURAMENTO_DESPACHO) fecha uma carga (FATURAMENTO_DESPACHO):
//   _DETALHES    uma linha por nota da carga (NF_TOTAL, pedido, forma, valor informado)
//   _PAGAMENTOS  cartão informado na nota (bandeira, parcelas, NSU)
//   _RESULTADOS  parcelas geradas; TITULO_RECEBER liga ao contas a receber
//   _TOTAIS      conferência do próprio sistema (TOTAL_NOTAS x TOTAL_RESULTADO)
// Observações validadas no banco (set/2026):
//   - PROCESSAR não é situação (é um botão que volta para 'N').
//   - Acerto concluído = tem linhas em _RESULTADOS.
//   - Uma nota pode aparecer em mais de uma linha de _DETALHES (pagamento dividido: a linha
//     extra aponta para a original em ..._DETALHE_COPIA), por isso o total das notas soma
//     cada NF_FATURAMENTO uma vez só.
//   - O total que o PROCFIT confere (_TOTAIS.TOTAL_NOTAS) é a soma de VALOR_PAGAMENTO
//     (o valor INFORMADO no acerto), não o valor das notas. Conferido nos acertos 220 e 221:
//     notas pagas em parte (ex.: nota de R$ 1.252,20 com R$ 700,00 informados) explicam a
//     diferença centavo a centavo. Por isso a aba mostra os dois:
//       a descoberto = total das notas - informado   (nota entregue sem pagamento completo)
//       diferença    = informado - parcelas geradas   (o que o processamento não gerou)

const { sql, getPool } = require('../config/db');

const D = 'RECEBIMENTOS_FATURAMENTO_DESPACHO';

// Totais de um acerto, calculados a partir das notas e das parcelas
const TOTAIS_DO_ACERTO = `
  OUTER APPLY (
    SELECT COUNT(*) AS notas, SUM(X.NF_TOTAL) AS total_notas, SUM(X.INFORMADO) AS total_informado
    FROM (
      SELECT DT.NF_FATURAMENTO, MAX(DT.NF_TOTAL) AS NF_TOTAL, SUM(ISNULL(DT.VALOR_PAGAMENTO, 0)) AS INFORMADO
      FROM ${D}_DETALHES DT WITH (NOLOCK)
      WHERE DT.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
      GROUP BY DT.NF_FATURAMENTO
    ) X
  ) NT
  OUTER APPLY (
    SELECT COUNT(*) AS parcelas, SUM(RS.VALOR) AS total_parcelas
    FROM ${D}_RESULTADOS RS WITH (NOLOCK)
    WHERE RS.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
  ) PT
  OUTER APPLY (
    SELECT TOP 1 TT.TOTAL_NOTAS, TT.TOTAL_RESULTADO
    FROM ${D}_TOTAIS TT WITH (NOLOCK)
    WHERE TT.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
    ORDER BY TT.RECEBIMENTO_FATURAMENTO_DESPACHO_TOTAL DESC
  ) TS`;

const CAMPOS_DO_ACERTO = `
  R.RECEBIMENTO_FATURAMENTO_DESPACHO                                  AS acerto,
  CONVERT(varchar(10), COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA), 23) AS data_recebimento,
  CONVERT(varchar(16), R.DATA_HORA, 120)                              AS digitado_em,
  R.USUARIO_LOGADO                                                    AS usuario,
  R.FATURAMENTO_DESPACHO_FILTRO                                       AS carga,
  LTRIM(RTRIM(FD.ROTA))                                               AS rota,
  ISNULL(NT.notas, 0)                                                 AS notas,
  ISNULL(NT.total_notas, 0)                                           AS total_notas,
  ISNULL(NT.total_informado, 0)                                       AS total_informado,
  ISNULL(NT.total_notas, 0) - ISNULL(NT.total_informado, 0)           AS a_descoberto,
  ISNULL(PT.parcelas, 0)                                              AS parcelas,
  ISNULL(PT.total_parcelas, 0)                                        AS total_parcelas,
  ISNULL(NT.total_informado, 0) - ISNULL(PT.total_parcelas, 0)        AS diferenca,
  TS.TOTAL_NOTAS                                                      AS sistema_total_notas,
  TS.TOTAL_RESULTADO                                                  AS sistema_total_parcelas,
  CASE
    WHEN ISNULL(NT.notas, 0) = 0 THEN 'SEM_NOTAS'
    WHEN ISNULL(PT.parcelas, 0) = 0 THEN 'SEM_PARCELAS'
    WHEN ABS(ISNULL(NT.total_informado, 0) - ISNULL(PT.total_parcelas, 0)) > 0.01 THEN 'DIFERENCA'
    ELSE 'CONFERIDO'
  END                                                                 AS situacao`;

// Lista de acertos do período, com pesquisa por acerto, carga, nota, pedido ou cliente
async function lista(filtros) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio ?? null)
    .input('fim', sql.VarChar(10), filtros.fim ?? null)
    .input('busca', sql.VarChar(60), filtros.busca || null)
    .query(`
      SELECT TOP 2000 ${CAMPOS_DO_ACERTO}
      FROM ${D} R WITH (NOLOCK)
      LEFT JOIN FATURAMENTO_DESPACHO FD WITH (NOLOCK)
        ON FD.FATURAMENTO_DESPACHO = R.FATURAMENTO_DESPACHO_FILTRO
      ${TOTAIS_DO_ACERTO}
      WHERE (@inicio IS NULL OR COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA) >= CAST(@inicio AS date))
        AND (@fim IS NULL OR COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA) < DATEADD(day, 1, CAST(@fim AS date)))
        AND (@busca IS NULL
          OR CAST(R.RECEBIMENTO_FATURAMENTO_DESPACHO AS varchar(20)) = @busca
          OR CAST(R.FATURAMENTO_DESPACHO_FILTRO AS varchar(20)) = @busca
          OR EXISTS (
            SELECT 1
            FROM ${D}_DETALHES DB WITH (NOLOCK)
            LEFT JOIN ENTIDADES EB WITH (NOLOCK) ON EB.ENTIDADE = DB.ENTIDADE
            WHERE DB.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
              AND (CAST(DB.NF_NUMERO AS varchar(20)) = @busca
                OR CAST(DB.PEDIDO_PREVENDA AS varchar(20)) = @busca
                OR CAST(DB.ENTIDADE AS varchar(20)) = @busca
                OR EB.NOME LIKE '%' + @busca + '%')
          ))
      ORDER BY R.RECEBIMENTO_FATURAMENTO_DESPACHO DESC;
    `);
  return recordset;
}

// Um acerto por inteiro: cabeçalho, notas, parcelas geradas e cartões informados
async function detalhe(acerto) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('acerto', sql.Decimal(18, 0), acerto)
    .query(`
      -- 1) Cabeçalho do acerto e da carga
      SELECT ${CAMPOS_DO_ACERTO},
        CONVERT(varchar(16), FD.DATA_HORA, 120) AS carga_criada_em,
        FD.USUARIO_LOGADO                       AS carga_usuario,
        FD.VEICULO                              AS veiculo,
        FD.CONFERENTE                           AS conferente,
        FD.RESPONSAVEL                          AS responsavel
      FROM ${D} R WITH (NOLOCK)
      LEFT JOIN FATURAMENTO_DESPACHO FD WITH (NOLOCK)
        ON FD.FATURAMENTO_DESPACHO = R.FATURAMENTO_DESPACHO_FILTRO
      ${TOTAIS_DO_ACERTO}
      WHERE R.RECEBIMENTO_FATURAMENTO_DESPACHO = @acerto;

      -- 2) Notas do acerto (uma linha por lançamento; pagamento dividido aparece em mais de uma)
      SELECT
        DT.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE AS detalhe,
        DT.NF_NUMERO                        AS nota,
        DT.ENTIDADE                         AS codigo_cliente,
        LTRIM(RTRIM(E.NOME))                AS cliente,
        NULLIF(DT.PEDIDO_PREVENDA, 0)       AS pedido,
        DT.MODALIDADE                       AS modalidade,
        LTRIM(RTRIM(FM.DESC_MODALIDADE))    AS forma,
        DT.NF_TOTAL                         AS valor_nota,
        DT.VALOR_PAGAMENTO                  AS valor_informado,
        DT.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE_COPIA AS copia_de,
        ISNULL(RS.qtd, 0)                   AS parcelas,
        ISNULL(RS.total, 0)                 AS valor_parcelas
      FROM ${D}_DETALHES DT WITH (NOLOCK)
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = DT.ENTIDADE
      OUTER APPLY (
        SELECT COUNT(*) AS qtd, SUM(R2.VALOR) AS total
        FROM ${D}_RESULTADOS R2 WITH (NOLOCK)
        WHERE R2.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE = DT.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE
      ) RS
      OUTER APPLY (
        SELECT TOP 1 R3.DESC_MODALIDADE
        FROM ${D}_RESULTADOS R3 WITH (NOLOCK)
        WHERE R3.MODALIDADE = DT.MODALIDADE AND R3.DESC_MODALIDADE IS NOT NULL
      ) FM
      WHERE DT.RECEBIMENTO_FATURAMENTO_DESPACHO = @acerto
      ORDER BY DT.NF_NUMERO, DT.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE;

      -- 3) Parcelas geradas
      SELECT
        LTRIM(RTRIM(RS.TITULO))                AS titulo,
        RS.PARCELA                             AS parcela,
        RS.ENTIDADE                            AS codigo_cliente,
        LTRIM(RTRIM(RS.DESC_ENTIDADE))         AS cliente,
        NULLIF(RS.PEDIDO_PREVENDA, 0)          AS pedido,
        LTRIM(RTRIM(RS.DESC_MODALIDADE))       AS forma,
        CONVERT(varchar(10), RS.VENCIMENTO, 23) AS vencimento,
        RS.VALOR                               AS valor,
        RS.TITULO_RECEBER                      AS titulo_receber
      FROM ${D}_RESULTADOS RS WITH (NOLOCK)
      WHERE RS.RECEBIMENTO_FATURAMENTO_DESPACHO = @acerto
      ORDER BY RS.TITULO, RS.PARCELA;

      -- 4) Cartões informados
      SELECT
        DT.NF_NUMERO              AS nota,
        LTRIM(RTRIM(P.CODBANDEIRA)) AS bandeira,
        P.PARCELAS                AS parcelas,
        P.VALOR                   AS valor,
        LTRIM(RTRIM(P.NSU))       AS nsu,
        LTRIM(RTRIM(P.AUTORIZACAO)) AS autorizacao
      FROM ${D}_PAGAMENTOS P WITH (NOLOCK)
      LEFT JOIN ${D}_DETALHES DT WITH (NOLOCK)
        ON DT.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE = P.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE
      WHERE P.RECEBIMENTO_FATURAMENTO_DESPACHO = @acerto
      ORDER BY DT.NF_NUMERO;
    `);

  const [cabecalho] = recordsets[0];
  if (!cabecalho) return null;
  return { acerto: cabecalho, notas: recordsets[1], parcelas: recordsets[2], cartoes: recordsets[3] };
}

module.exports = { lista, detalhe };
