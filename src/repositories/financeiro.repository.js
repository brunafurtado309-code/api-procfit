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

// Origens encontradas nos títulos em aberto (set/2026), por valor:
//   753289 nota fiscal (83%)   757539 identificação manual ("N.IDENT.")
//   455510 / 750078 / 999999 / outras: importação e lançamentos avulsos
const ORIGENS = {
  nota: `T.TAB_MASTER_ORIGEM = ${TAB_NOTA_FISCAL}`,
  sem_nota: `(T.TAB_MASTER_ORIGEM <> ${TAB_NOTA_FISCAL} OR T.TAB_MASTER_ORIGEM IS NULL)`,
};

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
        WHEN 13 THEN 'Convênio'
        ELSE CASE WHEN T.MODALIDADE IS NULL THEN NULL ELSE CONCAT('Modalidade ', T.MODALIDADE) END
      END                                     AS modalidade,
      -- Quem paga: a ADQUIRENTE (maquininha) ou o cliente da venda.
      -- A regra vem do cadastro ADQUIRENTES, que liga cada maquininha a uma ENTIDADE
      -- (ex.: REDE -> entidade 8025 = REDECARD). ENTIDADE 1 é preenchimento das
      -- adquirentes não usadas pela empresa, por isso fica de fora.
      -- Uma venda parcelada no cartão continua sendo dívida do CLIENTE.
      CASE WHEN ADQ.ADQUIRENTE_ID IS NOT NULL THEN 'ADQUIRENTE' ELSE 'CLIENTE' END AS tipo_devedor,
      ADQ.DESCRICAO                           AS adquirente,
      T.TAB_MASTER_ORIGEM                     AS origem_id,
      CASE
        WHEN T.TAB_MASTER_ORIGEM = ${TAB_NOTA_FISCAL} THEN 'Nota fiscal'
        WHEN ADQ.ADQUIRENTE_ID IS NOT NULL           THEN 'Recebível de cartão'
        ELSE 'Sem nota'
      END                                     AS origem,
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
      END                                     AS situacao,
      -- Cada título é UMA PARCELA. Estas colunas somam todas as parcelas da mesma NOTA,
      -- para a tela poder mostrar o valor total da nota, o quanto já foi pago e o que falta.
      COUNT(*)      OVER (PARTITION BY T.EMPRESA, NF.NF_NUMERO) AS nota_parcelas,
      SUM(T.VALOR)  OVER (PARTITION BY T.EMPRESA, NF.NF_NUMERO) AS nota_valor,
      SUM(S.RECEBIDO) OVER (PARTITION BY T.EMPRESA, NF.NF_NUMERO) AS nota_recebido,
      SUM(S.PENDENTE) OVER (PARTITION BY T.EMPRESA, NF.NF_NUMERO) AS nota_pendente
    FROM TITULOS_RECEBER T WITH (NOLOCK)
    JOIN SALDOS S ON S.TITULO_RECEBER = T.TITULO_RECEBER
    -- Só quando a origem É a nota fiscal; senão o REG_MASTER_ORIGEM aponta para outra tabela
    LEFT JOIN NF_FATURAMENTO NF WITH (NOLOCK)
           ON T.TAB_MASTER_ORIGEM = ${TAB_NOTA_FISCAL}
          AND NF.NF_FATURAMENTO = T.REG_MASTER_ORIGEM
    LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
    -- A entidade do título é uma adquirente cadastrada?
    OUTER APPLY (
      SELECT TOP 1 A.ADQUIRENTE_ID, A.DESCRICAO
      FROM ADQUIRENTES A WITH (NOLOCK)
      WHERE A.ENTIDADE = T.ENTIDADE AND A.ENTIDADE > 1
    ) ADQ
    WHERE (@empresa IS NULL OR T.EMPRESA = @empresa)
  )`;

// Todas as consultas recebem os MESMOS parâmetros: assim os cartões, o resumo
// e a lista falam sempre do mesmo conjunto de títulos.
async function criarRequest(filtros = {}) {
  const pool = await getPool();
  return pool
    .request()
    .input('empresa', sql.Int, filtros.empresa ?? null)
    .input('inicio', sql.VarChar(10), filtros.inicio ?? null)
    .input('fim', sql.VarChar(10), filtros.fim ?? null)
    .input('modalidade', sql.Int, filtros.modalidade ?? null)
    .input('busca', sql.VarChar(80), filtros.busca ?? null)
    // Filtros de coluna (cada um vale sozinho)
    .input('f_nota', sql.VarChar(20), filtros.f_nota ?? null)
    .input('f_pedido', sql.VarChar(20), filtros.f_pedido ?? null)
    .input('f_titulo', sql.VarChar(40), filtros.f_titulo ?? null)
    .input('f_cliente', sql.VarChar(80), filtros.f_cliente ?? null)
    .input('f_valor_min', sql.Decimal(18, 2), filtros.f_valor_min ?? null)
    .input('f_valor_max', sql.Decimal(18, 2), filtros.f_valor_max ?? null)
    // Faixa de atraso em dias (ao clicar numa barra de "Por tempo de atraso")
    .input('atraso_min', sql.Int, filtros.atraso_min ?? null)
    .input('atraso_max', sql.Int, filtros.atraso_max ?? null);
}

// Filtros que valem para TODAS as consultas (período de vencimento, modalidade e pesquisa)
const FILTRO_COMUM = `
  (@inicio IS NULL OR vencimento >= @inicio)
  AND (@fim IS NULL OR vencimento <= @fim)
  AND (@modalidade IS NULL OR modalidade_id = @modalidade)
  AND (
    @busca IS NULL
    OR CAST(nota AS varchar(20)) = @busca
    OR CAST(pedido AS varchar(20)) = @busca
    OR CAST(cod_cliente AS varchar(20)) = @busca
    OR titulo = @busca
    OR cliente LIKE '%' + @busca + '%'
  )
  AND (@f_nota IS NULL OR CAST(nota AS varchar(20)) LIKE @f_nota + '%')
  AND (@f_pedido IS NULL OR CAST(pedido AS varchar(20)) LIKE @f_pedido + '%')
  AND (@f_titulo IS NULL OR titulo LIKE '%' + @f_titulo + '%')
  AND (
    @f_cliente IS NULL
    OR cliente COLLATE Latin1_General_CI_AI LIKE '%' + @f_cliente + '%'
    OR CAST(cod_cliente AS varchar(20)) = @f_cliente
  )
  AND (@f_valor_min IS NULL OR pendente >= @f_valor_min)
  AND (@f_valor_max IS NULL OR pendente <= @f_valor_max)
  AND (@atraso_min IS NULL OR dias_atraso >= @atraso_min)
  AND (@atraso_max IS NULL OR dias_atraso <= @atraso_max)`;

// Vencido é o que já passou do vencimento; a vencer é o que ainda está no prazo
function filtroAtraso(atraso) {
  if (atraso === 'vencidos') return 'dias_atraso > 0';
  if (atraso === 'a_vencer') return 'dias_atraso <= 0';
  return '1 = 1';
}

// Quem deve: o cliente da venda ou a adquirente do cartão
function filtroDevedor(devedor) {
  if (devedor === 'adquirente') return `tipo_devedor = 'ADQUIRENTE'`;
  if (devedor === 'cliente') return `tipo_devedor = 'CLIENTE'`;
  return '1 = 1';
}

// Separa os títulos que nasceram de nota fiscal dos demais
function filtroOrigem(origem) {
  return ORIGENS[origem] ?? '1 = 1';
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
    WHERE ${filtroSituacao(filtros.situacao)} AND ${filtroAtraso(filtros.atraso)} AND ${filtroOrigem(filtros.origem)} AND ${filtroDevedor(filtros.devedor)} AND ${FILTRO_COMUM}
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
    WHERE situacao IN ('ABERTO', 'PARCIAL') AND ${filtroOrigem(filtros.origem)} AND ${filtroDevedor(filtros.devedor)} AND ${FILTRO_COMUM}
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

// Colunas que a lista aceita ordenar. Lista fechada: o texto que vem da tela
// nunca entra direto no SQL, só escolhe uma destas expressões.
const ORDENACAO = {
  vencimento: 'vencimento',
  nota: 'nota',
  titulo: 'titulo',
  devedor: 'cliente COLLATE Latin1_General_CI_AI', // A a Z ignorando acentos
  forma: 'modalidade',
  valor: 'valor',
  recebido: 'recebido',
  pendente: 'pendente',
  nota_valor: 'nota_valor',
  nota_recebido: 'nota_recebido',
  nota_pendente: 'nota_pendente',
};

// Ordem escolhida na tela; empate (e sem escolha) cai na ordem padrão
function ordenacao(filtros) {
  const coluna = ORDENACAO[filtros.ordem];
  if (!coluna) return 'vencimento, nota, titulo';
  const direcao = filtros.direcao === 'desc' ? 'DESC' : 'ASC';
  // Desempate sem repetir a coluna escolhida (o SQL Server recusa coluna repetida no ORDER BY)
  const desempate = ['vencimento', 'nota', 'titulo'].filter((c) => c !== coluna);
  return [`${coluna} ${direcao}`, ...desempate].join(', ');
}

// Lista dos títulos, com paginação e pesquisa
async function titulos(filtros) {
  const request = await criarRequest(filtros);
  request.input('pular', sql.Int, (filtros.pagina - 1) * filtros.limite);
  request.input('limite', sql.Int, filtros.limite);

  const condicoes = `
    ${filtroSituacao(filtros.situacao)}
    AND ${filtroAtraso(filtros.atraso)}
    AND ${filtroOrigem(filtros.origem)} AND ${filtroDevedor(filtros.devedor)}
    AND ${FILTRO_COMUM}`;

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
    ORDER BY ${ordenacao(filtros)}
    OFFSET @pular ROWS FETCH NEXT @limite ROWS ONLY;
  `);

  return { total: recordsets[0][0], lista: recordsets[1] };
}

// Totais de cada cartão do topo, numa consulta só
async function cartoes(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT
      SUM(CASE WHEN situacao <> 'QUITADO' THEN pendente ELSE 0 END)                        AS aberto,
      COUNT(CASE WHEN situacao <> 'QUITADO' THEN 1 END)                                    AS aberto_titulos,
      SUM(CASE WHEN situacao <> 'QUITADO' AND dias_atraso > 0 THEN pendente ELSE 0 END)     AS vencido,
      COUNT(CASE WHEN situacao <> 'QUITADO' AND dias_atraso > 0 THEN 1 END)                 AS vencido_titulos,
      SUM(CASE WHEN situacao <> 'QUITADO' AND dias_atraso <= 0 THEN pendente ELSE 0 END)    AS a_vencer,
      COUNT(CASE WHEN situacao <> 'QUITADO' AND dias_atraso <= 0 THEN 1 END)                AS a_vencer_titulos,
      SUM(CASE WHEN situacao = 'PARCIAL' THEN pendente ELSE 0 END)                          AS parcial,
      COUNT(CASE WHEN situacao = 'PARCIAL' THEN 1 END)                                      AS parcial_titulos,
      SUM(CASE WHEN situacao = 'QUITADO' THEN valor ELSE 0 END)                             AS quitado,
      COUNT(CASE WHEN situacao = 'QUITADO' THEN 1 END)                                      AS quitado_titulos,
      SUM(CASE WHEN situacao <> 'QUITADO' AND tipo_devedor = 'CLIENTE' THEN pendente ELSE 0 END)    AS de_clientes,
      COUNT(CASE WHEN situacao <> 'QUITADO' AND tipo_devedor = 'CLIENTE' THEN 1 END)                 AS de_clientes_titulos,
      SUM(CASE WHEN situacao <> 'QUITADO' AND tipo_devedor = 'ADQUIRENTE' THEN pendente ELSE 0 END)  AS de_adquirentes,
      COUNT(CASE WHEN situacao <> 'QUITADO' AND tipo_devedor = 'ADQUIRENTE' THEN 1 END)              AS de_adquirentes_titulos,
      COUNT(DISTINCT CASE WHEN situacao <> 'QUITADO' THEN cod_cliente END)                  AS clientes
    FROM TITULOS
    WHERE ${filtroOrigem(filtros.origem)} AND ${FILTRO_COMUM}
  `);
  return recordset[0];
}

// Um resumo por cliente (cartão "Clientes")
async function porCliente(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT TOP 300
      cod_cliente,
      MAX(cliente)                                          AS cliente,
      COUNT(*)                                              AS titulos,
      SUM(pendente)                                         AS pendente,
      SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END) AS vencido,
      MAX(CASE WHEN dias_atraso > 0 THEN dias_atraso END)   AS maior_atraso,
      MIN(vencimento)                                       AS vencimento_mais_antigo,
      MAX(ultimo_recebimento)                               AS ultimo_recebimento
    FROM TITULOS
    WHERE ${filtroSituacao(filtros.situacao)}
      AND ${filtroAtraso(filtros.atraso)}
      AND ${filtroOrigem(filtros.origem)} AND ${filtroDevedor(filtros.devedor)}
      AND ${FILTRO_COMUM}
    GROUP BY cod_cliente
    ORDER BY pendente DESC
  `);
  return recordset;
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
    // A ficha mostra o cliente inteiro, sem os filtros da tela
    .input('empresa', sql.Int, null)
    .input('inicio', sql.VarChar(10), null)
    .input('fim', sql.VarChar(10), null)
    .input('modalidade', sql.Int, null)
    .input('busca', sql.VarChar(80), null);

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

// Indicadores de comportamento da carteira (cartão do topo da tela).
// O atraso médio é PONDERADO PELO VALOR: um título grande atrasado pesa mais
// que vários pequenos, que é como a cobrança enxerga o problema.
async function indicadores(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT
      SUM(pendente)                                            AS pendente,
      SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END)   AS vencido,
      -- soma(dias * valor) / soma(valor), só do que está vencido
      CASE
        WHEN SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END) > 0
        THEN SUM(CASE WHEN dias_atraso > 0 THEN dias_atraso * pendente ELSE 0 END)
             / SUM(CASE WHEN dias_atraso > 0 THEN pendente ELSE 0 END)
      END                                                      AS atraso_medio,
      CASE WHEN COUNT(*) > 0 THEN SUM(pendente) / COUNT(*) END AS ticket_medio,
      MIN(vencimento)                                          AS vencimento_mais_antigo
    FROM TITULOS
    WHERE ${filtroSituacao(filtros.situacao)}
      AND ${filtroAtraso(filtros.atraso)}
      AND ${filtroOrigem(filtros.origem)} AND ${filtroDevedor(filtros.devedor)}
      AND ${FILTRO_COMUM}
  `);
  return recordset[0];
}

// Previsão de recebimento por SEMANA (só o que ainda vai vencer).
// DATEADD/DATEDIFF com week devolve a segunda-feira da semana do vencimento.
async function previsao(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT TOP 12
      CONVERT(varchar(10),
        DATEADD(week, DATEDIFF(week, 0, CAST(vencimento AS date)), 0), 23) AS semana,
      COUNT(*)      AS titulos,
      SUM(pendente) AS pendente
    FROM TITULOS
    WHERE situacao IN ('ABERTO', 'PARCIAL')
      AND dias_atraso <= 0
      AND ${filtroOrigem(filtros.origem)} AND ${filtroDevedor(filtros.devedor)}
      AND ${FILTRO_COMUM}
    GROUP BY DATEADD(week, DATEDIFF(week, 0, CAST(vencimento AS date)), 0)
    ORDER BY semana
  `);
  return recordset;
}

// Análise de CLIENTES e CRÉDITO: uma linha por cliente, com a exposição de hoje e o
// comportamento de pagamento dos últimos 12 meses (pelo vencimento).
// - Só clientes: recebível de cartão (adquirente) não é crédito dado ao cliente.
// - "Pago em dia" aceita até 3 dias depois do vencimento (fim de semana, compensação).
// - Atraso médio de pagamento é ponderado pelo valor do título.
// - A data do pagamento é a do recebimento lançado (transação 12). Se as baixas
//   estiverem atrasadas no PROCFIT, o cliente parece pior pagador do que é.
// Datas em texto AAAA-MM-DD viram date com CAST (datetime estoura no formato DMY).
async function analiseClientes(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS},
    BASE AS (
      SELECT *,
        CAST(vencimento AS date) AS venc_d,
        CAST(emissao AS date) AS emis_d,
        CASE WHEN ultimo_recebimento IS NOT NULL
             THEN DATEDIFF(day, CAST(vencimento AS date), CAST(ultimo_recebimento AS date)) END AS dias_pagamento
      FROM TITULOS
      WHERE tipo_devedor = 'CLIENTE' AND ${FILTRO_COMUM}
    )
    SELECT
      cod_cliente,
      MAX(cliente)                                                             AS cliente,
      SUM(CASE WHEN pendente > 0.009 THEN pendente ELSE 0 END)                 AS aberto,
      COUNT(CASE WHEN pendente > 0.009 THEN 1 END)                             AS titulos_abertos,
      SUM(CASE WHEN pendente > 0.009 AND dias_atraso > 0 THEN pendente ELSE 0 END) AS vencido,
      MAX(CASE WHEN pendente > 0.009 AND dias_atraso > 0 THEN dias_atraso END) AS maior_atraso,
      SUM(CASE WHEN emis_d >= DATEADD(day, -365, CAST(GETDATE() AS date)) THEN valor ELSE 0 END) AS vendido_12m,
      SUM(CASE WHEN emis_d >= DATEADD(day, -30, CAST(GETDATE() AS date)) THEN valor ELSE 0 END)  AS vendido_30d,
      COUNT(CASE WHEN situacao = 'QUITADO' AND venc_d >= DATEADD(day, -365, CAST(GETDATE() AS date)) THEN 1 END) AS pagos_12m,
      COUNT(CASE WHEN situacao = 'QUITADO' AND venc_d >= DATEADD(day, -365, CAST(GETDATE() AS date))
                  AND dias_pagamento <= 3 THEN 1 END)                          AS pagos_em_dia_12m,
      SUM(CASE WHEN situacao = 'QUITADO' AND venc_d >= DATEADD(day, -365, CAST(GETDATE() AS date))
               THEN valor * CASE WHEN dias_pagamento > 0 THEN dias_pagamento ELSE 0 END ELSE 0 END)
        / NULLIF(SUM(CASE WHEN situacao = 'QUITADO' AND venc_d >= DATEADD(day, -365, CAST(GETDATE() AS date))
                          THEN valor ELSE 0 END), 0)                           AS atraso_medio_pagamento,
      SUM(CASE WHEN ultimo_recebimento >= CONVERT(varchar(10), DATEADD(day, -365, GETDATE()), 23)
               THEN recebido ELSE 0 END)                                       AS recebido_12m,
      CONVERT(varchar(10), MAX(emis_d), 23)                                    AS ultima_compra,
      CONVERT(varchar(10), MIN(emis_d), 23)                                    AS cliente_desde,
      MAX(ultimo_recebimento)                                                  AS ultimo_pagamento
    FROM BASE
    GROUP BY cod_cliente
    HAVING SUM(CASE WHEN pendente > 0.009 THEN pendente ELSE 0 END) > 0.009
        OR SUM(CASE WHEN emis_d >= DATEADD(day, -365, CAST(GETDATE() AS date)) THEN valor ELSE 0 END) > 0.009
  `);
  return recordset;
}

// Saúde das baixas do contas a receber: por mês de vencimento (últimos 6 meses até o atual),
// quanto já venceu e quanto disso continua sem baixa. Mês com pouca baixa = recebimento que
// entrou e não foi baixado no PROCFIT (mesma leitura do contas a pagar).
async function baixasPorMes(filtros) {
  const request = await criarRequest(filtros);
  const { recordset } = await request.query(`
    ${SALDOS},
    ${TITULOS}
    SELECT
      LEFT(vencimento, 7)                                                            AS mes,
      SUM(CASE WHEN dias_atraso >= 0 THEN valor ELSE 0 END)                          AS ja_venceu,
      SUM(CASE WHEN dias_atraso > 0 AND pendente > 0.009 THEN pendente ELSE 0 END)   AS vencido_sem_baixa
    FROM TITULOS
    WHERE vencimento >= CONVERT(varchar(10), DATEADD(month, -5, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)), 23)
      AND vencimento <  CONVERT(varchar(10), DATEADD(month, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)), 23)
      AND ${FILTRO_COMUM}
    GROUP BY LEFT(vencimento, 7)
    ORDER BY 1
  `);
  return recordset;
}

module.exports = {
  resumo, cartoes, indicadores, previsao, porFaixaAtraso, porCliente, titulos, fichaCliente, analiseClientes,
  baixasPorMes,
};