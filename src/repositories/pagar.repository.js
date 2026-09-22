// Camada de dados do CONTAS A PAGAR (TITULOS_PAGAR).
//
// Validado com dados reais (set/2026, últimos 12 meses de TITULOS_PAGAR_TRANSACOES):
// - Um título é UMA PARCELA (mesma ideia do contas a receber).
// - O extrato do título tem o MESMO sinal do receber: CREDITO aumenta o que a empresa
//   deve, DEBITO diminui.
//     pendente = soma(CREDITO) - soma(DEBITO)
// - TRANSACAO_FINANCEIRA (tabela TRANSACOES_FINANCEIRAS) usadas no pagar:
//     1 = valor original (crédito)          11 = PAGAMENTO (débito)
//     2 = abatimento   3 = desconto recebido no pagamento (débito)
//     4..8, 14, 15 = retenções de impostos (PIS, COFINS, INSS, IRRF, ISS, COPICS, CSSL)
//     9 = juros   10 = multa (crédito)
//     24, 33 = cancelamento de título a pagar (débito)
//     22 encontro de contas, 23 fechamento de fatura, 60 renegociação, 61 alteração de vencimento

const { sql, getPool } = require('../config/db');

// Atenção: no SQL Server, um WITH (CTE) vale só para o comando logo depois dele.
// Por isso cada consulta do painel abaixo repete ${SALDOS} antes do seu SELECT.
const SALDOS = `
  WITH SALDOS AS (
    SELECT
      TX.TITULO_PAGAR,
      SUM(ISNULL(TX.CREDITO, 0)) - SUM(ISNULL(TX.DEBITO, 0))                                 AS PENDENTE,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 11 THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)       AS PAGO,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA IN (2, 3) THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)  AS DESCONTOS,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA IN (4, 5, 6, 7, 8, 14, 15)
               THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)                                         AS RETENCOES,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA IN (9, 10) THEN ISNULL(TX.CREDITO, 0) ELSE 0 END) AS JUROS_MULTA,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA IN (24, 33) THEN ISNULL(TX.DEBITO, 0) ELSE 0 END) AS CANCELADO,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 11 THEN TX.DATA END)                           AS ULTIMO_PAGAMENTO
    FROM TITULOS_PAGAR_TRANSACOES TX WITH (NOLOCK)
    GROUP BY TX.TITULO_PAGAR
  ),
  TITULOS AS (
    SELECT
      T.TITULO_PAGAR                          AS id,
      T.EMPRESA                               AS empresa,
      LTRIM(RTRIM(T.TITULO))                  AS titulo,
      T.ENTIDADE                              AS cod_fornecedor,
      LTRIM(RTRIM(E.NOME))                    AS fornecedor,
      CASE T.MODALIDADE
        WHEN 0  THEN 'Carteira'      WHEN 1  THEN 'Boleto'
        WHEN 2  THEN 'Depósito'      WHEN 3  THEN 'Cheque'
        WHEN 4  THEN 'Dinheiro'      WHEN 5  THEN 'Débito em conta'
        WHEN 6  THEN 'Cartão crédito' WHEN 7  THEN 'Promissória'
        WHEN 11 THEN 'PIX'           WHEN 12 THEN 'Cartão débito'
        ELSE CASE WHEN T.MODALIDADE IS NULL THEN NULL ELSE CONCAT('Forma ', T.MODALIDADE) END
      END                                     AS forma,
      CONVERT(varchar(10), T.EMISSAO, 23)     AS emissao,
      CONVERT(varchar(10), T.VENCIMENTO, 23)  AS vencimento,
      T.VENCIMENTO                            AS vencimento_data,
      DATEDIFF(day, T.VENCIMENTO, CAST(GETDATE() AS date)) AS dias_atraso,
      T.VALOR                                 AS valor,
      S.PAGO                                  AS pago,
      S.DESCONTOS                             AS descontos,
      S.RETENCOES                             AS retencoes,
      S.JUROS_MULTA                           AS juros_multa,
      S.PENDENTE                              AS pendente,
      CONVERT(varchar(10), S.ULTIMO_PAGAMENTO, 23) AS ultimo_pagamento,
      CASE
        WHEN S.PENDENTE > 0.009 AND S.PAGO > 0.009 THEN 'PARCIAL'
        WHEN S.PENDENTE > 0.009                    THEN 'ABERTO'
        WHEN S.CANCELADO > 0.009 AND S.PAGO <= 0.009 THEN 'CANCELADO'
        ELSE                                            'PAGO'
      END                                     AS situacao
    FROM TITULOS_PAGAR T WITH (NOLOCK)
    JOIN SALDOS S ON S.TITULO_PAGAR = T.TITULO_PAGAR
    LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
  )`;

// Filtro de período (vencimento) e pesquisa: valem para tudo na tela
const FILTRO_BASE = `
  (@inicio IS NULL OR vencimento_data >= CAST(@inicio AS date))
  AND (@fim IS NULL OR vencimento_data < DATEADD(day, 1, CAST(@fim AS date)))
  AND (@busca IS NULL
    OR titulo LIKE '%' + @busca + '%'
    OR CAST(cod_fornecedor AS varchar(20)) = @busca
    OR fornecedor LIKE '%' + @busca + '%')`;

// Só a pesquisa (para blocos que olham o futuro inteiro, sem o período da tela)
const FILTRO_BUSCA = `
  (@busca IS NULL
    OR titulo LIKE '%' + @busca + '%'
    OR CAST(cod_fornecedor AS varchar(20)) = @busca
    OR fornecedor LIKE '%' + @busca + '%')`;

// Cartão escolhido na tela
const FILTRO_SITUACAO = {
  aberto: 'pendente > 0.009',
  vencidos: 'pendente > 0.009 AND dias_atraso > 0',
  '7dias': 'pendente > 0.009 AND dias_atraso BETWEEN -7 AND 0',
  '30dias': 'pendente > 0.009 AND dias_atraso BETWEEN -30 AND 0',
  pago: "situacao = 'PAGO'",
};

// Colunas que a lista aceita ordenar (lista fechada: o texto da tela nunca vai para o SQL)
const ORDENACAO = {
  vencimento: 'vencimento_data',
  titulo: 'titulo',
  fornecedor: 'fornecedor COLLATE Latin1_General_CI_AI',
  forma: 'forma',
  valor: 'valor',
  pago: 'pago',
  pendente: 'pendente',
};

const LIMITE_LISTA = 5000;

function criarRequest(pool, filtros) {
  return pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio ?? null)
    .input('fim', sql.VarChar(10), filtros.fim ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null);
}

async function painel(filtros) {
  const pool = await getPool();
  const situacao = FILTRO_SITUACAO[filtros.situacao] ?? FILTRO_SITUACAO.aberto;
  const coluna = ORDENACAO[filtros.ordem] ?? 'vencimento_data';
  const direcao = filtros.direcao === 'desc' ? 'DESC' : 'ASC';

  const { recordsets } = await criarRequest(pool, filtros).query(`
    ${SALDOS}
    -- 1) Resumo (período e pesquisa, sem o cartão): valores de todos os cartões
    SELECT
      SUM(CASE WHEN pendente > 0.009 THEN pendente ELSE 0 END)                         AS aberto,
      COUNT(CASE WHEN pendente > 0.009 THEN 1 END)                                     AS aberto_titulos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso > 0 THEN pendente ELSE 0 END)     AS vencido,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso > 0 THEN 1 END)                 AS vencido_titulos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN -7 AND 0 THEN pendente ELSE 0 END)  AS proximos_7,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN -7 AND 0 THEN 1 END)              AS proximos_7_titulos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN -30 AND 0 THEN pendente ELSE 0 END) AS proximos_30,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN -30 AND 0 THEN 1 END)             AS proximos_30_titulos,
      SUM(CASE WHEN situacao = 'PAGO' THEN pago ELSE 0 END)                            AS pago,
      COUNT(CASE WHEN situacao = 'PAGO' THEN 1 END)                                    AS pago_titulos,
      COUNT(DISTINCT CASE WHEN pendente > 0.009 THEN cod_fornecedor END)               AS fornecedores,
      -- Aging do vencido (faixas de dias de atraso)
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN 1 AND 30 THEN pendente ELSE 0 END)  AS atraso_1_30,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN 1 AND 30 THEN 1 END)              AS atraso_1_30_titulos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN 31 AND 60 THEN pendente ELSE 0 END) AS atraso_31_60,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN 31 AND 60 THEN 1 END)             AS atraso_31_60_titulos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN 61 AND 90 THEN pendente ELSE 0 END) AS atraso_61_90,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso BETWEEN 61 AND 90 THEN 1 END)             AS atraso_61_90_titulos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso > 90 THEN pendente ELSE 0 END)              AS atraso_90,
      COUNT(CASE WHEN pendente > 0.009 AND dias_atraso > 90 THEN 1 END)                          AS atraso_90_titulos
    FROM TITULOS
    WHERE ${FILTRO_BASE};

    ${SALDOS}
    -- 2) Previsão por semana (em aberto): vencidos numa linha só, depois as próximas 12 semanas.
    --    Semana = segunda-feira (01/01/1900 foi segunda: não depende da configuração do servidor)
    SELECT semana, COUNT(*) AS titulos, SUM(pendente) AS pendente
    FROM (
      SELECT pendente,
        CASE WHEN dias_atraso > 0 THEN 'VENCIDO'
             ELSE CONVERT(varchar(10), DATEADD(day,
                    -(DATEDIFF(day, '19000101', CAST(vencimento_data AS date)) % 7),
                    CAST(vencimento_data AS date)), 23)
        END AS semana
      FROM TITULOS
      WHERE ${FILTRO_BASE} AND pendente > 0.009
        AND vencimento_data < DATEADD(week, 12, CAST(GETDATE() AS date))
    ) P
    GROUP BY semana
    ORDER BY CASE WHEN semana = 'VENCIDO' THEN 0 ELSE 1 END, semana;

    ${SALDOS}
    -- 3) Maiores fornecedores em aberto
    SELECT TOP 10
      cod_fornecedor,
      MAX(fornecedor)              AS fornecedor,
      COUNT(*)                     AS titulos,
      SUM(pendente)                AS pendente,
      SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END) AS vencido
    FROM TITULOS
    WHERE ${FILTRO_BASE} AND pendente > 0.009
    GROUP BY cod_fornecedor
    ORDER BY SUM(pendente) DESC;

    ${SALDOS}
    -- 4) Lista de títulos do cartão escolhido
    SELECT TOP (${LIMITE_LISTA})
      id, empresa, titulo, cod_fornecedor, fornecedor, forma, emissao, vencimento, dias_atraso,
      valor, pago, descontos, retencoes, juros_multa, pendente, ultimo_pagamento, situacao
    FROM TITULOS
    WHERE ${FILTRO_BASE} AND ${situacao}
    ORDER BY ${[`${coluna} ${direcao}`, ...['vencimento_data', 'titulo'].filter((c) => c !== coluna)].join(', ')};

    ${SALDOS}
    -- 5) Saúde das baixas: por mês de vencimento (últimos 6 meses até o mês atual),
    --    quanto JÁ venceu e quanto disso continua sem baixa. Mês com pouca baixa
    --    = pagamento feito no banco e ainda não lançado no PROCFIT.
    SELECT
      CONVERT(varchar(7), vencimento_data, 120)                                  AS mes,
      SUM(valor)                                                                 AS lancado,
      SUM(pago)                                                                  AS pago,
      SUM(CASE WHEN dias_atraso >= 0 THEN valor ELSE 0 END)                      AS ja_venceu,
      SUM(CASE WHEN dias_atraso > 0 AND pendente > 0.009 THEN pendente ELSE 0 END) AS vencido_sem_baixa
    FROM TITULOS
    WHERE ${FILTRO_BUSCA}
      AND vencimento_data >= DATEADD(month, -5, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
      AND vencimento_data <  DATEADD(month, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
    GROUP BY CONVERT(varchar(7), vencimento_data, 120)
    ORDER BY 1;

    ${SALDOS}
    -- 6) Onde o dinheiro vai: grupo (formato DRE) e categoria, pelo rateio de cada título.
    --    Em aberto = parte do pendente proporcional ao valor da categoria no título.
    SELECT
      COALESCE(LTRIM(RTRIM(G.DESCRICAO)), 'Sem grupo')                  AS grupo,
      CF.CLASSIF_FINANCEIRA                                             AS categoria_id,
      COALESCE(LTRIM(RTRIM(CF.DESCRICAO)), CONCAT('Categoria ', C.CLASSIF_FINANCEIRA)) AS categoria,
      COUNT(DISTINCT T.id)                                              AS titulos,
      SUM(C.VALOR)                                                      AS lancado,
      SUM(CASE WHEN T.valor > 0 THEN C.VALOR / T.valor * T.pendente ELSE 0 END) AS aberto
    FROM TITULOS T
    JOIN TITULOS_PAGAR_CLASSIFICACOES C WITH (NOLOCK) ON C.TITULO_PAGAR = T.id
    LEFT JOIN CLASSIF_FINANCEIRAS CF WITH (NOLOCK) ON CF.CLASSIF_FINANCEIRA = C.CLASSIF_FINANCEIRA
    LEFT JOIN CLASSIF_FINANCEIRAS_GRUPOS G WITH (NOLOCK) ON G.CLASSIF_FINANCEIRA_GRUPO = CF.CLASSIF_FINANCEIRA_GRUPO
    WHERE ${FILTRO_BASE}
    GROUP BY G.DESCRICAO, CF.CLASSIF_FINANCEIRA, CF.DESCRICAO, C.CLASSIF_FINANCEIRA
    ORDER BY SUM(C.VALOR) DESC;

    ${SALDOS}
    -- 7) Compromissos de longo prazo: o que vence daqui a mais de 12 meses, por ano
    SELECT YEAR(vencimento_data) AS ano, COUNT(*) AS titulos, SUM(pendente) AS pendente
    FROM TITULOS
    WHERE ${FILTRO_BUSCA} AND pendente > 0.009
      AND vencimento_data >= DATEADD(month, 12, CAST(GETDATE() AS date))
    GROUP BY YEAR(vencimento_data)
    ORDER BY 1;

    ${SALDOS}
    -- 8) ...e de quem são esses compromissos (até quando vão)
    SELECT TOP 5
      cod_fornecedor, MAX(fornecedor) AS fornecedor, COUNT(*) AS titulos, SUM(pendente) AS pendente,
      CONVERT(varchar(10), MAX(vencimento_data), 23) AS ultimo_vencimento
    FROM TITULOS
    WHERE ${FILTRO_BUSCA} AND pendente > 0.009
      AND vencimento_data >= DATEADD(month, 12, CAST(GETDATE() AS date))
    GROUP BY cod_fornecedor
    ORDER BY SUM(pendente) DESC;
  `);

  return {
    resumo: recordsets[0][0] ?? {},
    previsao: recordsets[1],
    fornecedores: recordsets[2],
    titulos: recordsets[3],
    baixas: recordsets[4],
    categorias: recordsets[5],
    longo_prazo: { anos: recordsets[6], credores: recordsets[7] },
    limite: LIMITE_LISTA,
  };
}

// Pagamentos lançados, com QUEM lançou e por onde (caixa ou banco).
// A transação de pagamento (11) aponta para a tela que a gerou:
//   TAB_MASTER_ORIGEM 186377 -> PAGAMENTOS_CAIXA        (pagamento pelo caixa, valores pequenos)
//   TAB_MASTER_ORIGEM 258    -> PAGAMENTOS_ESCRITURAIS  (baixa pelo banco, com conta bancária)
// e REG_MASTER_ORIGEM é o código do registro nessa tela (amostra de set/2026: 274, 277, 281).
// As duas telas guardam USUARIO_LOGADO, DATA_HORA (quando foi lançado) e DATA_PAGAMENTO.
// Atraso de lançamento = dias entre o pagamento e o lançamento no PROCFIT.
const TAB_PAGAMENTO_CAIXA = 186377;
const TAB_PAGAMENTO_BANCO = 258;

async function pagamentos(filtros) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('busca', sql.VarChar(60), filtros.busca ?? null)
    .query(`
      SELECT
        TX.TITULO_PAGAR                                         AS id,
        LTRIM(RTRIM(T.TITULO))                                  AS titulo,
        T.ENTIDADE                                              AS cod_fornecedor,
        LTRIM(RTRIM(E.NOME))                                    AS fornecedor,
        CONVERT(varchar(10), TX.DATA, 23)                       AS data_pagamento,
        TX.DEBITO                                               AS valor,
        CASE WHEN PC.PAGAMENTO_CAIXA IS NOT NULL THEN 'Caixa'
             WHEN PE.PAGAMENTO_ESCRITURAL IS NOT NULL THEN 'Banco'
             ELSE 'Não identificado' END                        AS canal,
        COALESCE(PC.USUARIO_LOGADO, PE.USUARIO_LOGADO)          AS usuario,
        COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome,
        CONVERT(varchar(16), COALESCE(PC.DATA_HORA, PE.DATA_HORA), 120) AS lancado_em,
        DATEDIFF(day, CAST(TX.DATA AS date), CAST(COALESCE(PC.DATA_HORA, PE.DATA_HORA) AS date)) AS dias_para_lancar,
        PE.CONTA_BANCARIA                                       AS conta_bancaria,
        0                                                       AS aguardando_baixa,
        CASE T.MODALIDADE WHEN 0 THEN 'Carteira' WHEN 1 THEN 'Boleto' WHEN 2 THEN 'Depósito' WHEN 3 THEN 'Cheque'
          WHEN 4 THEN 'Dinheiro' WHEN 5 THEN 'Débito em conta' WHEN 6 THEN 'Cartão crédito' WHEN 11 THEN 'PIX'
          WHEN 12 THEN 'Cartão débito' ELSE 'Outra' END                 AS forma,
        T.VALOR                                                 AS valor_titulo,
        CONVERT(varchar(10), T.VENCIMENTO, 23)                  AS vencimento,
        SP.PENDENTE                                             AS pendente_atual,
        CAT.categoria,
        CAT.grupo
      FROM TITULOS_PAGAR_TRANSACOES TX WITH (NOLOCK)
      JOIN TITULOS_PAGAR T WITH (NOLOCK) ON T.TITULO_PAGAR = TX.TITULO_PAGAR
      LEFT JOIN PAGAMENTOS_CAIXA PC WITH (NOLOCK)
        ON TX.TAB_MASTER_ORIGEM = ${TAB_PAGAMENTO_CAIXA} AND PC.PAGAMENTO_CAIXA = TX.REG_MASTER_ORIGEM
      LEFT JOIN PAGAMENTOS_ESCRITURAIS PE WITH (NOLOCK)
        ON TX.TAB_MASTER_ORIGEM = ${TAB_PAGAMENTO_BANCO} AND PE.PAGAMENTO_ESCRITURAL = TX.REG_MASTER_ORIGEM
      -- Da tabela de usuários, só NOME e LOGIN (ela guarda senhas)
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = COALESCE(PC.USUARIO_LOGADO, PE.USUARIO_LOGADO)
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
      -- Quanto do título ainda falta pagar hoje (mesma regra da tela: crédito - débito)
      OUTER APPLY (
        SELECT SUM(ISNULL(X.CREDITO, 0)) - SUM(ISNULL(X.DEBITO, 0)) AS PENDENTE
        FROM TITULOS_PAGAR_TRANSACOES X WITH (NOLOCK)
        WHERE X.TITULO_PAGAR = TX.TITULO_PAGAR
      ) SP
      -- Categoria principal do título (a de maior valor no rateio) e o grupo dela
      OUTER APPLY (
        SELECT TOP 1
          COALESCE(LTRIM(RTRIM(CF.DESCRICAO)), CONCAT('Categoria ', C.CLASSIF_FINANCEIRA)) AS categoria,
          COALESCE(LTRIM(RTRIM(G.DESCRICAO)), 'Sem grupo') AS grupo
        FROM TITULOS_PAGAR_CLASSIFICACOES C WITH (NOLOCK)
        LEFT JOIN CLASSIF_FINANCEIRAS CF WITH (NOLOCK) ON CF.CLASSIF_FINANCEIRA = C.CLASSIF_FINANCEIRA
        LEFT JOIN CLASSIF_FINANCEIRAS_GRUPOS G WITH (NOLOCK) ON G.CLASSIF_FINANCEIRA_GRUPO = CF.CLASSIF_FINANCEIRA_GRUPO
        WHERE C.TITULO_PAGAR = TX.TITULO_PAGAR
        ORDER BY C.VALOR DESC
      ) CAT
      WHERE TX.TRANSACAO_FINANCEIRA = 11
        AND TX.DATA >= CAST(@inicio AS date)
        AND TX.DATA <  DATEADD(day, 1, CAST(@fim AS date))
        AND (@busca IS NULL
          OR T.TITULO LIKE '%' + @busca + '%'
          OR CAST(T.ENTIDADE AS varchar(20)) = @busca
          OR E.NOME LIKE '%' + @busca + '%')

      UNION ALL

      -- Enviados ao banco (PAGAMENTOS_ESCRITURAIS) e ainda SEM baixa no PROCFIT.
      -- Validado em set/2026: a pessoa continua enviando os lotes, mas a baixa pelo banco
      -- (origem 258) parou em agosto. Sem esta parte, o caixa de quem paga pelo banco fica vazio.
      -- Se o título foi enviado em mais de um lote, vale o lote mais recente.
      SELECT
        EB.TITULO_PAGAR, LTRIM(RTRIM(T.TITULO)), T.ENTIDADE, LTRIM(RTRIM(E.NOME)),
        CONVERT(varchar(10), EB.DATA_PAGAMENTO, 23),
        EB.PAGAMENTO_TOTAL,
        'Banco (aguardando baixa)',
        EB.USUARIO_LOGADO,
        COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))),
        CONVERT(varchar(16), EB.DATA_HORA, 120),
        NULL,
        EB.CONTA_BANCARIA,
        1,
        CASE T.MODALIDADE WHEN 0 THEN 'Carteira' WHEN 1 THEN 'Boleto' WHEN 2 THEN 'Depósito' WHEN 3 THEN 'Cheque'
          WHEN 4 THEN 'Dinheiro' WHEN 5 THEN 'Débito em conta' WHEN 6 THEN 'Cartão crédito' WHEN 11 THEN 'PIX'
          WHEN 12 THEN 'Cartão débito' ELSE 'Outra' END,
        T.VALOR,
        CONVERT(varchar(10), T.VENCIMENTO, 23),
        SP.PENDENTE,
        CAT.categoria,
        CAT.grupo
      FROM (
        SELECT ET.TITULO_PAGAR AS TITULO_PAGAR_E, ET.TITULO_PAGAR, ET.PAGAMENTO_TOTAL,
               PE2.USUARIO_LOGADO, PE2.DATA_HORA, PE2.CONTA_BANCARIA,
               COALESCE(PE2.DATA_PAGAMENTO, PE2.MOVIMENTO, PE2.DATA_HORA) AS DATA_PAGAMENTO,
               ROW_NUMBER() OVER (PARTITION BY ET.TITULO_PAGAR ORDER BY PE2.DATA_HORA DESC) AS ORDEM
        FROM PAGAMENTOS_ESCRITURAIS_TITULOS ET WITH (NOLOCK)
        JOIN PAGAMENTOS_ESCRITURAIS PE2 WITH (NOLOCK) ON PE2.PAGAMENTO_ESCRITURAL = ET.PAGAMENTO_ESCRITURAL
      ) EB
      JOIN TITULOS_PAGAR T WITH (NOLOCK) ON T.TITULO_PAGAR = EB.TITULO_PAGAR
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = EB.USUARIO_LOGADO
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
      -- Quanto do título ainda falta pagar hoje (mesma regra da tela: crédito - débito)
      OUTER APPLY (
        SELECT SUM(ISNULL(X.CREDITO, 0)) - SUM(ISNULL(X.DEBITO, 0)) AS PENDENTE
        FROM TITULOS_PAGAR_TRANSACOES X WITH (NOLOCK)
        WHERE X.TITULO_PAGAR = EB.TITULO_PAGAR
      ) SP
      -- Categoria principal do título (a de maior valor no rateio) e o grupo dela
      OUTER APPLY (
        SELECT TOP 1
          COALESCE(LTRIM(RTRIM(CF.DESCRICAO)), CONCAT('Categoria ', C.CLASSIF_FINANCEIRA)) AS categoria,
          COALESCE(LTRIM(RTRIM(G.DESCRICAO)), 'Sem grupo') AS grupo
        FROM TITULOS_PAGAR_CLASSIFICACOES C WITH (NOLOCK)
        LEFT JOIN CLASSIF_FINANCEIRAS CF WITH (NOLOCK) ON CF.CLASSIF_FINANCEIRA = C.CLASSIF_FINANCEIRA
        LEFT JOIN CLASSIF_FINANCEIRAS_GRUPOS G WITH (NOLOCK) ON G.CLASSIF_FINANCEIRA_GRUPO = CF.CLASSIF_FINANCEIRA_GRUPO
        WHERE C.TITULO_PAGAR = EB.TITULO_PAGAR
        ORDER BY C.VALOR DESC
      ) CAT
      WHERE EB.ORDEM = 1
        AND SP.PENDENTE > 0.009
        AND EB.DATA_PAGAMENTO >= CAST(@inicio AS date)
        AND EB.DATA_PAGAMENTO <  DATEADD(day, 1, CAST(@fim AS date))
        AND (@busca IS NULL
          OR T.TITULO LIKE '%' + @busca + '%'
          OR CAST(T.ENTIDADE AS varchar(20)) = @busca
          OR E.NOME LIKE '%' + @busca + '%')

      ORDER BY data_pagamento DESC, id;
    `);
  return recordset;
}

// Quem cuida de caixa: todo usuário que lançou pagamento (caixa ou banco) no último ano.
// Serve para a tela mostrar SEMPRE o cartão de cada pessoa, mesmo sem pagamento no período.
async function pessoasPagamento() {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT X.usuario,
           COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome
    FROM (
      SELECT DISTINCT USUARIO_LOGADO AS usuario FROM PAGAMENTOS_CAIXA WITH (NOLOCK)
      WHERE DATA_HORA >= DATEADD(year, -1, GETDATE())
      UNION
      SELECT DISTINCT USUARIO_LOGADO FROM PAGAMENTOS_ESCRITURAIS WITH (NOLOCK)
      WHERE DATA_HORA >= DATEADD(year, -1, GETDATE())
      UNION
      SELECT DISTINCT USUARIO_LOGADO FROM RECEBIMENTOS_BANCOS WITH (NOLOCK)
      WHERE DATA_HORA >= DATEADD(year, -1, GETDATE())
      UNION
      SELECT DISTINCT USUARIO_LOGADO FROM RECEBIMENTOS_FATURAMENTO_DESPACHO WITH (NOLOCK)
      WHERE DATA_HORA >= DATEADD(year, -1, GETDATE())
    ) X
    LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = X.usuario
    WHERE X.usuario IS NOT NULL;
  `);
  return recordset;
}

// Todos os fornecedores com valor em aberto (a tela mostra só os 10 maiores; aqui vem a lista inteira)
async function fornecedores(filtros) {
  const pool = await getPool();
  const { recordset } = await criarRequest(pool, filtros).query(`
    ${SALDOS}
    SELECT
      cod_fornecedor,
      MAX(fornecedor)                                                        AS fornecedor,
      COUNT(*)                                                               AS titulos,
      SUM(pendente)                                                          AS pendente,
      SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END)                AS vencido,
      COUNT(CASE WHEN dias_atraso > 0 THEN 1 END)                            AS titulos_vencidos,
      MAX(CASE WHEN dias_atraso > 0 THEN dias_atraso END)                    AS maior_atraso,
      CONVERT(varchar(10), MIN(CASE WHEN dias_atraso <= 0 THEN vencimento_data END), 23) AS proximo_vencimento,
      SUM(CASE WHEN dias_atraso BETWEEN -30 AND 0 THEN pendente ELSE 0 END)  AS proximos_30
    FROM TITULOS
    WHERE ${FILTRO_BASE} AND pendente > 0.009
    GROUP BY cod_fornecedor
    ORDER BY SUM(pendente) DESC;
  `);
  return recordset;
}

// ENTRADAS de dinheiro por pessoa (o outro lado do caixa), pela data do recebimento:
//  A) Recebimento de título a receber lançado na tela "Bancos por títulos" (RECEBIMENTOS_BANCOS):
//     o valor vem da transação de recebimento (12) que aponta para ela (TAB_MASTER_ORIGEM 668401).
//  B) Retorno de despacho: o que cada nota pagou (VALOR_PAGAMENTO), com a forma de cada pagamento.
// Uso (set/2026): a Vanessa (82) lança 219 recebimentos e 73 retornos de despacho; a Mykaele (58), 6.
const TAB_RECEBIMENTO_BANCOS = 668401;
const FORMA_POR_CODIGO = (codigo) => `
  CASE ${codigo} WHEN 0 THEN 'Carteira' WHEN 1 THEN 'Boleto' WHEN 2 THEN 'Depósito' WHEN 3 THEN 'Cheque'
    WHEN 4 THEN 'Dinheiro' WHEN 5 THEN 'Débito em conta' WHEN 6 THEN 'Cartão crédito' WHEN 11 THEN 'PIX'
    WHEN 12 THEN 'Cartão débito' WHEN 13 THEN 'Convênio' ELSE 'Outra' END`;

async function entradasCaixa(filtros) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .query(`
      SELECT
        'Recebimento de título'                                           AS origem,
        CONVERT(varchar(10), COALESCE(RB.DATA_RECEBIMENTO, RB.MOVIMENTO, TX.DATA), 23) AS dia,
        RB.USUARIO_LOGADO                                                 AS usuario,
        COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome,
        ${FORMA_POR_CODIGO('COALESCE(RB.MODALIDADE, T.MODALIDADE)')}      AS forma,
        TX.DEBITO                                                         AS valor,
        T.ENTIDADE                                                        AS cod_contraparte,
        LTRIM(RTRIM(E.NOME))                                              AS contraparte,
        LTRIM(RTRIM(T.TITULO))                                            AS documento,
        CONVERT(varchar(16), RB.DATA_HORA, 120)                           AS lancado_em
      FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
      JOIN RECEBIMENTOS_BANCOS RB WITH (NOLOCK)
        ON TX.TAB_MASTER_ORIGEM = ${TAB_RECEBIMENTO_BANCOS} AND RB.RECEBIMENTO_BANCO = TX.REG_MASTER_ORIGEM
      JOIN TITULOS_RECEBER T WITH (NOLOCK) ON T.TITULO_RECEBER = TX.TITULO_RECEBER
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = RB.USUARIO_LOGADO
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
      WHERE TX.TRANSACAO_FINANCEIRA = 12
        AND ISNULL(TX.DEBITO, 0) > 0
        AND COALESCE(RB.DATA_RECEBIMENTO, RB.MOVIMENTO, TX.DATA) >= CAST(@inicio AS date)
        AND COALESCE(RB.DATA_RECEBIMENTO, RB.MOVIMENTO, TX.DATA) <  DATEADD(day, 1, CAST(@fim AS date))

      UNION ALL

      SELECT
        'Retorno de despacho',
        CONVERT(varchar(10), COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA), 23),
        R.USUARIO_LOGADO,
        COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))),
        ${FORMA_POR_CODIGO('DT.MODALIDADE')},
        DT.VALOR_PAGAMENTO,
        DT.ENTIDADE,
        LTRIM(RTRIM(E.NOME)),
        CONCAT('NF ', DT.NF_NUMERO, ' · acerto ', R.RECEBIMENTO_FATURAMENTO_DESPACHO),
        CONVERT(varchar(16), R.DATA_HORA, 120)
      FROM RECEBIMENTOS_FATURAMENTO_DESPACHO R WITH (NOLOCK)
      JOIN RECEBIMENTOS_FATURAMENTO_DESPACHO_DETALHES DT WITH (NOLOCK)
        ON DT.RECEBIMENTO_FATURAMENTO_DESPACHO = R.RECEBIMENTO_FATURAMENTO_DESPACHO
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = R.USUARIO_LOGADO
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = DT.ENTIDADE
      WHERE ISNULL(DT.VALOR_PAGAMENTO, 0) > 0
        AND COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA) >= CAST(@inicio AS date)
        AND COALESCE(R.DATA_RECEBIMENTO, R.DATA_HORA) <  DATEADD(day, 1, CAST(@fim AS date))

      ORDER BY dia DESC, origem;
    `);
  return recordset;
}

module.exports = {
  painel, pagamentos, pessoasPagamento, fornecedores, entradasCaixa, ORDENACAO, FILTRO_SITUACAO,
};
