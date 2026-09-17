// Camada de dados: aqui ficam SOMENTE as consultas SQL de vendas.
//
// Aprendizados sobre a VENDAS_ANALITICAS (validados com dados reais):
// - MOVIMENTO é a data da venda (DATA é quando o PROCFIT processou).
// - Cancelamentos aparecem como linhas NEGATIVAS da mesma venda.
// - CMV e LUCRO_BRUTO não servem (CMV vem zerado).
//   O custo real está em CUSTO_MEDIO_PRODUTOS_VENDAS, que é POR UNIDADE
//   (fica positivo mesmo no cancelamento), por isso multiplicamos pela QUANTIDADE.
// - O custo só é preenchido nas vendas do caixa (PDV). Nas vendas por nota (NFE)
//   ele vem VAZIO, e em alguns produtos vem ZERADO. Os dois casos contam como
//   "sem custo": custo, lucro e margem voltam como null (indisponível), nunca como zero.
// - LUCRO_BRUTO_PRODUTOS_VENDAS usa preço de tabela, não o praticado: não usamos.
// - Identificação de cada venda: no PDV é CAIXA + VENDA; na NFE esses campos vêm
//   zerados e quem identifica é DOCUMENTO_NUMERO (+ SERIE_NF).
// - DOCUMENTO_TIPO (tabela TIPOS_DOCUMENTOS_VENDAS_ANALITICAS) define o grupo:
//     CAIXA     = 1, 2, 9, 10, 18, 19 (PDV e vendas manuais, com cancelamentos)
//     DEVOLUCAO       = 12, 13, 16   (notas de devolução)
//     DEVOLUCAO_CAIXA = 14           (devolução no caixa das lojas)
//     NOTA      = demais              (notas emitidas, canceladas e estornadas)
//     20 (importação de demanda) não é venda e fica fora de tudo.
// - Margem: calculada SÓ sobre as vendas que têm custo. O campo cobertura_custo_pct
//   informa quanto da venda líquida entrou nesse cálculo (0% = sem margem).

const { sql, getPool } = require('../config/db');

// Bloco base usado por todas as consultas.
// ITENS  = cada item vendido no período, já com o custo total calculado.
// VENDAS = os itens agrupados por venda (cupom), para saber o valor líquido de cada uma.
// É um texto fixo nosso (não vem do usuário). Os VALORES entram como parâmetros.
const BASE = `
  WITH ITENS AS (
    SELECT
      VA.EMPRESA,
      VA.CAIXA,
      VA.VENDA,
      VA.MOVIMENTO,
      VA.ESPECIE_FISCAL,
      VA.DOCUMENTO_NUMERO,
      VA.SERIE_NF,
      VA.PRODUTO,
      VA.VENDEDOR,
      CASE
        WHEN VA.DOCUMENTO_TIPO = 14                      THEN 'DEVOLUCAO_CAIXA'
        WHEN VA.DOCUMENTO_TIPO IN (12, 13, 16)           THEN 'DEVOLUCAO'
        WHEN VA.DOCUMENTO_TIPO IN (1, 2, 9, 10, 18, 19)  THEN 'CAIXA'
        ELSE 'NOTA'
      END AS CATEGORIA,
      VA.QUANTIDADE,
      VA.VENDA_BRUTA,
      VA.DESCONTO,
      VA.VENDA_LIQUIDA,
      CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0
           THEN VA.QUANTIDADE * VA.CUSTO_MEDIO_PRODUTOS_VENDAS END AS CUSTO,
      CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0
           THEN VA.VENDA_LIQUIDA END AS LIQUIDA_COM_CUSTO,
      CASE WHEN VA.CUSTO_MEDIO_PRODUTOS_VENDAS > 0 THEN 0 ELSE 1 END AS SEM_CUSTO
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    WHERE VA.MOVIMENTO BETWEEN CAST(@inicio AS date) AND CAST(@fim AS date)
      AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
      AND ISNULL(VA.DOCUMENTO_TIPO, 0) <> 20
  ),
  VENDAS AS (
    SELECT
      EMPRESA, MOVIMENTO, ESPECIE_FISCAL,
      SUM(QUANTIDADE)    AS QTD_ITENS,
      SUM(VENDA_BRUTA)   AS BRUTA,
      SUM(DESCONTO)      AS DESCONTOS,
      SUM(VENDA_LIQUIDA) AS LIQUIDA,
      SUM(CUSTO)         AS CUSTO,
      SUM(LIQUIDA_COM_CUSTO) AS LIQUIDA_COM_CUSTO,
      SUM(SEM_CUSTO)     AS ITENS_SEM_CUSTO
    FROM ITENS
    GROUP BY EMPRESA, MOVIMENTO, ESPECIE_FISCAL, CAIXA, VENDA, DOCUMENTO_NUMERO, SERIE_NF
  )
`;

// Indicadores calculados a partir do bloco VENDAS.
// Só conta como venda o cupom que terminou com valor positivo (cancelados totalmente ficam de fora).
// Custo, lucro e margem consideram só as vendas com custo (null se nenhuma tiver).
const INDICADORES = `
  SUM(CASE WHEN LIQUIDA > 0 THEN 1 ELSE 0 END) AS qtd_vendas,
  SUM(LIQUIDA)                                 AS venda_liquida,
  SUM(ITENS_SEM_CUSTO)                         AS itens_sem_custo,
  ROUND(100.0 * ISNULL(SUM(LIQUIDA_COM_CUSTO), 0) / NULLIF(SUM(LIQUIDA), 0), 2) AS cobertura_custo_pct,
  SUM(CUSTO)                                   AS custo,
  SUM(LIQUIDA_COM_CUSTO) - SUM(CUSTO)          AS lucro_bruto,
  ROUND(100.0 * (SUM(LIQUIDA_COM_CUSTO) - SUM(CUSTO)) / NULLIF(SUM(LIQUIDA_COM_CUSTO), 0), 2) AS margem_pct,
  ROUND(SUM(LIQUIDA) / NULLIF(SUM(CASE WHEN LIQUIDA > 0 THEN 1 ELSE 0 END), 0), 2) AS ticket_medio
`;

// ===== Pesquisa por texto (nota, cupom, pedido, cliente) =====
// Números: comparação exata. Nomes: por partes, sem diferenciar acentos.
// Caracteres especiais do LIKE (% _ [) são tratados como texto comum.
function prepararBusca(termo) {
  if (!termo) return { busca: null, buscaLike: null, buscaDigitos: null };
  const escapado = termo.replace(/[%_[]/g, '[$&]');
  const digitos = termo.replace(/\D/g, '');
  return {
    busca: termo,
    buscaLike: `%${escapado.split(/\s+/).join('%')}%`,
    buscaDigitos: digitos.length >= 3 ? `%${digitos}%` : null,
  };
}

function adicionarBusca(request, termo) {
  const { busca, buscaLike, buscaDigitos } = prepararBusca(termo);
  request.input('busca', sql.VarChar(60), busca);
  request.input('buscaLike', sql.VarChar(200), buscaLike);
  request.input('buscaDigitos', sql.VarChar(40), buscaDigitos);
}

const SEM_PONTUACAO = (coluna) =>
  `REPLACE(REPLACE(REPLACE(${coluna}, '.', ''), '/', ''), '-', '')`;

async function criarRequest({ inicio, fim, empresa }) {
  const pool = await getPool();
  return pool
    .request()
    .input('inicio', sql.VarChar(10), inicio)
    .input('fim', sql.VarChar(10), fim)
    .input('empresa', sql.Int, empresa ?? null);
}

// Totais do período
async function resumo(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      ${INDICADORES},
      SUM(QTD_ITENS) AS qtd_itens,
      SUM(BRUTA)     AS venda_bruta,
      SUM(DESCONTOS) AS desconto
    FROM VENDAS
  `);
  return recordset[0];
}

// Evolução dia a dia
async function porDia(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      CONVERT(varchar(10), MOVIMENTO, 23) AS dia,
      ${INDICADORES}
    FROM VENDAS
    GROUP BY MOVIMENTO
    ORDER BY MOVIMENTO
  `);
  return recordset;
}

// Comparativo entre lojas
async function porLoja(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      V.EMPRESA        AS empresa,
      EU.NOME_FANTASIA AS loja,
      ${INDICADORES}
    FROM VENDAS V
    LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK)
      ON EU.EMPRESA_USUARIA = V.EMPRESA
    GROUP BY V.EMPRESA, EU.NOME_FANTASIA
    ORDER BY venda_liquida DESC
  `);
  return recordset;
}

// Separação entre vendas do caixa (PDV) e por nota fiscal (NFE)
async function porOrigem(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT
      COALESCE(CAST(ESPECIE_FISCAL AS varchar(10)), 'OUTROS') AS origem,
      ${INDICADORES}
    FROM VENDAS
    GROUP BY COALESCE(CAST(ESPECIE_FISCAL AS varchar(10)), 'OUTROS')
    ORDER BY venda_liquida DESC
  `);
  return recordset;
}

// Vendas por vendedor, separando notas, devoluções e caixa.
// DOCS = cada documento (nota, devolução ou cupom) com seu valor líquido.
// Um documento só é contado se terminou com valor (positivo para venda, negativo para devolução).
async function porVendedor(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE},
    DOCS AS (
      SELECT
        VENDEDOR, CATEGORIA,
        SUM(VENDA_LIQUIDA) AS LIQUIDA
      FROM ITENS
      GROUP BY VENDEDOR, CATEGORIA, EMPRESA, MOVIMENTO, ESPECIE_FISCAL,
               CAIXA, VENDA, DOCUMENTO_NUMERO, SERIE_NF
    )
    SELECT
      D.VENDEDOR                          AS vendedor,
      COALESCE(LTRIM(RTRIM(V.NOME)), 'Sem vendedor') AS nome,
      SUM(CASE WHEN D.CATEGORIA = 'NOTA' THEN D.LIQUIDA ELSE 0 END)                     AS notas_valor,
      SUM(CASE WHEN D.CATEGORIA = 'NOTA' AND D.LIQUIDA > 0 THEN 1 ELSE 0 END)           AS notas_qtd,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO' THEN D.LIQUIDA ELSE 0 END)                AS devolucoes_valor,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO' AND D.LIQUIDA < 0 THEN 1 ELSE 0 END)      AS devolucoes_qtd,
      SUM(CASE WHEN D.CATEGORIA = 'CAIXA' THEN D.LIQUIDA ELSE 0 END)                    AS caixa_valor,
      SUM(CASE WHEN D.CATEGORIA = 'CAIXA' AND D.LIQUIDA > 0 THEN 1 ELSE 0 END)          AS caixa_qtd,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO_CAIXA' THEN D.LIQUIDA ELSE 0 END)          AS devolucoes_caixa_valor,
      SUM(CASE WHEN D.CATEGORIA = 'DEVOLUCAO_CAIXA' AND D.LIQUIDA < 0 THEN 1 ELSE 0 END) AS devolucoes_caixa_qtd,
      SUM(D.LIQUIDA)                      AS liquido
    FROM DOCS D
    LEFT JOIN VENDEDORES V WITH (NOLOCK)
      ON V.VENDEDOR = D.VENDEDOR
    GROUP BY D.VENDEDOR, V.NOME
    ORDER BY liquido DESC
  `);
  return recordset;
}

// Notas de um vendedor (faturadas, canceladas e devoluções).
// - A nota cancelada (tipo 11) usa o MESMO número da original: agrupando pelo número,
//   ela zera a nota e vira situação "Cancelada".
// - O vínculo com NF_FATURAMENTO é o REG_MASTER_ORIGEM da nota original (não do cancelamento).
// - Nº impresso = DOCUMENTO_NUMERO (= NF_FATURAMENTO.NF_NUMERO). Pedido = NF_FATURAMENTO.PEDIDO_CLIENTE.
// - vendedor 0 = notas sem vendedor informado; vendedor null = todos (exportação).
const LIMITE_NOTAS = 5000;

// opcoes.categoria: 'NOTA' ou 'DEVOLUCAO' (null = as duas)
// opcoes.comDesconto: true = só notas que tiveram desconto
async function notasDoVendedor(filtros, vendedor, limite = LIMITE_NOTAS, termo = null, opcoes = {}) {
  const request = await criarRequest(filtros);
  request.input('vendedor', sql.Int, vendedor ?? null);
  request.input('limite', sql.Int, limite);
  request.input('categoria', sql.VarChar(20), opcoes.categoria ?? null);
  request.input('comDesconto', sql.Int, opcoes.comDesconto ? 1 : 0);
  adicionarBusca(request, termo);
  const { recordset } = await request.query(`
    WITH ITENS AS (
      SELECT
        VA.EMPRESA,
        VA.MOVIMENTO,
        VA.DOCUMENTO_NUMERO,
        VA.DOCUMENTO_TIPO,
        VA.REG_MASTER_ORIGEM,
        VA.CLIENTE,
        ISNULL(VA.VENDEDOR, 0) AS VENDEDOR,
        VA.QUANTIDADE,
        VA.VENDA_BRUTA,
        VA.DESCONTO,
        VA.VENDA_LIQUIDA,
        CASE WHEN VA.DOCUMENTO_TIPO IN (12, 13, 16) THEN 'DEVOLUCAO' ELSE 'NOTA' END AS CATEGORIA
      FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
      WHERE VA.MOVIMENTO BETWEEN CAST(@inicio AS date) AND CAST(@fim AS date)
        AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
        AND (@vendedor IS NULL OR ISNULL(VA.VENDEDOR, 0) = @vendedor)
        AND ISNULL(VA.DOCUMENTO_TIPO, 0) NOT IN (1, 2, 9, 10, 14, 18, 19, 20)
    ),
    DOCS AS (
      SELECT
        EMPRESA, CATEGORIA, DOCUMENTO_NUMERO,
        MIN(MOVIMENTO)     AS MOVIMENTO,
        MAX(CLIENTE)       AS CLIENTE,
        MAX(VENDEDOR)      AS VENDEDOR,
        MAX(CASE WHEN DOCUMENTO_TIPO NOT IN (4, 6, 11, 13, 17) THEN REG_MASTER_ORIGEM END) AS NF_ID,
        MAX(CASE WHEN DOCUMENTO_TIPO IN (4, 6, 11, 17) THEN 1 ELSE 0 END) AS TEM_CANCELAMENTO,
        SUM(QUANTIDADE)    AS QUANTIDADE,
        SUM(VENDA_BRUTA)   AS BRUTA,
        SUM(DESCONTO)      AS DESCONTOS,
        SUM(VENDA_LIQUIDA) AS LIQUIDA
      FROM ITENS
      GROUP BY EMPRESA, CATEGORIA, DOCUMENTO_NUMERO
    )
    SELECT TOP (@limite)
      CONVERT(varchar(10), D.MOVIMENTO, 23) AS data,
      CASE
        WHEN D.CATEGORIA = 'DEVOLUCAO' THEN 'Devolução'
        WHEN D.TEM_CANCELAMENTO = 1 AND ABS(D.LIQUIDA) < 0.01 THEN 'Cancelada'
        ELSE 'Faturada'
      END                                   AS situacao,
      D.DOCUMENTO_NUMERO                    AS nota,
      NF.NF_SERIE                           AS serie,
      NF.PEDIDO_CLIENTE                     AS pedido,
      D.VENDEDOR                            AS codigo_vendedor,
      LTRIM(RTRIM(V.NOME))                  AS vendedor,
      D.CLIENTE                             AS codigo_cliente,
      LTRIM(RTRIM(E.NOME))                  AS cliente,
      LTRIM(RTRIM(E.NOME_FANTASIA))         AS fantasia,
      E.INSCRICAO_FEDERAL                   AS cnpj_cpf,
      D.QUANTIDADE                          AS quantidade,
      D.EMPRESA                             AS empresa,
      D.CATEGORIA                           AS categoria,
      D.BRUTA                               AS bruto,
      D.DESCONTOS                           AS desconto,
      D.LIQUIDA                             AS valor
    FROM DOCS D
    LEFT JOIN NF_FATURAMENTO NF WITH (NOLOCK)
      ON D.CATEGORIA = 'NOTA' AND NF.NF_FATURAMENTO = D.NF_ID
    LEFT JOIN ENTIDADES E WITH (NOLOCK)
      ON E.ENTIDADE = D.CLIENTE
    LEFT JOIN VENDEDORES V WITH (NOLOCK)
      ON V.VENDEDOR = D.VENDEDOR
    WHERE (@categoria IS NULL OR D.CATEGORIA = @categoria)
      AND (@comDesconto = 0 OR D.DESCONTOS > 0)
      AND (
        @busca IS NULL
        OR CAST(D.DOCUMENTO_NUMERO AS varchar(20)) = @busca
        OR LTRIM(RTRIM(NF.PEDIDO_CLIENTE)) = @busca
        OR CAST(D.CLIENTE AS varchar(20)) = @busca
        OR E.NOME COLLATE Latin1_General_CI_AI LIKE @buscaLike
        OR E.NOME_FANTASIA COLLATE Latin1_General_CI_AI LIKE @buscaLike
        OR (@buscaDigitos IS NOT NULL AND ${SEM_PONTUACAO('E.INSCRICAO_FEDERAL')} LIKE @buscaDigitos)
      )
    ORDER BY D.MOVIMENTO, D.DOCUMENTO_NUMERO
  `);
  return recordset;
}

// ===== Caixa (PDV) por operador =====
// - O operador de verdade está em PDV_VENDAS.OPERADOR (o VENDEDOR do cupom é quem atendeu).
// - Ligação: VENDAS_ANALITICAS (EMPRESA, CAIXA, VENDA) = PDV_VENDAS (EMPRESA, CAIXA, VENDA).
// - Nome do operador: OPERADORES.VENDEDOR -> VENDEDORES.NOME.
//   SEGURANÇA: da tabela OPERADORES só usamos OPERADOR e VENDEDOR (ela guarda senhas).
// - Nº impresso do cupom = DOCUMENTO_NUMERO (= PDV_VENDAS.ECF_CUPOM).
// - Cupom sem registro em PDV_VENDAS fica como operador 0 ("sem operador informado").
const BASE_CAIXA = `
  WITH CUPONS AS (
    SELECT
      VA.EMPRESA, VA.CAIXA, VA.VENDA, VA.DOCUMENTO_NUMERO,
      CASE WHEN VA.DOCUMENTO_TIPO = 14 THEN 'DEVOLUCAO_CAIXA' ELSE 'CAIXA' END AS CATEGORIA,
      MIN(VA.MOVIMENTO)  AS MOVIMENTO,
      MAX(VA.CLIENTE)    AS CLIENTE,
      MAX(VA.VENDEDOR)   AS VENDEDOR,
      MAX(CASE WHEN VA.DOCUMENTO_TIPO IN (2, 10, 19) THEN 1 ELSE 0 END) AS TEM_CANCELAMENTO,
      SUM(VA.VENDA_BRUTA)   AS BRUTA,
      SUM(VA.DESCONTO)      AS DESCONTOS,
      SUM(VA.VENDA_LIQUIDA) AS LIQUIDA
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    WHERE VA.MOVIMENTO BETWEEN CAST(@inicio AS date) AND CAST(@fim AS date)
      AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
      AND VA.DOCUMENTO_TIPO IN (1, 2, 9, 10, 14, 18, 19)
    GROUP BY VA.EMPRESA, VA.CAIXA, VA.VENDA, VA.DOCUMENTO_NUMERO,
             CASE WHEN VA.DOCUMENTO_TIPO = 14 THEN 'DEVOLUCAO_CAIXA' ELSE 'CAIXA' END
  ),
  CUPONS_OPERADOR AS (
    SELECT
      C.*,
      ISNULL(PV.OPERADOR, 0) AS OPERADOR,
      PV.DATA_HORA,
      PV.NFCE_SERIE
    FROM CUPONS C
    OUTER APPLY (
      SELECT TOP 1 P.OPERADOR, P.DATA_HORA, P.NFCE_SERIE
      FROM PDV_VENDAS P WITH (NOLOCK)
      WHERE P.EMPRESA = C.EMPRESA AND P.CAIXA = C.CAIXA AND P.VENDA = C.VENDA
      ORDER BY P.DATA_HORA DESC
    ) PV
  )
`;

async function porOperador(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${BASE_CAIXA}
    SELECT
      CO.OPERADOR                                              AS operador,
      COALESCE(LTRIM(RTRIM(V.NOME)), 'Sem operador informado') AS nome,
      SUM(CASE WHEN CO.CATEGORIA = 'CAIXA' THEN CO.LIQUIDA ELSE 0 END)                       AS caixa_valor,
      SUM(CASE WHEN CO.CATEGORIA = 'CAIXA' AND CO.LIQUIDA > 0 THEN 1 ELSE 0 END)             AS caixa_qtd,
      SUM(CASE WHEN CO.CATEGORIA = 'DEVOLUCAO_CAIXA' THEN CO.LIQUIDA ELSE 0 END)             AS devolucoes_caixa_valor,
      SUM(CASE WHEN CO.CATEGORIA = 'DEVOLUCAO_CAIXA' AND CO.LIQUIDA < 0 THEN 1 ELSE 0 END)   AS devolucoes_caixa_qtd,
      SUM(CO.LIQUIDA)                                          AS liquido
    FROM CUPONS_OPERADOR CO
    LEFT JOIN OPERADORES O WITH (NOLOCK) ON O.OPERADOR = CO.OPERADOR
    LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = O.VENDEDOR
    GROUP BY CO.OPERADOR, V.NOME
    ORDER BY liquido DESC
  `);
  return recordset;
}

// operador null = todos (exportação)
// opcoes.categoria: 'CAIXA' ou 'DEVOLUCAO_CAIXA' (null = as duas)
// opcoes.comDesconto: true = só cupons que tiveram desconto
async function cuponsDoOperador(filtros, operador, limite = LIMITE_NOTAS, termo = null, opcoes = {}) {
  const request = await criarRequest(filtros);
  request.input('operador', sql.Int, operador ?? null);
  request.input('limite', sql.Int, limite);
  request.input('categoria', sql.VarChar(20), opcoes.categoria ?? null);
  request.input('comDesconto', sql.Int, opcoes.comDesconto ? 1 : 0);
  adicionarBusca(request, termo);
  const { recordset } = await request.query(`
    ${BASE_CAIXA}
    SELECT TOP (@limite)
      CONVERT(varchar(10), CO.MOVIMENTO, 23)  AS data,
      CONVERT(varchar(5), CO.DATA_HORA, 108)  AS hora,
      CASE
        WHEN CO.CATEGORIA = 'DEVOLUCAO_CAIXA' THEN 'Devolução'
        WHEN CO.TEM_CANCELAMENTO = 1 AND ABS(CO.LIQUIDA) < 0.01 THEN 'Cancelado'
        ELSE 'Emitido'
      END                                     AS situacao,
      CO.CAIXA                                AS caixa,
      CO.DOCUMENTO_NUMERO                     AS cupom,
      CO.NFCE_SERIE                           AS serie,
      CO.OPERADOR                             AS codigo_operador,
      LTRIM(RTRIM(VO.NOME))                   AS operador,
      CO.VENDEDOR                             AS codigo_vendedor,
      LTRIM(RTRIM(VV.NOME))                   AS vendedor,
      CO.CLIENTE                              AS codigo_cliente,
      LTRIM(RTRIM(E.NOME))                    AS cliente,
      LTRIM(RTRIM(E.NOME_FANTASIA))           AS fantasia,
      E.INSCRICAO_FEDERAL                     AS cnpj_cpf,
      CO.EMPRESA                              AS empresa,
      CO.VENDA                                AS venda,
      CO.CATEGORIA                            AS categoria,
      CO.BRUTA                                AS bruto,
      CO.DESCONTOS                            AS desconto,
      CO.LIQUIDA                              AS valor
    FROM CUPONS_OPERADOR CO
    LEFT JOIN VENDEDORES VV WITH (NOLOCK) ON VV.VENDEDOR = CO.VENDEDOR
    LEFT JOIN ENTIDADES E WITH (NOLOCK)   ON E.ENTIDADE = CO.CLIENTE
    LEFT JOIN OPERADORES O WITH (NOLOCK)  ON O.OPERADOR = CO.OPERADOR
    LEFT JOIN VENDEDORES VO WITH (NOLOCK) ON VO.VENDEDOR = O.VENDEDOR
    WHERE (@operador IS NULL OR CO.OPERADOR = @operador)
      AND (@categoria IS NULL OR CO.CATEGORIA = @categoria)
      AND (@comDesconto = 0 OR CO.DESCONTOS > 0)
      AND (
        @busca IS NULL
        OR CAST(CO.DOCUMENTO_NUMERO AS varchar(20)) = @busca
        OR CAST(CO.CLIENTE AS varchar(20)) = @busca
        OR E.NOME COLLATE Latin1_General_CI_AI LIKE @buscaLike
        OR E.NOME_FANTASIA COLLATE Latin1_General_CI_AI LIKE @buscaLike
        OR (@buscaDigitos IS NOT NULL AND ${SEM_PONTUACAO('E.INSCRICAO_FEDERAL')} LIKE @buscaDigitos)
      )
    ORDER BY CO.MOVIMENTO, CO.DATA_HORA, CO.DOCUMENTO_NUMERO
  `);
  return recordset;
}

// ===== Produtos de um documento (nota ou cupom) =====
// doc: { tipo: 'nota'|'cupom', empresa, numero, categoria, caixa, venda, original }
// original = true: mostra os produtos da venda original, sem os lançamentos de cancelamento
const TIPOS_CANCELAMENTO = '2, 4, 6, 10, 11, 13, 17, 19';

async function itensDoDocumento(filtros, doc) {
  const request = await criarRequest({ ...filtros, empresa: doc.empresa });
  request.input('numero', sql.Int, doc.numero);
  request.input('categoria', sql.VarChar(20), doc.categoria);
  request.input('caixa', sql.Int, doc.caixa ?? null);
  request.input('venda', sql.Int, doc.venda ?? null);
  request.input('original', sql.Int, doc.original ? 1 : 0);

  const filtroDocumento = doc.tipo === 'nota'
    ? `VA.DOCUMENTO_NUMERO = @numero
       AND ISNULL(VA.DOCUMENTO_TIPO, 0) NOT IN (1, 2, 9, 10, 14, 18, 19, 20)
       AND (CASE WHEN VA.DOCUMENTO_TIPO IN (12, 13, 16) THEN 'DEVOLUCAO' ELSE 'NOTA' END) = @categoria`
    : `VA.CAIXA = @caixa AND VA.VENDA = @venda AND VA.DOCUMENTO_NUMERO = @numero
       AND VA.DOCUMENTO_TIPO IN (1, 2, 9, 10, 14, 18, 19)
       AND (CASE WHEN VA.DOCUMENTO_TIPO = 14 THEN 'DEVOLUCAO_CAIXA' ELSE 'CAIXA' END) = @categoria`;

  const { recordset } = await request.query(`
    SELECT
      VA.PRODUTO                   AS produto,
      LTRIM(RTRIM(P.DESCRICAO))    AS descricao,
      SUM(VA.QUANTIDADE)           AS quantidade,
      SUM(VA.VENDA_BRUTA)          AS bruto,
      SUM(VA.DESCONTO)             AS desconto,
      SUM(VA.VENDA_LIQUIDA)        AS valor
    FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
    LEFT JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = VA.PRODUTO
    WHERE VA.MOVIMENTO BETWEEN CAST(@inicio AS date) AND CAST(@fim AS date)
      AND VA.EMPRESA = @empresa
      AND ${filtroDocumento}
      AND (@original = 0 OR VA.DOCUMENTO_TIPO NOT IN (${TIPOS_CANCELAMENTO}))
    GROUP BY VA.PRODUTO, P.DESCRICAO
    ORDER BY ABS(SUM(VA.VENDA_LIQUIDA)) DESC
  `);
  return recordset;
}

async function nomeDoOperador(operador) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('operador', sql.Int, operador)
    .query(`
      SELECT LTRIM(RTRIM(V.NOME)) AS nome
      FROM OPERADORES O WITH (NOLOCK)
      JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = O.VENDEDOR
      WHERE O.OPERADOR = @operador
    `);
  return recordset[0]?.nome ?? null;
}

async function nomeDoVendedor(vendedor) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('vendedor', sql.Int, vendedor)
    .query('SELECT LTRIM(RTRIM(NOME)) AS nome FROM VENDEDORES WITH (NOLOCK) WHERE VENDEDOR = @vendedor');
  return recordset[0]?.nome ?? null;
}

// Produtos mais vendidos (por valor líquido)
async function topProdutos(filtros, limite) {
  const request = await criarRequest(filtros);
  request.input('limite', sql.Int, limite);
  const { recordset } = await request.query(`
    ${BASE}
    SELECT TOP (@limite)
      I.PRODUTO                         AS produto,
      P.DESCRICAO                       AS descricao,
      SUM(I.QUANTIDADE)                 AS quantidade,
      SUM(I.VENDA_LIQUIDA)              AS venda_liquida,
      SUM(I.SEM_CUSTO)                  AS itens_sem_custo,
      ROUND(100.0 * ISNULL(SUM(I.LIQUIDA_COM_CUSTO), 0) / NULLIF(SUM(I.VENDA_LIQUIDA), 0), 2) AS cobertura_custo_pct,
      SUM(I.LIQUIDA_COM_CUSTO) - SUM(I.CUSTO) AS lucro_bruto,
      ROUND(100.0 * (SUM(I.LIQUIDA_COM_CUSTO) - SUM(I.CUSTO)) / NULLIF(SUM(I.LIQUIDA_COM_CUSTO), 0), 2) AS margem_pct
    FROM ITENS I
    LEFT JOIN PRODUTOS P WITH (NOLOCK)
      ON P.PRODUTO = I.PRODUTO
    GROUP BY I.PRODUTO, P.DESCRICAO
    HAVING SUM(I.QUANTIDADE) <> 0
    ORDER BY venda_liquida DESC
  `);
  return recordset;
}

module.exports = {
  resumo, porDia, porLoja, porOrigem, porVendedor, notasDoVendedor, nomeDoVendedor,
  porOperador, cuponsDoOperador, nomeDoOperador, itensDoDocumento, topProdutos,
  LIMITE_NOTAS,
};
