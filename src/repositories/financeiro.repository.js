// Camada de dados do FINANCEIRO: somente consultas SQL de contas a receber.
//
// Aprendizados sobre TITULOS_RECEBER (validados com dados reais em set/2026):
// - Um título é UMA PARCELA. O campo TITULO vem como "nota/parcela" (ex.: 10302/1).
// - TITULOS_RECEBER_TRANSACOES é o extrato do título, e o SINAL é ao contrário do
//   que parece: CREDITO AUMENTA a dívida, DEBITO DIMINUI.
//     pendente  = soma(CREDITO) - soma(DEBITO)
//     recebido  = soma(DEBITO) onde TRANSACAO_FINANCEIRA = 12
// - TRANSACAO_FINANCEIRA (tabela TRANSACOES_FINANCEIRAS):
//     1 = valor original (emissão)      12 = recebimento       13 = cancelamento
//     16 = abatimento                   17 = desconto          18 = juros
//     19 = multa                        51..55 = estornos
// - A ligação com a NOTA FISCAL só vale quando TAB_MASTER_ORIGEM = 753289
//   (tabela NF_FATURAMENTO). Outras origens usam o mesmo REG_MASTER_ORIGEM para
//   apontar para OUTRAS tabelas: sem esse filtro, a consulta mostra nota trocada.
//   Origens encontradas: 753289 nota fiscal (83% do valor), 757539 "N.IDENT.",
//   455510, 999999 (importação), 750078, entre outras menores.
// - MODALIDADE identifica a forma: 1 = boleto, 6 = cartão crédito, 12 = cartão débito,
//   11 = PIX, 4 = dinheiro, 0 = carteira (cadastro em MODALIDADES_TITULOS).

const { sql, getPool } = require('../config/db');

const TAB_NOTA_FISCAL = 753289; // TAB_MASTER_ORIGEM da NF_FATURAMENTO

// Saldo de cada título, a partir do extrato de transações
const SALDOS = `
  WITH SALDOS AS (
    SELECT
      TX.TITULO_RECEBER,
      SUM(ISNULL(TX.CREDITO, 0)) - SUM(ISNULL(TX.DEBITO, 0))                    AS PENDENTE,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN ISNULL(TX.DEBITO, 0)  ELSE 0 END) AS RECEBIDO,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA IN (18, 19) THEN ISNULL(TX.CREDITO, 0) ELSE 0 END) AS JUROS_MULTA,
      SUM(CASE WHEN TX.TRANSACAO_FINANCEIRA IN (16, 17) THEN ISNULL(TX.DEBITO, 0) ELSE 0 END)  AS DESCONTOS,
      MAX(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN TX.DATA END)              AS ULTIMO_RECEBIMENTO,
      COUNT(CASE WHEN TX.TRANSACAO_FINANCEIRA = 12 THEN 1 END)                  AS QTD_RECEBIMENTOS
    FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
    GROUP BY TX.TITULO_RECEBER
  )`;

// Um título com tudo que a tela precisa: nota, pedido, cliente e valores
const TITULOS = `
  TITULOS AS (
    SELECT
      T.TITULO_RECEBER                        AS id,
      T.EMPRESA                               AS empresa,
      LTRIM(RTRIM(T.TITULO))                  AS titulo,
      NF.NF_NUMERO                            AS nota,
      COALESCE(NULLIF(T.PEDIDO_PREVENDA, 0), NULLIF(NF.PEDIDO_CLIENTE, 0)) AS pedido,
      T.ENTIDADE                              AS cod_cliente,
      LTRIM(RTRIM(E.NOME))                    AS cliente,
      T.MODALIDADE                            AS modalidade_id,
      CASE T.MODALIDADE
        WHEN 0  THEN 'Carteira'      WHEN 1  THEN 'Boleto'
        WHEN 2  THEN 'Depósito'      WHEN 3  THEN 'Cheque'
        WHEN 4  THEN 'Dinheiro'      WHEN 5  THEN 'Débito em conta'
        WHEN 6  THEN 'Cartão crédito' WHEN 7  THEN 'Promissória'
        WHEN 8  THEN 'Vale'          WHEN 9  THEN 'Devolução'
        WHEN 11 THEN 'PIX'           WHEN 12 THEN 'Cartão débito'
        WHEN 13 THEN 'Convênio'      ELSE CONCAT('Modalidade ', T.MODALIDADE)
      END                                     AS modalidade,
      CONVERT(varchar(10), T.EMISSAO, 23)     AS emissao,
      CONVERT(varchar(10), T.VENCIMENTO, 23)  AS vencimento,
      DATEDIFF(day, T.VENCIMENTO, CAST(GETDATE() AS date)) AS dias_atraso,
      T.VALOR                                 AS valor,
      S.RECEBIDO                              AS recebido,
      S.PENDENTE                              AS pendente,
      S.JUROS_MULTA                           AS juros_multa,
      S.DESCONTOS                             AS descontos,
      S.QTD_RECEBIMENTOS                      AS qtd_recebimentos,
      CONVERT(varchar(10), S.ULTIMO_RECEBIMENTO, 23) AS ultimo_recebimento,
      CASE
        WHEN S.PENDENTE <= 0.009      THEN 'QUITADO'
        WHEN S.RECEBIDO > 0.009       THEN 'PARCIAL'
        ELSE                               'ABERTO'
      END                                     AS situacao
    FROM TITULOS_RECEBER T WITH (NOLOCK)
    JOIN SALDOS S ON S.TITULO_RECEBER = T.TITULO_RECEBER
    -- Só quando a origem É a nota fiscal; senão o REG_MASTER_ORIGEM aponta para outra tabela
    LEFT JOIN NF_FATURAMENTO NF WITH (NOLOCK)
           ON T.TAB_MASTER_ORIGEM = ${TAB_NOTA_FISCAL}
          AND NF.NF_FATURAMENTO = T.REG_MASTER_ORIGEM
    LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
    WHERE (@empresa IS NULL OR T.EMPRESA = @empresa)
  )`;

async function criarRequest({ empresa }) {
  const pool = await getPool();
  return pool.request().input('empresa', sql.Int, empresa ?? null);
}

// Filtro de situação usado pelas abas
function filtroSituacao(situacao) {
  if (situacao === 'parcial') return `situacao = 'PARCIAL'`;
  if (situacao === 'quitado') return `situacao = 'QUITADO'`;
  if (situacao === 'todos') return '1 = 1';
  return `situacao IN ('ABERTO', 'PARCIAL')`; // padrão: em aberto
}

// Totais do topo da tela
async function resumo(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT
      COUNT(*)                                                             AS titulos,
      SUM(valor)                                                           AS valor_original,
      SUM(recebido)                                                        AS recebido,
      SUM(pendente)                                                        AS pendente,
      SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END)              AS vencido,
      SUM(CASE WHEN dias_atraso <= 0 THEN pendente ELSE 0 END)             AS a_vencer,
      COUNT(CASE WHEN situacao = 'PARCIAL' THEN 1 END)                     AS titulos_parciais,
      SUM(CASE WHEN situacao = 'PARCIAL' THEN pendente ELSE 0 END)         AS pendente_parciais,
      COUNT(DISTINCT cod_cliente)                                          AS clientes
    FROM TITULOS
    WHERE ${filtroSituacao(filtros.situacao)}
  `);
  return recordset[0];
}

// Pendente por faixa de atraso (aba de cobrança)
async function porFaixaAtraso(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT
      CASE
        WHEN dias_atraso <= 0  THEN '1. A vencer'
        WHEN dias_atraso <= 30 THEN '2. 1 a 30 dias'
        WHEN dias_atraso <= 60 THEN '3. 31 a 60 dias'
        WHEN dias_atraso <= 90 THEN '4. 61 a 90 dias'
        ELSE                        '5. Mais de 90 dias'
      END          AS faixa,
      COUNT(*)     AS titulos,
      SUM(pendente) AS pendente,
      COUNT(DISTINCT cod_cliente) AS clientes
    FROM TITULOS
    WHERE situacao IN ('ABERTO', 'PARCIAL')
    GROUP BY CASE
        WHEN dias_atraso <= 0  THEN '1. A vencer'
        WHEN dias_atraso <= 30 THEN '2. 1 a 30 dias'
        WHEN dias_atraso <= 60 THEN '3. 31 a 60 dias'
        WHEN dias_atraso <= 90 THEN '4. 61 a 90 dias'
        ELSE                        '5. Mais de 90 dias'
      END
    ORDER BY faixa
  `);
  return recordset;
}

// Lista dos títulos, com paginação e pesquisa
async function titulos(filtros) {
  const request = await criarRequest(filtros);
  request.input('inicio', sql.VarChar(10), filtros.inicio ?? null);
  request.input('fim', sql.VarChar(10), filtros.fim ?? null);
  request.input('busca', sql.VarChar(80), filtros.busca ?? null);
  request.input('modalidade', sql.Int, filtros.modalidade ?? null);
  request.input('pular', sql.Int, (filtros.pagina - 1) * filtros.limite);
  request.input('limite', sql.Int, filtros.limite);

  const condicoes = `
    ${filtroSituacao(filtros.situacao)}
    AND (@inicio IS NULL OR vencimento >= @inicio)
    AND (@fim    IS NULL OR vencimento <= @fim)
    AND (@modalidade IS NULL OR modalidade_id = @modalidade)
    AND (
      @busca IS NULL
      OR CAST(nota AS varchar(20)) = @busca
      OR CAST(pedido AS varchar(20)) = @busca
      OR CAST(cod_cliente AS varchar(20)) = @busca
      OR titulo = @busca
      OR cliente LIKE '%' + @busca + '%'
    )`;

  const { recordsets } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT
      COUNT(*)      AS total,
      SUM(valor)    AS valor_original,
      SUM(recebido) AS recebido,
      SUM(pendente) AS pendente
    FROM TITULOS WHERE ${condicoes};

    ${SALDOS},
    ${TITULOS}
    SELECT *
    FROM TITULOS
    WHERE ${condicoes}
    ORDER BY vencimento, nota, titulo
    OFFSET @pular ROWS FETCH NEXT @limite ROWS ONLY;
  `);

  return { total: recordsets[0][0], lista: recordsets[1] };
}

// Ficha do cliente: quem é, o que deve e o que compra.
// Junta o financeiro (TITULOS_RECEBER) com as vendas (VENDAS_ANALITICAS),
// que já usamos no painel de vendas. O tipo 20 (importação de demanda) fica fora.
async function fichaCliente(entidade, { meses = 12 } = {}) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('entidade', sql.Int, entidade)
    .input('desde', sql.Int, meses)
    .input('empresa', sql.Int, null); // a ficha olha todas as empresas

  const { recordsets } = await request.query(`
    -- 1. Cadastro
    SELECT
      E.ENTIDADE                    AS cod_cliente,
      LTRIM(RTRIM(E.NOME))          AS cliente,
      LTRIM(RTRIM(E.NOME_FANTASIA)) AS fantasia
    FROM ENTIDADES E WITH (NOLOCK)
    WHERE E.ENTIDADE = @entidade;

    -- 2. Situação financeira
    ${SALDOS},
    ${TITULOS}
    SELECT
      COUNT(*)                                                 AS titulos,
      SUM(CASE WHEN situacao <> 'QUITADO' THEN 1 ELSE 0 END)   AS titulos_abertos,
      SUM(CASE WHEN situacao <> 'QUITADO' THEN pendente ELSE 0 END) AS pendente,
      SUM(CASE WHEN situacao <> 'QUITADO' AND dias_atraso > 0 THEN pendente ELSE 0 END) AS vencido,
      MAX(CASE WHEN situacao <> 'QUITADO' AND dias_atraso > 0 THEN dias_atraso END) AS maior_atraso,
      MAX(ultimo_recebimento)                                  AS ultimo_recebimento,
      SUM(recebido)                                            AS total_recebido
    FROM TITULOS
    WHERE cod_cliente = @entidade;

    -- 3. O que já comprou (últimos meses)
    SELECT
      SUM(VA.VENDA_LIQUIDA)                                      AS total_comprado,
      COUNT(DISTINCT CASE WHEN VA.DOCUMENTO_NUMERO > 0 THEN VA.DOCUMENTO_NUMERO END) AS documentos,
      CONVERT(varchar(10), MIN(VA.MOVIMENTO), 23)                AS primeira_compra,
      CONVERT(varchar(10), MAX(VA.MOVIMENTO), 23)                AS ultima_compra
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    WHERE VA.CLIENTE = @entidade
      AND VA.DOCUMENTO_TIPO <> 20
      AND VA.MOVIMENTO >= DATEADD(month, -@desde, CAST(GETDATE() AS date));

    -- 4. Produtos que mais compra
    SELECT TOP 10
      VA.PRODUTO                  AS produto,
      P.DESCRICAO                 AS descricao,
      SUM(VA.QUANTIDADE)          AS quantidade,
      SUM(VA.VENDA_LIQUIDA)       AS valor
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    LEFT JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = VA.PRODUTO
    WHERE VA.CLIENTE = @entidade
      AND VA.DOCUMENTO_TIPO <> 20
      AND VA.MOVIMENTO >= DATEADD(month, -@desde, CAST(GETDATE() AS date))
    GROUP BY VA.PRODUTO, P.DESCRICAO
    HAVING SUM(VA.QUANTIDADE) > 0
    ORDER BY valor DESC;

    -- 5. Títulos do cliente (abertos primeiro)
    ${SALDOS},
    ${TITULOS}
    SELECT TOP 100 *
    FROM TITULOS
    WHERE cod_cliente = @entidade
    ORDER BY CASE WHEN situacao = 'QUITADO' THEN 1 ELSE 0 END, vencimento DESC;
  `);

  return {
    cliente: recordsets[0][0] ?? { cod_cliente: entidade, cliente: null },
    financeiro: recordsets[1][0],
    compras: recordsets[2][0],
    produtos: recordsets[3],
    titulos: recordsets[4],
  };
}

module.exports = { resumo, porFaixaAtraso, titulos, fichaCliente };
