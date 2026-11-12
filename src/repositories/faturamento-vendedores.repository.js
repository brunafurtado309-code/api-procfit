// Sub-tela do FATURAMENTO: notas faturadas por vendedor.
//
// Regra validada em nov/2026 (consultas no SSMS, mês de novembro até o dia 12):
//   - parte da NOTA, não do pedido. A própria NF_FATURAMENTO guarda o VENDEDOR (nenhuma nota
//     sem vendedor). O NF_FATURAMENTO.PEDIDO_VENDA NÃO é o nº do pedido do pré-venda (não bateu
//     em nenhuma nota); o nº do pedido vem do texto de PEDIDO_CLIENTE.
//   - valor da nota: NF_FATURAMENTO_TOTAIS.TOTAL_GERAL (TOTAL_NF quase igual; TOTAL_COMISSAO vem zerada).
//   - fica de fora: nota cancelada na SEFAZ (CANCELAMENTOS_NOTAS_FISCAIS, como no resto do painel)
//     e TRANSFERÊNCIA entre lojas (NF_FATURAMENTO_TRANSF): 48 notas e R$ 1,19 mi no mês, que não
//     são venda de vendedor.
//   - conferência: 1.148 notas e R$ 1.107.969,52, igual à soma das notas de venda (tipo 8 da
//     VENDAS_ANALITICAS) mais 24 notas geradas no checkout que a analítica não marcou como tipo 8.
//   - nov/2026, conferido pelo CFOP (NF_FATURAMENTO_PRODUTOS.CFOP): essas 24 notas NÃO são venda.
//       5.405 e 5.102 = venda (o PROCFIT conta 100% delas)
//       5.910 = bonificação/brinde, 5.908 = freezer em comodato, 5.408/5.409 = transferência
//     Regra: VENDA = nota que o PROCFIT conta como venda (tipo 8 na VENDAS_ANALITICAS), a mesma base
//     do Resumo de Vendas. Bonificação e comodato saem do faturamento e viram colunas à parte.
//   - devolução (conferido em nov/2026): NF_FATURAMENTO_DEVOLUCOES aponta a nota original
//     (NF_FATURAMENTO_ORIGEM); o valor vem da própria nota de devolução,
//     NF_FATURAMENTO_DEVOLUCOES_TOTAIS.TOTAL_GERAL (ligada por NF_FATURAMENTO_DEVOLUCAO).
//     Antes vinha da VENDAS_ANALITICAS (tipos 12, 13, 16), mas lá a devolução de nota não aparecia
//     e o "Devolvido" ficava zerado. Uma nota pode ter mais de uma devolução (soma todas), e a
//     devolução conta mesmo que tenha sido feita depois do período da nota.

const { sql, getPool } = require('../config/db');
const AppError = require('../utils/AppError');

// Até quantas notas a lista devolve de uma vez (o resumo por vendedor sempre soma todas)
const LIMITE_LISTA = 5000;
// Tempo máximo desta consulta. Passou disso, ela é cancelada no banco e a conexão volta
// para as outras telas (o limite geral do painel é 90 s; esta tela não pode segurar tanto).
const LIMITE_MS = Number(process.env.FAT_VENDEDORES_TIMEOUT_MS) || 45000;

async function notasPorVendedor(filtros) {
  const pool = await getPool();
  const pedido = pool.request();
  let cancelada = false;
  const relogio = setTimeout(() => {
    cancelada = true;
    pedido.cancel();
  }, LIMITE_MS);
  try {
    return await consultar(pedido, filtros);
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

async function consultar(pedido, filtros) {
  const { recordsets } = await pedido
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .input('vendedor', sql.Int, filtros.vendedor ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null)
    .input('devolucao', sql.Bit, filtros.devolucao ? 1 : 0)
    .query(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#N') IS NOT NULL DROP TABLE #N;
      IF OBJECT_ID('tempdb..#NALL') IS NOT NULL DROP TABLE #NALL;
      IF OBJECT_ID('tempdb..#VA8') IS NOT NULL DROP TABLE #VA8;
      IF OBJECT_ID('tempdb..#REM') IS NOT NULL DROP TABLE #REM;
      IF OBJECT_ID('tempdb..#NOTAS') IS NOT NULL DROP TABLE #NOTAS;
      IF OBJECT_ID('tempdb..#ANT') IS NOT NULL DROP TABLE #ANT;
      IF OBJECT_ID('tempdb..#DEV') IS NOT NULL DROP TABLE #DEV;

      -- 0. Notas que o PROCFIT conta como venda (tipo 8 da VENDAS_ANALITICAS), uma leitura só,
      --    cobrindo o período e o mesmo intervalo do mês anterior (com folga de 3 dias)
      SELECT DISTINCT VA.DOCUMENTO_NUMERO, VA.EMPRESA
      INTO #VA8
      FROM VENDAS_ANALITICAS VA WITH (NOLOCK)
      WHERE VA.DOCUMENTO_TIPO = 8
        AND ((VA.MOVIMENTO >= DATEADD(day, -3, CAST(@inicio AS date))
              AND VA.MOVIMENTO < DATEADD(day, 4, CAST(@fim AS date)))
          OR (VA.MOVIMENTO >= DATEADD(day, -3, DATEADD(month, -1, CAST(@inicio AS date)))
              AND VA.MOVIMENTO < DATEADD(day, 4, DATEADD(month, -1, CAST(@fim AS date)))))
        AND (@empresa IS NULL OR VA.EMPRESA = @empresa)
      OPTION (RECOMPILE);
      CREATE CLUSTERED INDEX IX_VA8 ON #VA8 (DOCUMENTO_NUMERO, EMPRESA);

      -- 1. As notas do período (sem canceladas e sem transferências), com o tipo de cada uma:
      --    venda / bonificação (CFOP x.910) / comodato de freezer (x.908) / outra remessa
      SELECT N.NF_FATURAMENTO, N.NF_NUMERO, N.EMPRESA, N.MOVIMENTO, N.VENDEDOR, N.ENTIDADE,
             TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS PEDIDO,
             ISNULL(T.TOTAL_PRODUTOS, 0) AS TOTAL_PRODUTOS,
             ISNULL(T.TOTAL_DESCONTOS, 0) AS TOTAL_DESCONTOS,
             ISNULL(T.TOTAL_GERAL, 0) AS TOTAL_GERAL,
             CASE
               WHEN EXISTS (SELECT 1 FROM #VA8 V WHERE V.DOCUMENTO_NUMERO = N.NF_NUMERO AND V.EMPRESA = N.EMPRESA) THEN 'venda'
               WHEN EXISTS (SELECT 1 FROM NF_FATURAMENTO_PRODUTOS NP WITH (NOLOCK)
                            WHERE NP.NF_FATURAMENTO = N.NF_FATURAMENTO AND NP.CFOP IN ('5.910', '6.910')) THEN 'bonificacao'
               WHEN EXISTS (SELECT 1 FROM NF_FATURAMENTO_PRODUTOS NP WITH (NOLOCK)
                            WHERE NP.NF_FATURAMENTO = N.NF_FATURAMENTO AND NP.CFOP IN ('5.908', '6.908')) THEN 'comodato'
               ELSE 'outra'
             END AS CATEGORIA
      INTO #NALL
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

      -- Faturamento = só as notas de venda
      SELECT NF_FATURAMENTO, NF_NUMERO, EMPRESA, MOVIMENTO, VENDEDOR, ENTIDADE, PEDIDO,
             TOTAL_PRODUTOS, TOTAL_DESCONTOS, TOTAL_GERAL
      INTO #N
      FROM #NALL
      WHERE CATEGORIA = 'venda';
      CREATE CLUSTERED INDEX IX_N ON #N (NF_FATURAMENTO);

      -- Bonificação, comodato e outras remessas por vendedor (fora do faturamento)
      SELECT VENDEDOR,
             SUM(CASE WHEN CATEGORIA = 'bonificacao' THEN 1 ELSE 0 END)           AS notas_bonificacao,
             SUM(CASE WHEN CATEGORIA = 'bonificacao' THEN TOTAL_GERAL ELSE 0 END) AS bonificado,
             SUM(CASE WHEN CATEGORIA = 'comodato' THEN 1 ELSE 0 END)              AS comodatos,
             SUM(CASE WHEN CATEGORIA = 'comodato' THEN TOTAL_GERAL ELSE 0 END)    AS valor_comodato,
             SUM(CASE WHEN CATEGORIA = 'outra' THEN 1 ELSE 0 END)                 AS outras_remessas,
             SUM(CASE WHEN CATEGORIA = 'outra' THEN TOTAL_GERAL ELSE 0 END)       AS valor_outras_remessas
      INTO #REM
      FROM #NALL
      WHERE CATEGORIA <> 'venda'
      GROUP BY VENDEDOR;

      -- 2. Devoluções das notas do período, somadas por nota numa leitura só
      SELECT DV.NF_FATURAMENTO_ORIGEM AS NF_FATURAMENTO,
             COUNT(*)            AS qtd,
             MAX(DV.NF_NUMERO)   AS numero,
             MAX(DV.DATA_HORA)   AS dia,
             SUM(DT.TOTAL_GERAL) AS valor
      INTO #DEV
      FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
      LEFT JOIN NF_FATURAMENTO_DEVOLUCOES_TOTAIS DT WITH (NOLOCK)
        ON DT.NF_FATURAMENTO_DEVOLUCAO = DV.NF_FATURAMENTO_DEVOLUCAO
      WHERE DV.NF_FATURAMENTO_ORIGEM IN (SELECT NF_FATURAMENTO FROM #N)
        -- devolução cancelada (CANCELAMENTOS_NOTAS_FISCAIS TIPO 3) não desconta do faturado
        AND NOT EXISTS (SELECT 1 FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                        WHERE NC.TIPO = 3 AND NC.CHAVE = DV.NF_FATURAMENTO_DEVOLUCAO AND NC.PROTOCOLO IS NOT NULL)
      GROUP BY DV.NF_FATURAMENTO_ORIGEM;

      -- 3. Cada nota com cliente, vendedor e devolução
      SELECT
          N.NF_NUMERO                                     AS nota,
          N.NF_FATURAMENTO                                AS nota_id,
          CONVERT(varchar(10), N.MOVIMENTO, 23)           AS dia,
          N.EMPRESA                                       AS empresa,
          N.PEDIDO                                        AS pedido,
          N.ENTIDADE                                      AS cod_cliente,
          LTRIM(RTRIM(E.NOME))                            AS cliente,
          N.VENDEDOR                                      AS cod_vendedor,
          LTRIM(RTRIM(V.NOME))                            AS vendedor,
          N.TOTAL_PRODUTOS                                AS produtos,
          N.TOTAL_DESCONTOS                               AS desconto,
          N.TOTAL_GERAL                                   AS valor,
          CASE WHEN DVI.qtd > 0 THEN 1 ELSE 0 END         AS tem_devolucao,
          ISNULL(DVI.qtd, 0)                              AS devolucoes,
          DVI.numero                                      AS nota_devolucao,
          CONVERT(varchar(10), DVI.dia, 23)               AS devolucao_dia,
          ISNULL(DVI.valor, 0)                            AS devolvido,
          -- total = voltou a nota inteira; parcial = voltou só uma parte
          CASE WHEN ISNULL(DVI.qtd, 0) = 0 THEN NULL
               WHEN ISNULL(DVI.valor, 0) >= N.TOTAL_GERAL - 0.01 THEN 'total'
               ELSE 'parcial' END                         AS devolucao_tipo
      INTO #NOTAS
      FROM #N N
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = N.ENTIDADE
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = N.VENDEDOR
      LEFT JOIN #DEV DVI ON DVI.NF_FATURAMENTO = N.NF_FATURAMENTO;

      -- Mesmo intervalo no mês anterior (ex.: 01 a 12/11 compara com 01 a 12/10), mesma regra de nota
      SELECT N.VENDEDOR, COUNT(*) AS notas, SUM(ISNULL(T.TOTAL_GERAL, 0)) AS valor
      INTO #ANT
      FROM NF_FATURAMENTO N WITH (NOLOCK)
      JOIN NF_FATURAMENTO_TOTAIS T WITH (NOLOCK) ON T.NF_FATURAMENTO = N.NF_FATURAMENTO
      WHERE N.MOVIMENTO >= DATEADD(month, -1, CAST(@inicio AS date))
        AND N.MOVIMENTO < DATEADD(day, 1, DATEADD(month, -1, CAST(@fim AS date)))
        AND (@empresa IS NULL OR N.EMPRESA = @empresa)
        AND NOT EXISTS (SELECT 1 FROM CANCELAMENTOS_NOTAS_FISCAIS NC WITH (NOLOCK)
                        WHERE NC.TIPO = 1 AND NC.CHAVE = N.NF_FATURAMENTO AND NC.PROTOCOLO IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM NF_FATURAMENTO_TRANSF X WITH (NOLOCK)
                        WHERE X.NF_FATURAMENTO = N.NF_FATURAMENTO)
        AND EXISTS (SELECT 1 FROM #VA8 V WHERE V.DOCUMENTO_NUMERO = N.NF_NUMERO AND V.EMPRESA = N.EMPRESA)
      GROUP BY N.VENDEDOR
      OPTION (RECOMPILE);

      -- Resumo por vendedor: sempre todos os vendedores do período (a escolha de um vendedor
      -- e a pesquisa filtram só a lista de notas)
      SELECT COALESCE(R.cod_vendedor, RM.VENDEDOR) AS cod_vendedor,
             COALESCE(R.vendedor, (SELECT LTRIM(RTRIM(V.NOME)) FROM VENDEDORES V WITH (NOLOCK) WHERE V.VENDEDOR = RM.VENDEDOR)) AS vendedor,
             ISNULL(R.notas, 0) AS notas, ISNULL(R.valor, 0) AS valor, ISNULL(R.desconto, 0) AS desconto,
             ISNULL(R.notas_devolvidas, 0) AS notas_devolvidas, ISNULL(R.devolvido, 0) AS devolvido,
             ISNULL(R.liquido, 0) AS liquido, ISNULL(R.clientes, 0) AS clientes, ISNULL(R.dias_com_nota, 0) AS dias_com_nota,
             A.notas AS notas_anterior, A.valor AS valor_anterior,
             ISNULL(RM.notas_bonificacao, 0) AS notas_bonificacao, ISNULL(RM.bonificado, 0) AS bonificado,
             ISNULL(RM.comodatos, 0) AS comodatos, ISNULL(RM.valor_comodato, 0) AS valor_comodato,
             ISNULL(RM.outras_remessas, 0) AS outras_remessas, ISNULL(RM.valor_outras_remessas, 0) AS valor_outras_remessas
      FROM (
      SELECT cod_vendedor,
             MAX(vendedor)                                 AS vendedor,
             COUNT(*)                                      AS notas,
             SUM(valor)                                    AS valor,
             SUM(desconto)                                 AS desconto,
             SUM(tem_devolucao)                            AS notas_devolvidas,
             SUM(devolvido)                                AS devolvido,
             SUM(valor) - SUM(devolvido)                   AS liquido,
             COUNT(DISTINCT cod_cliente)                   AS clientes,
             COUNT(DISTINCT dia)                           AS dias_com_nota
      FROM #NOTAS
      GROUP BY cod_vendedor
      ) R
      FULL JOIN #REM RM ON RM.VENDEDOR = R.cod_vendedor
      LEFT JOIN #ANT A ON A.VENDEDOR = COALESCE(R.cod_vendedor, RM.VENDEDOR)
      ORDER BY ISNULL(R.valor, 0) DESC;

      -- Lista de notas (do vendedor escolhido, da pesquisa e, se pedido, só as com devolução)
      SELECT TOP ${LIMITE_LISTA} *, valor - devolvido AS liquido
      FROM #NOTAS
      WHERE (@vendedor IS NULL OR cod_vendedor = @vendedor)
        AND (@devolucao = 0 OR tem_devolucao = 1)
        AND (@busca IS NULL
          OR CAST(nota AS varchar(20)) = @busca
          OR CAST(pedido AS varchar(20)) = @busca
          OR CAST(cod_cliente AS varchar(20)) = @busca
          OR cliente LIKE '%' + @busca + '%')
      ORDER BY dia DESC, nota DESC;

      -- Quantas notas a lista teria sem o limite
      SELECT COUNT(*) AS total
      FROM #NOTAS
      WHERE (@vendedor IS NULL OR cod_vendedor = @vendedor)
        AND (@devolucao = 0 OR tem_devolucao = 1)
        AND (@busca IS NULL
          OR CAST(nota AS varchar(20)) = @busca
          OR CAST(pedido AS varchar(20)) = @busca
          OR CAST(cod_cliente AS varchar(20)) = @busca
          OR cliente LIKE '%' + @busca + '%');

      -- Análise / pico de vendas: faturado por dia da equipe e do vendedor escolhido
      -- (sem pesquisa nem filtro de devolução: é a venda inteira do período)
      SELECT dia,
             COUNT(*)                                                   AS notas,
             SUM(valor)                                                 AS valor,
             SUM(CASE WHEN cod_vendedor = @vendedor THEN 1 ELSE 0 END)   AS notas_vendedor,
             SUM(CASE WHEN cod_vendedor = @vendedor THEN valor ELSE 0 END) AS valor_vendedor
      FROM #NOTAS
      GROUP BY dia
      ORDER BY dia;

      -- Principais clientes (do vendedor escolhido; sem vendedor, da equipe)
      SELECT TOP 10 cod_cliente,
             MAX(cliente)       AS cliente,
             COUNT(*)           AS notas,
             SUM(valor)         AS valor,
             SUM(devolvido)     AS devolvido,
             MAX(dia)           AS ultima_compra
      FROM #NOTAS
      WHERE (@vendedor IS NULL OR cod_vendedor = @vendedor)
      GROUP BY cod_cliente
      ORDER BY SUM(valor) DESC;
    `);
  return {
    vendedores: recordsets[0],
    notas: recordsets[1],
    totalNotas: recordsets[2][0]?.total ?? recordsets[1].length,
    limite: LIMITE_LISTA,
    porDia: recordsets[3],
    clientes: recordsets[4],
    // mesmo intervalo do mês anterior, usado na comparação
    anterior: {
      inicio: mesAnterior(filtros.inicio),
      fim: mesAnterior(filtros.fim),
    },
  };
}

// '2026-11-12' -> '2026-10-12' (como o DATEADD(month, -1) do SQL Server: 31/03 vira 28 ou 29/02)
function mesAnterior(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const ultimo = new Date(ano, mes - 1, 0).getDate();
  const d = new Date(ano, mes - 2, Math.min(dia, ultimo));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { notasPorVendedor };
