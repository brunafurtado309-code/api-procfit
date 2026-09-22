// Módulo ADMINISTRATIVO: usuários do PROCFIT e o que cada um fez no sistema.
//
// Importante (validado em set/2026): o PROCFIT NÃO tem log de auditoria ligado
// (a tabela GERAL_LOG está desativada). Então não existe registro de "abriu a tela X"
// ou "consultou Y". O que existe é o carimbo de cada registro criado: quase toda
// tabela guarda USUARIO_LOGADO e DATA_HORA. O rastreio aqui é, portanto, do que a
// pessoa FEZ (criou, lançou, aprovou, cancelou), que é o que interessa para auditoria.
//
// Cada linha do mapa abaixo vira uma consulta igual:
//   SELECT usuario, data_hora, acao, referencia (o número do documento, quando existe)
// Tabelas sem um número útil entram com referência nula (a ação continua contando).

const { sql, getPool } = require('../config/db');

// tabela, ação mostrada na tela, área, coluna com o número do documento (ou null)
const MAPA = [
  ['PEDIDOS_PREVENDAS', 'Criou pedido', 'Vendas', 'PEDIDO_PREVENDA'],
  ['CHECKOUT_PREVENDAS', 'Fez checkout do pedido', 'Vendas', 'PEDIDO_PREVENDA'],
  ['CANCELAMENTOS_PEDIDOS_PREVENDAS', 'Cancelou pedido', 'Vendas', 'PEDIDO_PREVENDA'],
  ['PEDIDOS_PREVENDAS_APROVACOES_DESCONTOS', 'Aprovou desconto', 'Vendas', 'PEDIDO_PREVENDA'],
  ['NF_FATURAMENTO', 'Emitiu nota fiscal', 'Faturamento', 'NF_NUMERO'],
  ['CANCELAMENTOS_NOTAS_FISCAIS', 'Cancelou nota fiscal', 'Faturamento', null],
  ['NF_FATURAMENTO_DEVOLUCOES', 'Lançou devolução', 'Faturamento', null],
  ['CONTROLE_SEPARACOES', 'Separou pedido', 'Logística', null],
  ['FATURAMENTO_DESPACHO', 'Montou despacho', 'Logística', 'FATURAMENTO_DESPACHO'],
  ['RECEBIMENTOS_FATURAMENTO_DESPACHO', 'Lançou retorno de despacho', 'Financeiro', 'RECEBIMENTO_FATURAMENTO_DESPACHO'],
  ['RECEBIMENTOS_BANCOS', 'Lançou recebimento de título', 'Financeiro', 'RECEBIMENTO_BANCO'],
  ['RECEBIMENTOS_CAIXA', 'Lançou recebimento no caixa', 'Financeiro', null],
  ['CANCELAMENTO_TITULOS_RECEBER', 'Cancelou título a receber', 'Financeiro', null],
  ['ABATIMENTOS_RECEBER', 'Deu abatimento em título', 'Financeiro', null],
  ['PRORROGACOES_RECEBER', 'Prorrogou vencimento (receber)', 'Financeiro', null],
  ['ANTECIPACOES_RECEBER', 'Lançou antecipação (receber)', 'Financeiro', null],
  ['PAGAMENTOS_CAIXA', 'Pagou título pelo caixa', 'Financeiro', 'PAGAMENTO_CAIXA'],
  ['PAGAMENTOS_ESCRITURAIS', 'Enviou pagamento ao banco', 'Financeiro', 'PAGAMENTO_ESCRITURAL'],
  ['CANCELAMENTOS_PAGAMENTOS', 'Cancelou pagamento', 'Financeiro', null],
  ['CANCELAMENTO_TITULOS_PAGAR', 'Cancelou título a pagar', 'Financeiro', null],
  ['PRORROGACOES_PAGAR', 'Prorrogou vencimento (pagar)', 'Financeiro', null],
  ['TRANSFERENCIAS_BANCARIAS', 'Transferiu entre contas', 'Financeiro', null],
  ['FECHAMENTOS_CAIXAS', 'Fechou caixa', 'Financeiro', null],
  ['CONFERENCIAS_FECHAMENTOS_CAIXAS', 'Conferiu fechamento de caixa', 'Financeiro', null],
  ['COFRES_LOJAS_LANCAMENTOS', 'Lançou movimento no cofre da loja', 'Financeiro', null],
  ['DEPOSITO_FATURAMENTOS', 'Lançou depósito', 'Financeiro', null],
  ['NF_COMPRA', 'Lançou nota de compra', 'Compras', null],
  ['PEDIDOS_COMPRAS', 'Criou pedido de compra', 'Compras', null],
  ['ESTOQUE_TRANSFERENCIAS', 'Transferiu estoque', 'Estoque', null],
  ['ENTRADAS_ESTOQUE_AVULSAS', 'Entrada avulsa de estoque', 'Estoque', null],
  ['SAIDAS_ESTOQUE_AVULSAS', 'Saída avulsa de estoque', 'Estoque', null],
  ['INVENTARIOS_CONTAGENS', 'Lançou contagem de inventário', 'Estoque', null],
  ['CONFERENCIAS_ESTOQUE_TRANF', 'Conferiu transferência de estoque', 'Estoque', null],
];

const AREAS = [...new Set(MAPA.map(([, , area]) => area))];
const ACOES = MAPA.map(([, acao]) => acao);

// Uma consulta por tabela, todas no mesmo formato, unidas por UNION ALL
const selecionar = ([tabela, acao, area, referencia], filtroUsuario) => `
  SELECT
    X.USUARIO_LOGADO                              AS usuario,
    X.DATA_HORA                                   AS data_hora,
    '${acao.replace(/'/g, "''")}'                 AS acao,
    '${area}'                                     AS area,
    ${referencia ? `CAST(X.${referencia} AS varchar(30))` : 'NULL'} AS referencia
  FROM ${tabela} X WITH (NOLOCK)
  WHERE X.DATA_HORA >= CAST(@inicio AS date)
    AND X.DATA_HORA <  DATEADD(day, 1, CAST(@fim AS date))
    AND X.USUARIO_LOGADO IS NOT NULL
    ${filtroUsuario ? 'AND X.USUARIO_LOGADO = @usuario' : ''}`;

const ATIVIDADE = (filtroUsuario) => MAPA.map((linha) => selecionar(linha, filtroUsuario)).join('\n  UNION ALL\n');

function criarRequest(pool, filtros) {
  const request = pool
    .request()
    .input('inicio', sql.VarChar(10), filtros.inicio)
    .input('fim', sql.VarChar(10), filtros.fim);
  if (filtros.usuario != null) request.input('usuario', sql.Int, filtros.usuario);
  return request;
}

// Lista de usuários com o resumo da atividade no período.
// Da tabela USUARIOS só NOME, LOGIN e ATIVO: ela guarda senhas, nunca usar SELECT *.
async function usuarios(filtros) {
  const pool = await getPool();
  const { recordsets } = await criarRequest(pool, filtros).query(`
    WITH ATIVIDADE AS (
      ${ATIVIDADE(false)}
    ),
    RESUMO AS (
      SELECT usuario, COUNT(*) AS acoes, MAX(data_hora) AS ultima,
             COUNT(DISTINCT area) AS areas,
             SUM(CASE WHEN DATEPART(hour, data_hora) < 6 OR DATEPART(hour, data_hora) >= 20 THEN 1 ELSE 0 END) AS fora_horario,
             SUM(CASE WHEN acao LIKE 'Cancelou%' THEN 1 ELSE 0 END) AS cancelamentos
      FROM ATIVIDADE GROUP BY usuario
    )
    SELECT
      U.USUARIO                                                          AS usuario,
      COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN)))  AS nome,
      LTRIM(RTRIM(U.LOGIN))                                              AS login,
      CASE WHEN U.ATIVO = 'S' THEN 'S' ELSE 'N' END                      AS ativo,
      ISNULL(R.acoes, 0)                                                 AS acoes,
      ISNULL(R.areas, 0)                                                 AS areas,
      ISNULL(R.fora_horario, 0)                                          AS fora_horario,
      ISNULL(R.cancelamentos, 0)                                         AS cancelamentos,
      CONVERT(varchar(16), R.ultima, 120)                                AS ultima_atividade
    FROM USUARIOS U WITH (NOLOCK)
    LEFT JOIN RESUMO R ON R.usuario = U.USUARIO
    ORDER BY ISNULL(R.acoes, 0) DESC, nome;

    -- Áreas em que cada usuário atuou no período (para a coluna "atua em")
    SELECT usuario, area, COUNT(*) AS acoes
    FROM (${ATIVIDADE(false)}) A
    GROUP BY usuario, area;

    -- Total de ações por dia e por área (gráfico do topo)
    SELECT CONVERT(varchar(10), data_hora, 23) AS dia, area, COUNT(*) AS acoes
    FROM (${ATIVIDADE(false)}) A
    GROUP BY CONVERT(varchar(10), data_hora, 23), area
    ORDER BY 1;
  `);
  return { usuarios: recordsets[0], areas: recordsets[1], porDia: recordsets[2] };
}

// Linha do tempo de UMA pessoa: cada ação, com data, hora e o número do documento
async function atividade(filtros) {
  const pool = await getPool();
  const { recordsets } = await criarRequest(pool, filtros).query(`
    SELECT TOP 5000
      CONVERT(varchar(10), data_hora, 23)  AS dia,
      CONVERT(varchar(5), data_hora, 108)  AS hora,
      acao, area, referencia
    FROM (${ATIVIDADE(true)}) A
    ORDER BY data_hora DESC;

    SELECT acao, area, COUNT(*) AS acoes, MAX(CONVERT(varchar(16), data_hora, 120)) AS ultima
    FROM (${ATIVIDADE(true)}) A
    GROUP BY acao, area
    ORDER BY acoes DESC;
  `);
  return { lancamentos: recordsets[0], porAcao: recordsets[1] };
}

// Detalhe dos RECEBIMENTOS lançados na tela "Bancos por títulos" (RECEBIMENTOS_BANCOS):
// uma linha por título baixado, com cliente, nota fiscal, pedido, valor e forma.
// A transação de recebimento (12) aponta para o lote (TAB_MASTER_ORIGEM 668401).
//
// O período filtra pela DATA DO LANÇAMENTO (RB.DATA_HORA), igual ao resto desta tela:
// é o que a pessoa fez naquele período. A data do recebimento informada costuma ser
// anterior (ela lança hoje um recebimento de agosto), e aparece na coluna própria.
const TAB_RECEBIMENTO_BANCOS = 668401;
const TAB_NOTA_FISCAL = 753289; // TAB_MASTER_ORIGEM da NF_FATURAMENTO (mesmo valor usado no financeiro)

async function recebimentos(filtros) {
  const pool = await getPool();
  const { recordset } = await criarRequest(pool, filtros).query(`
    SELECT TOP 20000
      CONVERT(varchar(10), COALESCE(RB.DATA_RECEBIMENTO, RB.MOVIMENTO, TX.DATA), 23) AS dia,
      CONVERT(varchar(16), RB.DATA_HORA, 120)                           AS lancado_em,
      CONVERT(varchar(5), RB.DATA_HORA, 108)                            AS hora_lancamento,
      RB.RECEBIMENTO_BANCO                                              AS lote,
      RB.USUARIO_LOGADO                                                 AS usuario,
      COALESCE(NULLIF(LTRIM(RTRIM(U.NOME)), ''), LTRIM(RTRIM(U.LOGIN))) AS usuario_nome,
      LTRIM(RTRIM(T.TITULO))                                            AS titulo,
      T.ENTIDADE                                                        AS cod_cliente,
      LTRIM(RTRIM(E.NOME))                                              AS cliente,
      NF.NF_NUMERO                                                      AS nota,
      COALESCE(NULLIF(T.PEDIDO_PREVENDA, 0), NULLIF(NF.PEDIDO_CLIENTE, 0)) AS pedido,
      CONVERT(varchar(10), T.VENCIMENTO, 23)                            AS vencimento,
      T.VALOR                                                           AS valor_titulo,
      TX.DEBITO                                                         AS recebido,
      RB.CONTA_BANCARIA                                                 AS conta_bancaria,
      CASE COALESCE(RB.MODALIDADE, T.MODALIDADE)
        WHEN 0 THEN 'Carteira'  WHEN 1 THEN 'Boleto'   WHEN 2 THEN 'Depósito'
        WHEN 3 THEN 'Cheque'    WHEN 4 THEN 'Dinheiro' WHEN 5 THEN 'Débito em conta'
        WHEN 6 THEN 'Cartão crédito' WHEN 7 THEN 'Promissória' WHEN 8 THEN 'Vale'
        WHEN 9 THEN 'Devolução' WHEN 11 THEN 'PIX'     WHEN 12 THEN 'Cartão débito'
        WHEN 13 THEN 'Convênio' ELSE 'Outra' END                        AS forma
    FROM TITULOS_RECEBER_TRANSACOES TX WITH (NOLOCK)
    JOIN RECEBIMENTOS_BANCOS RB WITH (NOLOCK)
      ON TX.TAB_MASTER_ORIGEM = ${TAB_RECEBIMENTO_BANCOS} AND RB.RECEBIMENTO_BANCO = TX.REG_MASTER_ORIGEM
    JOIN TITULOS_RECEBER T WITH (NOLOCK) ON T.TITULO_RECEBER = TX.TITULO_RECEBER
    LEFT JOIN NF_FATURAMENTO NF WITH (NOLOCK)
      ON T.TAB_MASTER_ORIGEM = ${TAB_NOTA_FISCAL} AND NF.NF_FATURAMENTO = T.REG_MASTER_ORIGEM
    LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = T.ENTIDADE
    LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = RB.USUARIO_LOGADO
    WHERE TX.TRANSACAO_FINANCEIRA = 12
      AND ISNULL(TX.DEBITO, 0) > 0
      AND RB.DATA_HORA >= CAST(@inicio AS date)
      AND RB.DATA_HORA <  DATEADD(day, 1, CAST(@fim AS date))
      ${filtros.usuario != null ? 'AND RB.USUARIO_LOGADO = @usuario' : ''}
    ORDER BY RB.DATA_HORA DESC, RB.RECEBIMENTO_BANCO DESC, T.TITULO;
  `);
  return recordset;
}

module.exports = { usuarios, atividade, recebimentos, AREAS, ACOES, MAPA };
