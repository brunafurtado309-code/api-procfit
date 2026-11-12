// Vendas > Vendedores: o que o gestor precisa acompanhar por vendedor, além do faturado em nota.
// (o faturado em nota vem da sub-tela do Faturamento: faturamento-vendedores.repository.js)
//
// Regras conferidas no SSMS em nov/2026:
//   - Orçamento e cancelado vêm do pedido: PEDIDOS_PREVENDAS_TOTAIS.STATUS ("Orçamento",
//     "Pendente Aprovação", "Cancelado") e CANCELAMENTOS_PEDIDOS_PREVENDAS (o cancelamento do
//     pedido fica lá, não no pedido). Mesma regra da tela de Faturamento > Pedidos.
//   - Cancelamento de nota fica em CANCELAMENTOS_NOTAS_FISCAIS:
//       TIPO 1 = nota de venda (384 até nov/2026)
//       TIPO 3 = NOTA DE DEVOLUÇÃO (as 3 que existiam eram todas devoluções: CHAVE = NF_FATURAMENTO_DEVOLUCAO)
//       TIPO 2 = 1 caso, não é nota nem devolução: fica de fora
//   - Nota duplicada: nenhum pedido tinha duas notas válidas; o que apareceu foi o MESMO cliente,
//     no MESMO dia, com o MESMO valor (3 casos em nov/2026). Algumas delas são notas que o PROCFIT
//     não conta como venda (não estão como tipo 8 na VENDAS_ANALITICAS). A tela APONTA para
//     conferir; não tira nada da soma, porque pode ser uma compra que se repetiu de verdade.
//
// Leve de propósito: não monta o caminho inteiro do pedido (cupom, títulos...), que é a consulta
// pesada do "Funil dos pedidos". Tem tempo-limite próprio e, se passar, é cancelada no banco.

const { sql, getPool } = require('../config/db');
const AppError = require('../utils/AppError');

const LIMITE_MS = Number(process.env.VENDAS_VENDEDORES_TIMEOUT_MS) || 40000;
const LIMITE_LISTA = 1000; // pedidos por lista (orçamentos, cancelados)

// Roda uma consulta com tempo-limite: passou, ela é cancelada no banco e a conexão fica livre
async function comLimite(filtros, texto) {
  const pool = await getPool();
  const pedido = pool.request();
  let cancelada = false;
  const relogio = setTimeout(() => {
    cancelada = true;
    pedido.cancel();
  }, LIMITE_MS);
  try {
    const { recordsets } = await pedido
      .input('inicio', sql.VarChar(10), filtros.inicio)
      .input('fim', sql.VarChar(10), filtros.fim)
      .input('empresa', sql.Int, filtros.empresa ?? null)
      .input('vendedor', sql.Int, filtros.vendedor ?? null)
      .input('cliente', sql.Int, filtros.cliente ?? null)
      .query(texto);
    return recordsets;
  } catch (err) {
    if (cancelada || err.code === 'ECANCEL') {
      throw new AppError(`A consulta passou de ${Math.round(LIMITE_MS / 1000)} segundos e foi cancelada para não travar o painel. `
        + 'Tente um período menor ou escolha uma loja.', 504);
    }
    throw err;
  } finally {
    clearTimeout(relogio);
  }
}

// Orçamentos, cancelados e devoluções canceladas
async function controle(filtros) {
  const recordsets = await comLimite(filtros, `
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#PED') IS NOT NULL DROP TABLE #PED;

        -- 1. Pedidos do período que estão em orçamento ou foram cancelados
        SELECT P.PEDIDO_PREVENDA                               AS pedido,
               P.EMPRESA                                       AS empresa,
               CONVERT(varchar(10), P.DATA_HORA, 23)           AS dia,
               DATEDIFF(day, P.DATA_HORA, GETDATE())           AS dias,
               P.CLIENTE                                       AS cod_cliente,
               LTRIM(RTRIM(E.NOME))                            AS cliente,
               P.VENDEDOR                                      AS cod_vendedor,
               LTRIM(RTRIM(V.NOME))                            AS vendedor,
               ISNULL(TOT.PRECO_TOTAL, 0)                      AS valor,
               LTRIM(RTRIM(ISNULL(TOT.STATUS, '')))            AS status,
               CONVERT(varchar(16), CAN.DATA_HORA, 120)        AS cancelado_em,
               CASE WHEN CAN.DATA_HORA IS NOT NULL OR TOT.STATUS = 'Cancelado' THEN 'cancelado'
                    WHEN TOT.STATUS = 'Pendente Aprovação'                   THEN 'aprovacao'
                    ELSE                                                          'orcamento' END AS situacao
        INTO #PED
        FROM PEDIDOS_PREVENDAS P WITH (NOLOCK)
        LEFT JOIN PEDIDOS_PREVENDAS_TOTAIS TOT WITH (NOLOCK) ON TOT.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = P.CLIENTE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = P.VENDEDOR
        OUTER APPLY (
          SELECT TOP 1 X.DATA_HORA
          FROM CANCELAMENTOS_PEDIDOS_PREVENDAS X WITH (NOLOCK)
          WHERE X.PEDIDO_PREVENDA = P.PEDIDO_PREVENDA
          ORDER BY X.CANCELAMENTO_PEDIDOS_PREVENDA DESC
        ) CAN
        WHERE P.DATA_HORA >= CAST(@inicio AS date)
          AND P.DATA_HORA < DATEADD(day, 1, CAST(@fim AS date))
          AND (@empresa IS NULL OR P.EMPRESA = @empresa)
          AND (CAN.DATA_HORA IS NOT NULL
               OR TOT.STATUS IN ('Orçamento', 'Pendente Aprovação', 'Cancelado'))
        OPTION (RECOMPILE);

        -- [0] Por vendedor
        SELECT cod_vendedor, MAX(vendedor) AS vendedor,
               SUM(CASE WHEN situacao <> 'cancelado' THEN 1 ELSE 0 END)     AS orcamentos,
               SUM(CASE WHEN situacao <> 'cancelado' THEN valor ELSE 0 END) AS valor_orcamentos,
               SUM(CASE WHEN situacao = 'cancelado' THEN 1 ELSE 0 END)      AS cancelados,
               SUM(CASE WHEN situacao = 'cancelado' THEN valor ELSE 0 END)  AS valor_cancelados
        FROM #PED
        GROUP BY cod_vendedor;

        -- [1] Pedidos em orçamento (inclui "Pendente Aprovação"), os maiores primeiro
        SELECT TOP ${LIMITE_LISTA} * FROM #PED WHERE situacao <> 'cancelado' ORDER BY valor DESC, dia;
        -- [2] Quantos são ao todo
        SELECT COUNT(*) AS total FROM #PED WHERE situacao <> 'cancelado';
        -- [3] Pedidos cancelados, os mais recentes primeiro
        SELECT TOP ${LIMITE_LISTA} * FROM #PED WHERE situacao = 'cancelado' ORDER BY ISNULL(cancelado_em, dia) DESC;
        -- [4] Quantos são ao todo
        SELECT COUNT(*) AS total FROM #PED WHERE situacao = 'cancelado';

        -- [5] Notas de devolução canceladas no período (CANCELAMENTOS_NOTAS_FISCAIS TIPO 3)
        SELECT DV.NF_NUMERO                                  AS nota_devolucao,
               CONVERT(varchar(10), DV.MOVIMENTO, 23)        AS devolucao_dia,
               CONVERT(varchar(16), NC.DATA_HORA, 120)       AS cancelado_em,
               CASE WHEN NC.PROTOCOLO IS NOT NULL THEN 1 ELSE 0 END AS com_protocolo,
               N.NF_NUMERO                                   AS nota_origem,
               N.EMPRESA                                     AS empresa,
               N.ENTIDADE                                    AS cod_cliente,
               LTRIM(RTRIM(E.NOME))                          AS cliente,
               N.VENDEDOR                                    AS cod_vendedor,
               LTRIM(RTRIM(V.NOME))                          AS vendedor,
               ISNULL(DT.TOTAL_GERAL, 0)                     AS valor
        FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
        JOIN NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK) ON DV.NF_FATURAMENTO_DEVOLUCAO = NC.CHAVE
        LEFT JOIN NF_FATURAMENTO_DEVOLUCOES_TOTAIS DT WITH (NOLOCK)
          ON DT.NF_FATURAMENTO_DEVOLUCAO = DV.NF_FATURAMENTO_DEVOLUCAO
        LEFT JOIN NF_FATURAMENTO N WITH (NOLOCK) ON N.NF_FATURAMENTO = DV.NF_FATURAMENTO_ORIGEM
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = N.ENTIDADE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = N.VENDEDOR
        WHERE NC.TIPO = 3
          AND NC.DATA_HORA >= CAST(@inicio AS date)
          AND NC.DATA_HORA < DATEADD(day, 1, CAST(@fim AS date))
          AND (@empresa IS NULL OR N.EMPRESA = @empresa)
        ORDER BY NC.DATA_HORA DESC;
      `);
  return {
    porVendedor: recordsets[0],
    orcamentos: recordsets[1],
    totalOrcamentos: recordsets[2][0]?.total ?? recordsets[1].length,
    cancelados: recordsets[3],
    totalCancelados: recordsets[4][0]?.total ?? recordsets[3].length,
    devolucoesCanceladas: recordsets[5],
    limite: LIMITE_LISTA,
  };
}

// Notas que parecem duplicadas (consulta separada: se falhar, o resto aparece)
async function duplicadas(filtros) {
  const recordsets = await comLimite(filtros, `
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#ND') IS NOT NULL DROP TABLE #ND;
        IF OBJECT_ID('tempdb..#GD') IS NOT NULL DROP TABLE #GD;

        -- Notas de venda do período (sem canceladas e sem transferências), para achar duplicadas
        SELECT N.NF_FATURAMENTO, N.NF_NUMERO, N.EMPRESA, N.ENTIDADE, N.VENDEDOR,
               CAST(N.MOVIMENTO AS date) AS dia,
               TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS pedido,
               ISNULL(T.TOTAL_GERAL, 0) AS valor
        INTO #ND
        FROM NF_FATURAMENTO N WITH (NOLOCK)
        JOIN NF_FATURAMENTO_TOTAIS T WITH (NOLOCK) ON T.NF_FATURAMENTO = N.NF_FATURAMENTO
        WHERE N.MOVIMENTO >= CAST(@inicio AS date)
          AND N.MOVIMENTO < DATEADD(day, 1, CAST(@fim AS date))
          AND (@empresa IS NULL OR N.EMPRESA = @empresa)
          AND NOT EXISTS (SELECT 1 FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                          WHERE NC.TIPO = 1 AND NC.CHAVE = N.NF_FATURAMENTO AND NC.PROTOCOLO IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                          WHERE X.NF_FATURAMENTO = N.NF_FATURAMENTO)
        OPTION (RECOMPILE);

        -- Grupos suspeitos: o mesmo pedido em mais de uma nota, ou mesmo cliente + dia + valor.
        -- A tabela é criada antes com o tamanho certo: criada pelo SELECT INTO, a coluna ficava do
        -- tamanho de 'pedido' e o 'cliente_dia_valor' não cabia (a consulta inteira falhava).
        CREATE TABLE #GD (motivo varchar(20), chave varchar(100));
        INSERT INTO #GD (motivo, chave)
        SELECT 'pedido', CAST(pedido AS varchar(30))
        FROM #ND WHERE pedido IS NOT NULL
        GROUP BY pedido HAVING COUNT(*) > 1;
        INSERT INTO #GD (motivo, chave)
        SELECT 'cliente_dia_valor',
               CONCAT(ENTIDADE, '|', CONVERT(varchar(10), dia, 23), '|', CAST(valor AS varchar(30)))
        FROM #ND
        GROUP BY ENTIDADE, dia, valor HAVING COUNT(*) > 1;

        -- As notas de cada grupo suspeito
        SELECT G.motivo, G.chave AS grupo,
               D.NF_NUMERO AS nota, D.EMPRESA AS empresa, CONVERT(varchar(10), D.dia, 23) AS dia,
               D.pedido, D.ENTIDADE AS cod_cliente, LTRIM(RTRIM(E.NOME)) AS cliente,
               D.VENDEDOR AS cod_vendedor, LTRIM(RTRIM(V.NOME)) AS vendedor, D.valor,
               -- o PROCFIT conta esta nota como venda? (tipo 8 da VENDAS_ANALITICAS)
               CASE WHEN EXISTS (SELECT 1 FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
                                 WHERE VA.DOCUMENTO_TIPO = 8 AND VA.DOCUMENTO_NUMERO = D.NF_NUMERO
                                   AND VA.EMPRESA = D.EMPRESA)
                    THEN 1 ELSE 0 END AS conta_como_venda
        FROM #GD G
        JOIN #ND D ON (G.motivo = 'pedido' AND G.chave = CAST(D.pedido AS varchar(30)))
                   OR (G.motivo = 'cliente_dia_valor'
                       AND G.chave = CONCAT(D.ENTIDADE, '|', CONVERT(varchar(10), D.dia, 23), '|', CAST(D.valor AS varchar(30))))
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = D.ENTIDADE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = D.VENDEDOR
        ORDER BY G.motivo, G.chave, D.NF_NUMERO;
      `);
  return recordsets[0];
}

// Clientes de UM vendedor: o que cada um comprou em nota no período e no MESMO intervalo do mês
// anterior (se o período passar de um mês, compara com o período do mesmo tamanho logo antes,
// para não contar a mesma nota duas vezes). Mesma regra de nota da sub-tela Faturados por
// vendedor: sem canceladas e sem transferências, pelo vendedor gravado na nota.
async function clientesDoVendedor(filtros, vendedor) {
  const recordsets = await comLimite({ ...filtros, vendedor }, `
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;
        DECLARE @ini date = CAST(@inicio AS date);
        DECLARE @fim_d date = CAST(@fim AS date);
        DECLARE @ini_ant date = DATEADD(month, -1, @ini);
        DECLARE @fim_ant date = DATEADD(month, -1, @fim_d);
        IF @fim_ant >= @ini
        BEGIN
          SET @fim_ant = DATEADD(day, -1, @ini);
          SET @ini_ant = DATEADD(day, -(DATEDIFF(day, @ini, @fim_d) + 1), @ini);
        END;

        SELECT N.ENTIDADE AS cod_cliente,
               SUM(CASE WHEN N.MOVIMENTO >= @ini THEN ISNULL(T.TOTAL_GERAL, 0) ELSE 0 END) AS atual,
               SUM(CASE WHEN N.MOVIMENTO >= @ini THEN 1 ELSE 0 END)                        AS notas_atual,
               SUM(CASE WHEN N.MOVIMENTO < @ini THEN ISNULL(T.TOTAL_GERAL, 0) ELSE 0 END)  AS anterior,
               SUM(CASE WHEN N.MOVIMENTO < @ini THEN 1 ELSE 0 END)                         AS notas_anterior
        INTO #C
        FROM NF_FATURAMENTO N WITH (NOLOCK)
        JOIN NF_FATURAMENTO_TOTAIS T WITH (NOLOCK) ON T.NF_FATURAMENTO = N.NF_FATURAMENTO
        WHERE N.VENDEDOR = @vendedor
          AND ((N.MOVIMENTO >= @ini AND N.MOVIMENTO < DATEADD(day, 1, @fim_d))
            OR (N.MOVIMENTO >= @ini_ant AND N.MOVIMENTO < DATEADD(day, 1, @fim_ant)))
          AND (@empresa IS NULL OR N.EMPRESA = @empresa)
          AND NOT EXISTS (SELECT 1 FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                          WHERE NC.TIPO = 1 AND NC.CHAVE = N.NF_FATURAMENTO AND NC.PROTOCOLO IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                          WHERE X.NF_FATURAMENTO = N.NF_FATURAMENTO)
        GROUP BY N.ENTIDADE
        OPTION (RECOMPILE);

        SELECT C.cod_cliente, LTRIM(RTRIM(E.NOME)) AS cliente,
               C.atual, C.notas_atual, C.anterior, C.notas_anterior,
               -- última nota do cliente com este vendedor (até 6 meses para trás)
               (SELECT CONVERT(varchar(10), MAX(N2.MOVIMENTO), 23)
                  FROM NF_FATURAMENTO N2 WITH (NOLOCK)
                 WHERE N2.ENTIDADE = C.cod_cliente AND N2.VENDEDOR = @vendedor
                   AND N2.MOVIMENTO >= DATEADD(month, -6, @ini)
                   AND N2.MOVIMENTO < DATEADD(day, 1, @fim_d)) AS ultima_compra,
               CONVERT(varchar(10), @ini_ant, 23) AS inicio_anterior,
               CONVERT(varchar(10), @fim_ant, 23) AS fim_anterior
        FROM #C C
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = C.cod_cliente
        ORDER BY C.atual DESC, C.anterior DESC;
      `);
  return recordsets[0];
}

// ===== Vendas > Clientes =====
// Datas usadas pela análise de clientes (o SQL de cada consulta começa com isto):
//   período escolhido, o período anterior (mesmo intervalo do mês anterior; se o período passar
//   de um mês, o período do mesmo tamanho logo antes) e os 6 meses antes do período.
const DATAS_CLIENTES = `
        DECLARE @ini date = CAST(@inicio AS date);
        DECLARE @fim_d date = CAST(@fim AS date);
        DECLARE @ini_ant date = DATEADD(month, -1, @ini);
        DECLARE @fim_ant date = DATEADD(month, -1, @fim_d);
        IF @fim_ant >= @ini
        BEGIN
          SET @fim_ant = DATEADD(day, -1, @ini);
          SET @ini_ant = DATEADD(day, -(DATEDIFF(day, @ini, @fim_d) + 1), @ini);
        END;
        DECLARE @ini6 date = DATEADD(month, -6, @ini);`;

// A carteira inteira: cada cliente identificado que comprou nos 6 meses antes do período ou no
// período. Venda líquida da VENDAS_ANALITICAS (notas e caixa, menos devoluções), como o Resumo.
// Um "documento" é uma nota ou um cupom (as linhas de produto somadas).
async function carteiraClientes(filtros) {
  const recordsets = await comLimite(filtros, `
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#D') IS NOT NULL DROP TABLE #D;
        IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;
        ${DATAS_CLIENTES}

        SELECT VA.CLIENTE, VA.MOVIMENTO, VA.VENDEDOR, SUM(VA.VENDA_LIQUIDA) AS valor
        INTO #D
        FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
        WHERE VA.MOVIMENTO >= @ini6 AND VA.MOVIMENTO < DATEADD(day, 1, @fim_d)
          AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
          AND ISNULL(VA.DOCUMENTO_TIPO, 0) <> 20
          AND VA.CLIENTE > 0
        GROUP BY VA.CLIENTE, VA.MOVIMENTO, VA.VENDEDOR, VA.EMPRESA, VA.ESPECIE_FISCAL,
                 VA.CAIXA, VA.VENDA, VA.DOCUMENTO_NUMERO, VA.SERIE_NF
        OPTION (RECOMPILE);

        SELECT CLIENTE,
               SUM(CASE WHEN MOVIMENTO >= @ini THEN valor ELSE 0 END)                           AS atual,
               SUM(CASE WHEN MOVIMENTO >= @ini AND valor > 0 THEN 1 ELSE 0 END)                  AS docs_atual,
               SUM(CASE WHEN MOVIMENTO >= @ini_ant AND MOVIMENTO <= @fim_ant THEN valor ELSE 0 END) AS anterior,
               SUM(CASE WHEN MOVIMENTO < @ini THEN valor ELSE 0 END)                            AS valor_6m,
               COUNT(DISTINCT CASE WHEN MOVIMENTO < @ini AND valor > 0
                                   THEN DATEFROMPARTS(YEAR(MOVIMENTO), MONTH(MOVIMENTO), 1) END) AS meses_6m,
               SUM(CASE WHEN MOVIMENTO < @ini AND valor > 0 THEN 1 ELSE 0 END)                   AS docs_6m,
               MAX(CASE WHEN valor > 0 THEN MOVIMENTO END)                                     AS ultima,
               MIN(CASE WHEN valor > 0 THEN MOVIMENTO END)                                     AS primeira
        INTO #C
        FROM #D
        GROUP BY CLIENTE;

        SELECT TOP 3000
               C.CLIENTE AS cod_cliente, LTRIM(RTRIM(E.NOME)) AS cliente,
               C.atual, C.docs_atual, C.anterior, C.valor_6m, C.meses_6m, C.docs_6m,
               CONVERT(varchar(10), C.ultima, 23)   AS ultima_compra,
               CONVERT(varchar(10), C.primeira, 23) AS primeira_compra,
               -- vendedor que mais vendeu para o cliente (6 meses + período)
               VP.VENDEDOR AS cod_vendedor, LTRIM(RTRIM(V.NOME)) AS vendedor,
               CONVERT(varchar(10), @ini_ant, 23) AS inicio_anterior,
               CONVERT(varchar(10), @fim_ant, 23) AS fim_anterior,
               CONVERT(varchar(10), @ini6, 23)    AS inicio_6m
        FROM #C C
        OUTER APPLY (
          SELECT TOP 1 D.VENDEDOR FROM #D D WHERE D.CLIENTE = C.CLIENTE
          GROUP BY D.VENDEDOR ORDER BY SUM(D.valor) DESC
        ) VP
        LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = C.CLIENTE
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = VP.VENDEDOR
        ORDER BY C.atual DESC, C.valor_6m DESC;
      `);
  return recordsets[0];
}

// Um cliente: compras mês a mês (12 meses), produtos (6 meses antes + período), produtos que
// ele deixou de comprar no período e os vendedores que o atenderam.
async function historicoCliente(filtros) {
  const recordsets = await comLimite(filtros, `
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#I') IS NOT NULL DROP TABLE #I;
        ${DATAS_CLIENTES}
        DECLARE @ini12 date = DATEADD(month, -11, DATEFROMPARTS(YEAR(@fim_d), MONTH(@fim_d), 1));
        DECLARE @desde date = CASE WHEN @ini12 < @ini6 THEN @ini12 ELSE @ini6 END;

        SELECT VA.MOVIMENTO, VA.PRODUTO, VA.VENDEDOR, VA.QUANTIDADE, VA.VENDA_LIQUIDA,
               CONCAT(VA.EMPRESA, '|', VA.ESPECIE_FISCAL, '|', VA.CAIXA, '|', VA.VENDA, '|',
                      VA.DOCUMENTO_NUMERO, '|', VA.SERIE_NF, '|', CONVERT(varchar(10), VA.MOVIMENTO, 23)) AS doc
        INTO #I
        FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
        WHERE VA.CLIENTE = @cliente
          AND VA.MOVIMENTO >= @desde AND VA.MOVIMENTO < DATEADD(day, 1, @fim_d)
          AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
          AND ISNULL(VA.DOCUMENTO_TIPO, 0) <> 20
        OPTION (RECOMPILE);

        -- [0] Mês a mês (12 meses até o fim do período)
        SELECT CONVERT(varchar(7), MOVIMENTO, 23) AS mes,
               SUM(VENDA_LIQUIDA) AS valor,
               COUNT(DISTINCT CASE WHEN VENDA_LIQUIDA > 0 THEN doc END) AS documentos
        FROM #I
        WHERE MOVIMENTO >= @ini12
        GROUP BY CONVERT(varchar(7), MOVIMENTO, 23)
        ORDER BY mes;

        -- [1] Produtos: no período e nos 6 meses antes (os 15 que mais pesam)
        SELECT TOP 15 I.PRODUTO AS produto, LTRIM(RTRIM(P.DESCRICAO)) AS descricao,
               SUM(CASE WHEN I.MOVIMENTO >= @ini THEN I.QUANTIDADE ELSE 0 END)    AS qtd_atual,
               SUM(CASE WHEN I.MOVIMENTO >= @ini THEN I.VENDA_LIQUIDA ELSE 0 END) AS valor_atual,
               SUM(CASE WHEN I.MOVIMENTO >= @ini6 AND I.MOVIMENTO < @ini THEN I.QUANTIDADE ELSE 0 END)    AS qtd_6m,
               SUM(CASE WHEN I.MOVIMENTO >= @ini6 AND I.MOVIMENTO < @ini THEN I.VENDA_LIQUIDA ELSE 0 END) AS valor_6m,
               CONVERT(varchar(10), MAX(CASE WHEN I.VENDA_LIQUIDA > 0 THEN I.MOVIMENTO END), 23) AS ultima_compra
        FROM #I I
        LEFT JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = I.PRODUTO
        WHERE I.MOVIMENTO >= @ini6
        GROUP BY I.PRODUTO, P.DESCRICAO
        HAVING SUM(I.VENDA_LIQUIDA) > 0
        ORDER BY SUM(I.VENDA_LIQUIDA) DESC;

        -- [2] Produtos que deixou de comprar: comprou em 2 meses ou mais dos 6 anteriores e nada no período
        SELECT TOP 10 I.PRODUTO AS produto, LTRIM(RTRIM(P.DESCRICAO)) AS descricao,
               SUM(I.QUANTIDADE) AS qtd_6m, SUM(I.VENDA_LIQUIDA) AS valor_6m,
               COUNT(DISTINCT CONVERT(varchar(7), I.MOVIMENTO, 23)) AS meses,
               CONVERT(varchar(10), MAX(I.MOVIMENTO), 23) AS ultima_compra
        FROM #I I
        LEFT JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = I.PRODUTO
        WHERE I.MOVIMENTO >= @ini6 AND I.MOVIMENTO < @ini AND I.VENDA_LIQUIDA > 0
          AND NOT EXISTS (SELECT 1 FROM #I X WHERE X.PRODUTO = I.PRODUTO AND X.MOVIMENTO >= @ini AND X.VENDA_LIQUIDA > 0)
        GROUP BY I.PRODUTO, P.DESCRICAO
        HAVING COUNT(DISTINCT CONVERT(varchar(7), I.MOVIMENTO, 23)) >= 2
        ORDER BY SUM(I.VENDA_LIQUIDA) DESC;

        -- [3] Vendedores que atenderam o cliente (6 meses + período)
        SELECT I.VENDEDOR AS cod_vendedor, COALESCE(LTRIM(RTRIM(V.NOME)), 'Sem vendedor') AS vendedor,
               SUM(I.VENDA_LIQUIDA) AS valor, COUNT(DISTINCT CASE WHEN I.VENDA_LIQUIDA > 0 THEN I.doc END) AS documentos,
               CONVERT(varchar(10), MAX(I.MOVIMENTO), 23) AS ultima
        FROM #I I
        LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = I.VENDEDOR
        WHERE I.MOVIMENTO >= @ini6
        GROUP BY I.VENDEDOR, V.NOME
        HAVING SUM(I.VENDA_LIQUIDA) > 0
        ORDER BY SUM(I.VENDA_LIQUIDA) DESC;
      `);
  return { meses: recordsets[0], produtos: recordsets[1], parouDeComprar: recordsets[2], vendedores: recordsets[3] };
}

module.exports = { controle, duplicadas, clientesDoVendedor, carteiraClientes, historicoCliente };
