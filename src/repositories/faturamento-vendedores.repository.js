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
//   - devolução (conferido em nov/2026): NF_FATURAMENTO_DEVOLUCOES aponta a nota original
//     (NF_FATURAMENTO_ORIGEM); o valor vem da própria nota de devolução,
//     NF_FATURAMENTO_DEVOLUCOES_TOTAIS.TOTAL_GERAL (ligada por NF_FATURAMENTO_DEVOLUCAO).
//     Antes vinha da VENDAS_ANALITICAS (tipos 12, 13, 16), mas lá a devolução de nota não aparecia
//     e o "Devolvido" ficava zerado. Uma nota pode ter mais de uma devolução (soma todas), e a
//     devolução conta mesmo que tenha sido feita depois do período da nota.

const { sql, getPool } = require('../config/db');

// Até quantas notas a lista devolve de uma vez (o resumo por vendedor sempre soma todas)
const LIMITE_LISTA = 5000;

async function notasPorVendedor(filtros) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim)
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .input('vendedor', sql.Int, filtros.vendedor ?? null)
    .input('busca', sql.VarChar(60), filtros.busca ?? null)
    .input('devolucao', sql.Bit, filtros.devolucao ? 1 : 0)
    .query(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#N') IS NOT NULL DROP TABLE #N;
      IF OBJECT_ID('tempdb..#NOTAS') IS NOT NULL DROP TABLE #NOTAS;
      IF OBJECT_ID('tempdb..#ANT') IS NOT NULL DROP TABLE #ANT;

      -- 1. As notas de venda do período (sem canceladas e sem transferências)
      SELECT N.NF_FATURAMENTO, N.NF_NUMERO, N.EMPRESA, N.MOVIMENTO, N.VENDEDOR, N.ENTIDADE,
             TRY_CAST(LTRIM(RTRIM(N.PEDIDO_CLIENTE)) AS numeric(18, 0)) AS PEDIDO,
             ISNULL(T.TOTAL_PRODUTOS, 0) AS TOTAL_PRODUTOS,
             ISNULL(T.TOTAL_DESCONTOS, 0) AS TOTAL_DESCONTOS,
             ISNULL(T.TOTAL_GERAL, 0) AS TOTAL_GERAL
      INTO #N
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
      CREATE CLUSTERED INDEX IX_N ON #N (NF_FATURAMENTO);

      -- 2. Cada nota com cliente, vendedor e devolução
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
          DVI.qtd                                         AS devolucoes,
          DVI.numero                                      AS nota_devolucao,
          CONVERT(varchar(10), DVI.dia, 23)               AS devolucao_dia,
          ISNULL(DVI.valor, 0)                            AS devolvido,
          -- total = voltou a nota inteira; parcial = voltou só uma parte
          CASE WHEN DVI.qtd = 0 THEN NULL
               WHEN ISNULL(DVI.valor, 0) >= N.TOTAL_GERAL - 0.01 THEN 'total'
               ELSE 'parcial' END                         AS devolucao_tipo
      INTO #NOTAS
      FROM #N N
      LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = N.ENTIDADE
      LEFT JOIN VENDEDORES V WITH (NOLOCK) ON V.VENDEDOR = N.VENDEDOR
      OUTER APPLY (
        SELECT COUNT(*) AS qtd, MAX(DV.NF_NUMERO) AS numero, MAX(DV.DATA_HORA) AS dia,
               SUM(DT.TOTAL_GERAL) AS valor
        FROM NF_FATURAMENTO_DEVOLUCOES DV WITH (NOLOCK)
        LEFT JOIN NF_FATURAMENTO_DEVOLUCOES_TOTAIS DT WITH (NOLOCK)
          ON DT.NF_FATURAMENTO_DEVOLUCAO = DV.NF_FATURAMENTO_DEVOLUCAO
        WHERE DV.NF_FATURAMENTO_ORIGEM = N.NF_FATURAMENTO
      ) DVI;

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
      GROUP BY N.VENDEDOR
      OPTION (RECOMPILE);

      -- Resumo por vendedor: sempre todos os vendedores do período (a escolha de um vendedor
      -- e a pesquisa filtram só a lista de notas)
      SELECT R.*, A.notas AS notas_anterior, A.valor AS valor_anterior
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
      LEFT JOIN #ANT A ON A.VENDEDOR = R.cod_vendedor
      ORDER BY R.valor DESC;

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
