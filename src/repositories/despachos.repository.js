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

// Nome de um usuário do PROCFIT. Só NOME e LOGIN: a tabela USUARIOS guarda senhas,
// então nunca usar SELECT * nela.
const NOME_USUARIO = (alias) =>
  `COALESCE(NULLIF(LTRIM(RTRIM(${alias}.NOME)), ''), LTRIM(RTRIM(${alias}.LOGIN)))`;

// Carga do acerto + quem lançou o retorno (usado na lista e no detalhe)
const JUNCOES = `
  LEFT JOIN FATURAMENTO_DESPACHO FD WITH (NOLOCK)
    ON FD.FATURAMENTO_DESPACHO = R.FATURAMENTO_DESPACHO_FILTRO
  LEFT JOIN USUARIOS UL WITH (NOLOCK) ON UL.USUARIO = R.USUARIO_LOGADO`;

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

// Situação de cada título gerado, lida do extrato TITULOS_RECEBER_TRANSACOES
// (mesma regra validada no financeiro.repository.js):
//   pendente = soma(CREDITO) - soma(DEBITO)      -> 0 = pago; negativo = recebido a mais
//   TRANSACAO_FINANCEIRA 12 = recebimento (baixa), 13 = cancelamento, 51..55 = estornos
// Onde a baixa foi feita (TAB_MASTER_ORIGEM da transação):
//   455510 retorno de despacho · 668401 bancos por títulos · 356928 caixa · 249008 cofre da loja
// Serve para mapear a rota: se o título foi baixado aqui, não pode estar em aberto
// nem ser baixado de novo em outro formulário.
//
// Dinheiro no acerto (validado em out/2026, acerto 150 / NF 8900):
//   o acerto NÃO gera título novo para dinheiro (RESULTADOS.TIPO_GERACAO = 2 aponta para o
//   título da própria nota). Ao processar, o PROCFIT CANCELA esse título pela tela
//   "Cancelamento de Títulos a Receber" (tabela 451661 = CANCELAMENTO_TITULOS_RECEBER),
//   com MOTIVO = 'Recebimento e Conferência de Despacho: <nº do acerto>'.
//   Medido: 352 de 368 linhas de dinheiro seguem esse caminho. Por isso esse cancelamento
//   conta como "pago no acerto"; cancelamento com outro motivo é manual e merece atenção.
// CAST: garante que funcione mesmo se MOTIVO for do tipo text/ntext
const MOTIVO_ACERTO = `CAST(C.MOTIVO AS varchar(200)) LIKE 'Recebimento e Confer%Despacho:%'`;
const SITUACAO_DO_TITULO = (coluna) => `
  OUTER APPLY (
    SELECT
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 AND ${MOTIVO_ACERTO}
               THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)                                            AS cancelado_no_acerto,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 AND ${MOTIVO_ACERTO}
               THEN LTRIM(RTRIM(CAST(C.MOTIVO AS varchar(200)))) END)                                                 AS motivo_acerto,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 AND ${MOTIVO_ACERTO}
               THEN C.CANCELAMENTO_TITULO_RECEBER END)                                          AS cancelamento_acerto,
      CONVERT(varchar(16), MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 AND ${MOTIVO_ACERTO}
               THEN C.DATA_HORA END), 120)                                                      AS cancelado_no_acerto_em,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 AND NOT (${MOTIVO_ACERTO} AND CAST(C.MOTIVO AS varchar(200)) IS NOT NULL)
               THEN TX.REG_MASTER_ORIGEM END)                                                   AS cancelamento_manual,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 AND NOT (${MOTIVO_ACERTO} AND CAST(C.MOTIVO AS varchar(200)) IS NOT NULL)
               THEN LTRIM(RTRIM(CAST(C.MOTIVO AS varchar(200)))) END)                                                 AS motivo_manual,
      -- 43 = renegociação (tabela 650512): o título é zerado e substituído por novas parcelas
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 43 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)          AS renegociado,
      CONVERT(varchar(10), MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 43 THEN TX.DATA END), 23)    AS renegociado_em,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 43 THEN TX.REG_MASTER_ORIGEM END)                AS renegociacao,
      SUM(ISNULL(TX.CREDITO, 0)) - SUM(ISNULL(TX.DEBITO, 0))                                   AS pendente,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)          AS recebido,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 13 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)          AS cancelado,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA BETWEEN 51 AND 55 THEN 1 END)                     AS estornos,
      CONVERT(varchar(10), MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN TX.DATA END), 23)    AS ultima_baixa,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
                  AND TX.TAB_MASTER_ORIGEM = 455510 THEN 1 END)                                 AS baixas_despacho,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
                  AND TX.TAB_MASTER_ORIGEM = 668401 THEN 1 END)                                 AS baixas_bancos,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
                  AND TX.TAB_MASTER_ORIGEM = 356928 THEN 1 END)                                 AS baixas_caixa,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
                  AND TX.TAB_MASTER_ORIGEM = 249008 THEN 1 END)                                 AS baixas_cofre,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
                  AND ISNULL(TX.TAB_MASTER_ORIGEM, 0) NOT IN (455510, 668401, 356928, 249008)
                 THEN 1 END)                                                                    AS baixas_outras
    FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
    LEFT JOIN CANCELAMENTO_TITULOS_RECEBER C WITH (NOLOCK)
      ON TX.TAB_MASTER_ORIGEM = 451661 AND C.CANCELAMENTO_TITULO_RECEBER = TX.REG_MASTER_ORIGEM
    WHERE TX.TITULO_RECEBER = ${coluna}
  ) SX`;

const CAMPOS_SITUACAO_TITULO = `
  SX.pendente        AS pendente,
  SX.recebido        AS recebido,
  SX.cancelado       AS cancelado,
  SX.estornos        AS estornos,
  SX.ultima_baixa    AS ultima_baixa,
  SX.baixas_despacho AS baixas_despacho,
  SX.baixas_bancos   AS baixas_bancos,
  SX.baixas_caixa    AS baixas_caixa,
  SX.baixas_cofre    AS baixas_cofre,
  SX.baixas_outras   AS baixas_outras,
  SX.cancelado_no_acerto    AS cancelado_no_acerto,
  SX.motivo_acerto          AS motivo_acerto,
  SX.cancelamento_acerto    AS cancelamento_acerto,
  SX.cancelado_no_acerto_em AS cancelado_no_acerto_em,
  SX.cancelamento_manual    AS cancelamento_manual,
  SX.motivo_manual          AS motivo_manual,
  SX.renegociado            AS renegociado,
  SX.renegociado_em         AS renegociado_em,
  SX.renegociacao           AS renegociacao`;

// Título que o acerto gerou para cada linha de _RESULTADOS (validado em out/2026, NF 10174):
//   - o PROCFIT às vezes cria o título mas NÃO grava a ligação em RESULTADOS.TITULO_RECEBER
//     (ex.: a sobra "10174/Parc", R$ 400,00 em aberto). Medido: 236 de 243 linhas sem ligação
//     tinham título; só 7 (R$ 4.079,78) ficaram sem título nenhum;
//   - na linha de PIX que aponta para o título da NOTA (cancelado no acerto), o título que
//     foi realmente pago é o novo, gerado pelo acerto (pago em Bancos por títulos).
// Por isso procura primeiro o título gerado pelo acerto (TAB_MASTER_ORIGEM 455510), com o
// mesmo nome e o mesmo cliente; se não houver, usa a ligação gravada pelo PROCFIT.
const TITULO_DO_ACERTO = `
  OUTER APPLY (
    SELECT TOP 1 T.TITULO_RECEBER
    FROM TITULOS_RECEBER T WITH (NOLOCK)
    WHERE T.ENTIDADE = RS.ENTIDADE
      AND T.TAB_MASTER_ORIGEM = 455510
      AND T.MODALIDADE = RS.MODALIDADE
      AND LTRIM(RTRIM(T.TITULO)) = LTRIM(RTRIM(RS.TITULO))
    ORDER BY CASE WHEN T.REG_MASTER_ORIGEM IN (RS.RECEBIMENTO_FATURAMENTO_DESPACHO,
                                               RS.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE)
                  THEN 0 ELSE 1 END,
             T.TITULO_RECEBER DESC
  ) TA`;

// Rastreio da última baixa (recebimento) do título: onde, nº do registro, valor, quem e a hora.
// Hora e usuário vêm do formulário que gravou a baixa (colunas já validadas no financeiro):
//   Bancos por títulos (668401) -> RECEBIMENTOS_BANCOS (DATA_HORA, USUARIO_LOGADO)
//   Caixa (356928)              -> RECEBIMENTOS_CAIXA (USUARIO_LOGADO; a hora fica só a data)
//   Retorno de despacho (455510)-> linha da nota no acerto -> acerto (nº e quem lançou)
const ULTIMA_BAIXA = (coluna) => `
  OUTER APPLY (
    SELECT TOP 1 TX.TAB_MASTER_ORIGEM AS tab, TX.REG_MASTER_ORIGEM AS reg, TX.DEBITO AS valor
    FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
    WHERE TX.TITULO_RECEBER = ${coluna} AND TX.TRANSACAO_FINANCEIRA = 12 AND ISNULL(TX.DEBITO, 0) > 0
    ORDER BY TX.DATA DESC
  ) BX
  LEFT JOIN RECEBIMENTOS_BANCOS BXB WITH (NOLOCK) ON BX.tab = 668401 AND BXB.RECEBIMENTO_BANCO = BX.reg
  LEFT JOIN RECEBIMENTOS_CAIXA BXC WITH (NOLOCK) ON BX.tab = 356928 AND BXC.RECEBIMENTO_CAIXA = BX.reg
  -- Retorno de despacho (455510): o registro é a LINHA da nota no acerto (_DETALHES); dela sai o nº do acerto
  LEFT JOIN ${D}_DETALHES BXD WITH (NOLOCK)
    ON BX.tab = 455510 AND BXD.RECEBIMENTO_FATURAMENTO_DESPACHO_DETALHE = BX.reg
  LEFT JOIN ${D} BXR WITH (NOLOCK)
    ON BXR.RECEBIMENTO_FATURAMENTO_DESPACHO = BXD.RECEBIMENTO_FATURAMENTO_DESPACHO
  LEFT JOIN USUARIOS BXU WITH (NOLOCK)
    ON BXU.USUARIO = COALESCE(BXB.USUARIO_LOGADO, BXC.USUARIO_LOGADO, BXR.USUARIO_LOGADO)`;

const CAMPOS_ULTIMA_BAIXA = `
  BX.reg                                    AS baixa_registro,
  BXR.RECEBIMENTO_FATURAMENTO_DESPACHO      AS baixa_acerto,
  BX.valor                                  AS baixa_valor,
  CONVERT(varchar(16), BXB.DATA_HORA, 120)  AS baixa_hora,
  ${NOME_USUARIO('BXU')}                    AS baixa_usuario`;

const CAMPOS_DO_ACERTO = `
  R.RECEBIMENTO_FATURAMENTO_DESPACHO                                  AS acerto,
  CONVERT(varchar(10), COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA), 23) AS data_recebimento,
  CONVERT(varchar(16), R.DATA_HORA, 120)                              AS digitado_em,
  R.USUARIO_LOGADO                                                    AS usuario,
  ${NOME_USUARIO('UL')}                                               AS usuario_nome,
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
      ${JUNCOES}
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
        ${NOME_USUARIO('UC')}                   AS carga_usuario_nome,
        FD.VEICULO                              AS veiculo,
        FD.RESPONSAVEL                          AS responsavel,
        LTRIM(RTRIM(ER.NOME))                   AS responsavel_nome
      FROM ${D} R WITH (NOLOCK)
      ${JUNCOES}
      -- Pessoas da carga: o conferente é quem criou o despacho (usuário) e o responsável (cadastro).
      -- Atenção: FATURAMENTO_DESPACHO.CONFERENTE aponta para a tabela CONFERENTES, NÃO para VENDEDORES
      -- (antes o painel cruzava com VENDEDORES e mostrava o nome errado, ex.: a vendedora nº 3).
      LEFT JOIN USUARIOS UC WITH (NOLOCK) ON UC.USUARIO = FD.USUARIO_LOGADO
      LEFT JOIN ENTIDADES ER WITH (NOLOCK) ON ER.ENTIDADE = FD.RESPONSAVEL
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
        COALESCE(TA.TITULO_RECEBER, RS.TITULO_RECEBER) AS titulo_receber,
        CASE WHEN RS.TITULO_RECEBER IS NULL AND TA.TITULO_RECEBER IS NOT NULL THEN 1 ELSE 0 END AS achado_pelo_nome,
        ${CAMPOS_SITUACAO_TITULO},
        ${CAMPOS_ULTIMA_BAIXA}
      FROM ${D}_RESULTADOS RS WITH (NOLOCK)
      ${TITULO_DO_ACERTO}
      ${SITUACAO_DO_TITULO('COALESCE(TA.TITULO_RECEBER, RS.TITULO_RECEBER)')}
      ${ULTIMA_BAIXA('COALESCE(TA.TITULO_RECEBER, RS.TITULO_RECEBER)')}
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
  const proc = await processamento(pool, [acerto]);
  cabecalho.processado_em = proc.porAcerto[acerto]?.processado_em ?? null;
  return {
    acerto: cabecalho, notas: recordsets[1], parcelas: recordsets[2], cartoes: recordsets[3],
    bancos: proc.bancos,
  };
}

// ===== Processamento do acerto (botão Processar do PROCFIT) =====
// O PROCFIT não grava "fim da conferência" e, nesta base, o log de inclusões está desligado
// (REG_LOG_INCLUSAO vazio; GERAL_LOG e LOG_FORMULARIOS sem linhas; TITULOS_RECEBER sem DATA_HORA).
// O momento do Processar é deduzido de dois registros que o próprio processamento grava:
//   - PIX: a hora em que o recebimento caiu em RECEBIMENTOS_BANCOS;
//   - dinheiro: a hora do cancelamento automático do título da nota (ver MOTIVO_ACERTO).
// Acerto só com boleto/cartão não deixa hora registrada.
// Regra validada: só o PIX (modalidade 11) gera recebimento em RECEBIMENTOS_BANCOS,
// com FORM_ORIGEM = 456558 (Conferência e Recebimento) e REG_ORIGEM = número do acerto.
//
// Estas consultas são "opcionais": se alguma falhar (ex.: nome de tabela diferente),
// a tela continua funcionando sem essa informação, em vez de dar erro.
async function opcional(pool, nome, consulta) {
  try {
    const { recordset } = await consulta(pool.request());
    return recordset;
  } catch (erro) {
    console.warn(`[despachos] consulta opcional "${nome}" falhou: ${erro.message}`);
    return [];
  }
}

async function processamento(pool, acertos) {
  const numeros = [...new Set(acertos.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!numeros.length) return { porAcerto: {}, bancos: [] };
  // Os números vêm do próprio banco e são validados como inteiros acima
  const lista = numeros.join(',');

  const bancos = await opcional(pool, 'recebimentos-bancos', (r) => r.query(`
    SELECT RB.REG_ORIGEM                                   AS acerto,
           RB.RECEBIMENTO_BANCO                            AS recebimento,
           CONVERT(varchar(16), RB.DATA_HORA, 120)         AS gravado_em,
           CONVERT(varchar(10), RB.DATA_RECEBIMENTO, 23)   AS data_recebimento,
           RB.CONTA_BANCARIA                               AS conta,
           RB.USUARIO_LOGADO                               AS usuario
    FROM RECEBIMENTOS_BANCOS RB WITH (NOLOCK)
    WHERE RB.FORM_ORIGEM = 456558 AND RB.REG_ORIGEM IN (${lista})
    ORDER BY RB.REG_ORIGEM, RB.RECEBIMENTO_BANCO;`));

  // Dinheiro: o cancelamento automático do título da nota marca a hora do Processar
  const textos = numeros.map((n) => `'${n}'`).join(',');
  const cancelamentos = await opcional(pool, 'cancelamentos-do-acerto', (r) => r.query(`
    SELECT X.acerto_txt AS acerto, CONVERT(varchar(16), MAX(X.DATA_HORA), 120) AS processado_em
    FROM (
      SELECT C.DATA_HORA,
             LTRIM(RTRIM(SUBSTRING(CAST(C.MOTIVO AS varchar(200)), CHARINDEX('Despacho:', CAST(C.MOTIVO AS varchar(200))) + 9, 20))) AS acerto_txt
      FROM CANCELAMENTO_TITULOS_RECEBER C WITH (NOLOCK)
      WHERE ${MOTIVO_ACERTO}
    ) X
    WHERE X.acerto_txt IN (${textos})
    GROUP BY X.acerto_txt;`));

  const porAcerto = {};
  for (const n of numeros) {
    const horas = [
      ...bancos.filter((x) => Number(x.acerto) === n).map((x) => x.gravado_em),
      ...cancelamentos.filter((x) => Number(x.acerto) === n).map((x) => x.processado_em),
    ].filter(Boolean).sort();
    porAcerto[n] = {
      processado_em: horas[horas.length - 1] ?? null,
      fonte: horas.length ? 'registro' : null,
    };
  }
  return { porAcerto, bancos };
}

// ===== Saída: as CARGAS que deixaram a empresa (FATURAMENTO_DESPACHO) =====
// FATURAMENTO_DESPACHO_NOTAS traz as notas que foram no caminhão (nota, cliente, pedido, valor, volume).
// O retorno (acerto) aponta para a carga em RECEBIMENTOS_FATURAMENTO_DESPACHO.FATURAMENTO_DESPACHO_FILTRO.
// Situação da carga: sem acerto = em rota; com acerto e todas as notas acertadas = acertada;
// com acerto e notas faltando = acertada em parte.
// Atenção: no SQL Server o WITH vale só para o comando logo depois dele.
// Por isso cada SELECT abaixo repete ${CARGAS} antes de usar essa base.
const CARGAS = `
  WITH NOTAS AS (
    SELECT FATURAMENTO_DESPACHO, COUNT(*) AS notas, SUM(ISNULL(NF_TOTAL, 0)) AS valor,
           SUM(ISNULL(VOLUME, 0)) AS volumes
    FROM FATURAMENTO_DESPACHO_NOTAS WITH (NOLOCK)
    GROUP BY FATURAMENTO_DESPACHO
  ),
  ACERTOS AS (
    SELECT R.FATURAMENTO_DESPACHO_FILTRO AS carga,
           COUNT(DISTINCT R.RECEBIMENTO_FATURAMENTO_DESPACHO) AS acertos,
           MIN(R.RECEBIMENTO_FATURAMENTO_DESPACHO)            AS primeiro_acerto,
           MAX(R.DATA_RECEBIMENTO)                            AS ultimo_recebimento,
           COUNT(DISTINCT DT.NF_NUMERO)                       AS notas_acertadas,
           SUM(ISNULL(DT.VALOR_PAGAMENTO, 0))                 AS informado,
           -- acerto lançado mas não processado = sem nenhuma linha em _RESULTADOS
           COUNT(DISTINCT CASE WHEN P.acerto IS NULL THEN R.RECEBIMENTO_FATURAMENTO_DESPACHO END) AS sem_processar
    FROM RECEBIMENTOS_FATURAMENTO_DESPACHO R WITH (NOLOCK)
    LEFT JOIN RECEBIMENTOS_FATURAMENTO_DESPACHO_DETALHES DT WITH (NOLOCK)
      ON DT.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
    LEFT JOIN (
      SELECT DISTINCT RECEBIMENTO_FATURAMENTO_DESPACHO AS acerto
      FROM RECEBIMENTOS_FATURAMENTO_DESPACHO_RESULTADOS WITH (NOLOCK)
    ) P ON P.acerto = R.RECEBIMENTO_FATURAMENTO_DESPACHO
    GROUP BY R.FATURAMENTO_DESPACHO_FILTRO
  ),
  CARGAS AS (
    SELECT
      FD.FATURAMENTO_DESPACHO                          AS carga,
      FD.EMPRESA                                       AS empresa,
      CONVERT(varchar(10), FD.DATA_HORA, 23)           AS saida,
      FD.DATA_HORA                                     AS saida_data,
      LTRIM(RTRIM(FD.ROTA))                            AS rota,
      FD.VEICULO                                       AS veiculo,
      CONVERT(varchar(16), FD.DATA_HORA, 120)          AS criado_em,
      FD.CONFERENTE                                    AS cod_conferente,
      -- Conferente = quem criou o despacho no PROCFIT (Despacho de Notas de Faturamento)
      COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS conferente,
      FD.RESPONSAVEL                                   AS cod_responsavel,
      LTRIM(RTRIM(ER.NOME))                            AS responsavel,
      FD.USUARIO_LOGADO                                AS usuario,
      COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome,
      ISNULL(N.notas, 0)                               AS notas,
      ISNULL(N.valor, 0)                               AS valor,
      ISNULL(N.volumes, 0)                             AS volumes,
      ISNULL(A.acertos, 0)                             AS acertos,
      A.primeiro_acerto                                AS acerto,
      CONVERT(varchar(10), A.ultimo_recebimento, 23)   AS recebimento,
      ISNULL(A.notas_acertadas, 0)                     AS notas_acertadas,
      ISNULL(A.informado, 0)                           AS informado,
      ISNULL(A.sem_processar, 0)                       AS acertos_sem_processar,
      CASE
        WHEN ISNULL(A.acertos, 0) = 0                         THEN 'EM_ROTA'
        WHEN ISNULL(A.notas_acertadas, 0) < ISNULL(N.notas, 0) THEN 'PARCIAL'
        ELSE                                                        'ACERTADA'
      END                                              AS situacao
    FROM FATURAMENTO_DESPACHO FD WITH (NOLOCK)
    LEFT JOIN NOTAS N ON N.FATURAMENTO_DESPACHO = FD.FATURAMENTO_DESPACHO
    LEFT JOIN ACERTOS A ON A.carga = FD.FATURAMENTO_DESPACHO
    LEFT JOIN ENTIDADES ER WITH (NOLOCK) ON ER.ENTIDADE = FD.RESPONSAVEL
    LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = FD.USUARIO_LOGADO
  )`;

const SITUACOES_CARGA = {
  EM_ROTA: 'situacao = \'EM_ROTA\'',
  PARCIAL: 'situacao = \'PARCIAL\'',
  ACERTADA: 'situacao = \'ACERTADA\'',
  NAO_PROC: 'acertos_sem_processar > 0',
};

async function cargas(filtros) {
  const pool = await getPool();
  const situacao = SITUACOES_CARGA[filtros.situacao] ?? '1 = 1';
  const { recordsets } = await pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio ?? null)
    .input('fim', sql.VarChar(10), filtros.fim ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null)
    .query(`
      ${CARGAS}
      SELECT
        COUNT(*)                                                          AS cargas,
        SUM(notas)                                                        AS notas,
        SUM(valor)                                                        AS valor,
        SUM(CASE WHEN situacao = 'EM_ROTA'  THEN 1 ELSE 0 END)             AS em_rota,
        SUM(CASE WHEN situacao = 'EM_ROTA'  THEN valor ELSE 0 END)         AS valor_em_rota,
        SUM(CASE WHEN situacao = 'PARCIAL'  THEN 1 ELSE 0 END)             AS parciais,
        SUM(CASE WHEN situacao = 'PARCIAL'  THEN valor - informado ELSE 0 END) AS valor_parcial,
        SUM(CASE WHEN situacao = 'ACERTADA' THEN 1 ELSE 0 END)             AS acertadas,
        SUM(CASE WHEN acertos_sem_processar > 0 THEN 1 ELSE 0 END)        AS nao_processados,
        SUM(informado)                                                    AS informado
      FROM CARGAS
      WHERE (@inicio IS NULL OR saida >= @inicio)
        AND (@fim IS NULL OR saida <= @fim)
        AND (@busca IS NULL
          OR CAST(carga AS varchar(20)) = @busca
          OR rota LIKE '%' + @busca + '%'
          OR conferente LIKE '%' + @busca + '%'
          OR responsavel LIKE '%' + @busca + '%');

      ${CARGAS}
      SELECT TOP 2000 *
      FROM CARGAS
      WHERE (@inicio IS NULL OR saida >= @inicio)
        AND (@fim IS NULL OR saida <= @fim)
        AND (@busca IS NULL
          OR CAST(carga AS varchar(20)) = @busca
          OR rota LIKE '%' + @busca + '%'
          OR conferente LIKE '%' + @busca + '%'
          OR responsavel LIKE '%' + @busca + '%')
        AND ${situacao}
      ORDER BY saida_data DESC, carga DESC;
    `);
  const lista = recordsets[1];
  await pagasForaDoAcerto(pool, lista);
  return { resumo: recordsets[0][0] ?? {}, lista };
}

// Notas que NÃO passaram pelo acerto do despacho, mas cujo título da nota já foi baixado
// em outro formulário (Bancos por títulos, caixa, cofre...). Mostra os despachos que
// parecem "em rota" mas já foram pagos por fora, sem lançar o retorno.
//   nota fora do acerto = não tem valor informado em nenhum acerto do próprio despacho
//   título da nota      = TAB_MASTER_ORIGEM 753289, mesmo cliente, TITULO "nota/parcela"
//   pago fora           = recebimento (transação 12) gravado fora do retorno de despacho (455510)
// Consulta opcional: se falhar, a lista aparece normalmente, só sem essas colunas.
async function pagasForaDoAcerto(pool, lista) {
  const numeros = [...new Set(lista.map((c) => Number(c.carga)).filter((n) => Number.isInteger(n) && n > 0))];
  if (!numeros.length) return;
  const linhas = await opcional(pool, 'pagas-fora-do-acerto', (r) => r.query(`
    WITH N AS (
      SELECT FDN.FATURAMENTO_DESPACHO AS carga, FDN.NF_NUMERO, FDN.ENTIDADE
      FROM FATURAMENTO_DESPACHO_NOTAS FDN WITH (NOLOCK)
      WHERE FDN.FATURAMENTO_DESPACHO IN (${numeros.join(',')})
        AND NOT EXISTS (
          SELECT 1
          FROM ${D}_DETALHES DT WITH (NOLOCK)
          JOIN ${D} R WITH (NOLOCK) ON R.RECEBIMENTO_FATURAMENTO_DESPACHO = DT.RECEBIMENTO_FATURAMENTO_DESPACHO
          WHERE R.FATURAMENTO_DESPACHO_FILTRO = FDN.FATURAMENTO_DESPACHO
            AND DT.NF_NUMERO = FDN.NF_NUMERO
            AND ISNULL(DT.VALOR_PAGAMENTO, 0) > 0)
    ),
    T AS (
      SELECT N.carga, N.NF_NUMERO,
             SUM(CASE WHEN TR.TAB_MASTER_ORIGEM = 753289 THEN ISNULL(S.pendente, 0) ELSE 0 END) AS nf_pendente,
             SUM(ISNULL(S.pendente, 0))      AS pendente,
             SUM(ISNULL(S.recebido_fora, 0)) AS recebido_fora,
             SUM(ISNULL(S.renegociado, 0))   AS renegociado
      FROM N
      JOIN TITULOS_RECEBER TR WITH (NOLOCK)
        ON TR.TAB_MASTER_ORIGEM IN (753289, 650512)
       AND TR.ENTIDADE = N.ENTIDADE
       AND LTRIM(RTRIM(TR.TITULO)) LIKE CAST(CAST(N.NF_NUMERO AS bigint) AS varchar(20)) + '/%'
      OUTER APPLY (
        SELECT SUM(ISNULL(X.CREDITO, 0)) - SUM(ISNULL(X.DEBITO, 0)) AS pendente,
               SUM(CASE WHEN X.TRANSACAO_FINANCEIRA = 12 AND ISNULL(X.TAB_MASTER_ORIGEM, 0) <> 455510
                        THEN ISNULL(X.DEBITO, 0) ELSE 0 END)       AS recebido_fora,
               SUM(CASE WHEN X.TRANSACAO_FINANCEIRA = 43 THEN ISNULL(X.DEBITO, 0) ELSE 0 END) AS renegociado
        FROM TITULOS_RECEBER_TRANSACOES X WITH (NOLOCK)
        WHERE X.TITULO_RECEBER = TR.TITULO_RECEBER
      ) S
      GROUP BY N.carga, N.NF_NUMERO
    )
    SELECT Q.carga,
           Q.notas_sem_acerto,
           ISNULL(A.notas_pagas_fora, 0)  AS notas_pagas_fora,
           ISNULL(A.notas_parciais_fora, 0) AS notas_parciais_fora,
           ISNULL(A.valor_pago_fora, 0)   AS valor_pago_fora,
           ISNULL(A.valor_aberto, 0)      AS valor_aberto_sem_acerto,
           ISNULL(A.notas_resolvidas, 0)  AS notas_resolvidas,
           ISNULL(A.notas_renegociadas, 0) AS notas_renegociadas
    FROM (SELECT carga, COUNT(*) AS notas_sem_acerto FROM N GROUP BY carga) Q
    LEFT JOIN (
      SELECT carga,
             SUM(CASE WHEN recebido_fora > 0.009 AND pendente <= 0.009 THEN 1 ELSE 0 END) AS notas_pagas_fora,
             SUM(CASE WHEN recebido_fora > 0.009 AND pendente > 0.009 THEN 1 ELSE 0 END)  AS notas_parciais_fora,
             SUM(recebido_fora)                                                          AS valor_pago_fora,
             SUM(CASE WHEN pendente > 0.009 THEN pendente ELSE 0 END)                    AS valor_aberto,
             -- nota resolvida fora do acerto: o título da NOTA foi zerado (pago, renegociado...)
             SUM(CASE WHEN nf_pendente <= 0.009 THEN 1 ELSE 0 END)                       AS notas_resolvidas,
             SUM(CASE WHEN renegociado > 0.009 THEN 1 ELSE 0 END)                        AS notas_renegociadas
      FROM T GROUP BY carga
    ) A ON A.carga = Q.carga;`));
  const porCarga = new Map(linhas.map((l) => [Number(l.carga), l]));
  for (const c of lista) {
    const l = porCarga.get(Number(c.carga));
    c.notas_sem_acerto = l ? Number(l.notas_sem_acerto) : 0;
    c.notas_pagas_fora = l ? Number(l.notas_pagas_fora) : 0;
    c.notas_parciais_fora = l ? Number(l.notas_parciais_fora) : 0;
    c.valor_pago_fora = l ? Number(l.valor_pago_fora) : 0;
    c.valor_aberto_sem_acerto = l ? Number(l.valor_aberto_sem_acerto) : 0;
    c.notas_resolvidas = l ? Number(l.notas_resolvidas) : 0;
    c.notas_renegociadas = l ? Number(l.notas_renegociadas) : 0;
  }
}

// Despachos que saíram e ainda NÃO têm acerto (pendentes de recebimento), para a aba Retorno.
// Não usam a data de início do período: pendência antiga continua pendência. Só a data
// final vale (saída até o fim do período) e a pesquisa.
async function pendentes(filtros) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('fim', sql.VarChar(10), filtros.fim ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null)
    .query(`
      ${CARGAS}
      SELECT TOP 2000 *
      FROM CARGAS
      WHERE situacao = 'EM_ROTA'
        AND (@fim IS NULL OR saida <= @fim)
        AND (@busca IS NULL
          OR CAST(carga AS varchar(20)) = @busca
          OR rota LIKE '%' + @busca + '%'
          OR conferente LIKE '%' + @busca + '%'
          OR responsavel LIKE '%' + @busca + '%')
      ORDER BY saida_data DESC, carga DESC;
    `);
  await pagasForaDoAcerto(pool, recordset);
  return recordset;
}

// As notas que saíram numa carga, marcando as que já voltaram acertadas
async function notasDaCarga(carga) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('carga', sql.Int, carga)
    .query(`
      ${CARGAS}
      SELECT * FROM CARGAS WHERE carga = @carga;

      SELECT
        FDN.NF_NUMERO                          AS nota,
        FDN.ENTIDADE                           AS cod_cliente,
        LTRIM(RTRIM(E.NOME))                   AS cliente,
        FDN.PEDIDO_PREVENDA                    AS pedido,
        FDN.NF_TOTAL                           AS valor,
        FDN.VOLUME                             AS volume,
        AC.informado                           AS informado,
        AC.acerto                              AS acerto
      FROM FATURAMENTO_DESPACHO_NOTAS FDN WITH (NOLOCK)
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = FDN.ENTIDADE
      OUTER APPLY (
        SELECT SUM(ISNULL(DT.VALOR_PAGAMENTO, 0)) AS informado,
               MAX(DT.RECEBIMENTO_FATURAMENTO_DESPACHO) AS acerto
        FROM RECEBIMENTOS_FATURAMENTO_DESPACHO_DETALHES DT WITH (NOLOCK)
        JOIN RECEBIMENTOS_FATURAMENTO_DESPACHO R WITH (NOLOCK)
          ON R.RECEBIMENTO_FATURAMENTO_DESPACHO = DT.RECEBIMENTO_FATURAMENTO_DESPACHO
        WHERE R.FATURAMENTO_DESPACHO_FILTRO = @carga AND DT.NF_NUMERO = FDN.NF_NUMERO
      ) AC
      WHERE FDN.FATURAMENTO_DESPACHO = @carga
      ORDER BY FDN.NF_NUMERO;

      -- 3) Recebimentos de despacho (acertos) desta carga: abertura, quem lançou e totais
      SELECT
        R.RECEBIMENTO_FATURAMENTO_DESPACHO              AS acerto,
        CONVERT(varchar(16), R.DATA_HORA, 120)          AS aberto_em,
        CONVERT(varchar(10), R.DATA_RECEBIMENTO, 23)    AS data_recebimento,
        R.USUARIO_LOGADO                                AS usuario,
        ${NOME_USUARIO('UL')}                           AS usuario_nome,
        ISNULL(IT.informado, 0)                         AS informado,
        ISNULL(PT.parcelas, 0)                          AS parcelas,
        ISNULL(PT.total_parcelas, 0)                    AS total_parcelas
      FROM ${D} R WITH (NOLOCK)
      LEFT JOIN USUARIOS UL WITH (NOLOCK) ON UL.USUARIO = R.USUARIO_LOGADO
      OUTER APPLY (
        SELECT SUM(ISNULL(DT.VALOR_PAGAMENTO, 0)) AS informado
        FROM ${D}_DETALHES DT WITH (NOLOCK)
        WHERE DT.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
      ) IT
      OUTER APPLY (
        SELECT COUNT(*) AS parcelas, SUM(RS.VALOR) AS total_parcelas
        FROM ${D}_RESULTADOS RS WITH (NOLOCK)
        WHERE RS.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
      ) PT
      WHERE R.FATURAMENTO_DESPACHO_FILTRO = @carga
      ORDER BY R.RECEBIMENTO_FATURAMENTO_DESPACHO;
    `);

  // Títulos de cada nota da carga (nasceram da NF), com a situação e onde foram baixados.
  // Serve para ver onde o título está sendo baixado mesmo quando o despacho não tem acerto.
  // A nota se liga ao título pelo número: TITULO = "nota/parcela". Origens incluídas:
  //   753289 título da nota fiscal (ver financeiro.repository.js)
  //   650512 renegociação: as parcelas novas que substituíram o título da nota
  //          (validado em out/2026, NF 11610: 4 boletos trocados por entrada + 31 parcelas)
  // Consulta opcional.
  const titulosDasNotas = await opcional(pool, 'titulos-das-notas', (r) => r
    .input('carga', sql.Int, carga)
    .query(`
      SELECT
        FDN.NF_NUMERO                           AS nota,
        T.TITULO_RECEBER                        AS titulo_receber,
        LTRIM(RTRIM(T.TITULO))                  AS titulo,
        T.MODALIDADE                            AS modalidade,
        T.VALOR                                 AS valor,
        CONVERT(varchar(10), T.VENCIMENTO, 23)  AS vencimento,
        T.TAB_MASTER_ORIGEM                     AS origem,
        ${CAMPOS_SITUACAO_TITULO},
        ${CAMPOS_ULTIMA_BAIXA}
      FROM FATURAMENTO_DESPACHO_NOTAS FDN WITH (NOLOCK)
      JOIN TITULOS_RECEBER T WITH (NOLOCK)
        ON T.TAB_MASTER_ORIGEM IN (753289, 650512)
       AND T.ENTIDADE = FDN.ENTIDADE
       AND LTRIM(RTRIM(T.TITULO)) LIKE CAST(CAST(FDN.NF_NUMERO AS bigint) AS varchar(20)) + '/%'
      ${SITUACAO_DO_TITULO('T.TITULO_RECEBER')}
      ${ULTIMA_BAIXA('T.TITULO_RECEBER')}
      WHERE FDN.FATURAMENTO_DESPACHO = @carga
      ORDER BY FDN.NF_NUMERO, CASE WHEN T.TAB_MASTER_ORIGEM = 753289 THEN 0 ELSE 1 END, T.VENCIMENTO, T.TITULO;`));

  const acertos = recordsets[2];
  const proc = await processamento(pool, acertos.map((a) => a.acerto));
  for (const a of acertos) {
    const p = proc.porAcerto[Number(a.acerto)] ?? {};
    a.processado_em = p.processado_em ?? null;
    a.processado_fonte = p.fonte ?? null;
  }
  return {
    carga: recordsets[0][0] ?? null,
    notas: recordsets[1],
    acertos,
    bancos: proc.bancos,
    titulosDasNotas,
  };
}

module.exports = { lista, detalhe, cargas, notasDaCarga, pendentes, SITUACOES_CARGA };
