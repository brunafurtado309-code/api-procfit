// Módulo PRECIFICAÇÃO: custo certo, preço sugerido, margem real, estoque e giro.
// Desenho combinado em out/2026 (documento "Painel da Precificação — Belo Norte").
// O painel calcula e sugere, mas NUNCA grava no PROCFIT: aqui só tem leitura.
//
// De onde vem cada coisa (validado no banco em out/2026):
//   Notas de compra   NF_COMPRA. O PROCFIT cria a nota sozinho quando o XML chega
//                     (PROCEDURE_INSERT = INSERT_NFE_NF_COMPRA). EMISSAO = data da nota.
//                     PROCESSAR = 'S' quando a logística finaliza; DATA_PROCESSAMENTO = quando.
//                     Conferido em 90 dias: 236 de 237 notas 'S' têm estoque; nenhuma 'N' tem.
//   Itens da nota     NF_COMPRA_PRODUTOS só recebe os itens quando a nota é finalizada.
//   parada            Antes disso, os itens existem só no XML: NF_COMPRA.CHAVE_NFE = NFE.ID,
//                     e NFE_PROD.REGISTRO_NFE = NFE.Registro.
//   Vínculo do item   NFE_PROD.PRODUTO vem sempre vazio: o vínculo com o nosso produto é
//                     montado pela API (passo 5).
//   Notas do grupo    NFE guarda todas as notas em que um CNPJ do grupo aparece, inclusive
//                     transferências entre filiais. Transferência = mesma raiz de CNPJ entre
//                     emitente e destinatário (o grupo usa 35.018.014) ou natureza de operação
//                     com "TRANSFER" (ex.: Belo Norte Indústria → filiais).
//   Matéria-prima     Polpas, ingredientes e açaí NÃO dão entrada no estoque: o processo da
//                     produção ainda não existe no sistema (sem ficha técnica). O banco não tem
//                     como dizer se uma nota é de revenda, produção ou uso e consumo (o CFOP diz
//                     como o fornecedor vendeu, não o que fazemos com o produto), e há fornecedor
//                     que manda as duas coisas (ex.: Nutrilatino). Por isso o tipo vem da
//                     classificação feita na tela (classificacao.repository.js); aqui só saem
//                     os fatos: a nota entrou ou não, e o histórico de cada fornecedor.
//   Cancelamento      EdocEventosNFe, evento 110111 (cancelamento pelo emitente), pela chave.
//   eDoc              EdocRegistrosNFe NÃO é usada: tem notas de muitos CNPJs.
//   Classificação     PRODUTOS.CATEGORIA_PRODUTO e CLASSIFICACAO vêm vazias. INDUSTRIALIZADO
//                     e INSUMO ('S') estão preenchidos e ajudam a sugerir o tipo (passo 3).

const { sql, getPool } = require('../config/db');

const RAIZ_CNPJ_GRUPO = '35018014';
const EVENTO_CANCELAMENTO = 110111;
const LIMITE_LISTA = 1000;

// Os 8 primeiros números do CNPJ, sem pontuação (a NFE guarda "35.018.014/0001-17")
// ISNULL: CNPJ vazio vira '' (comparar com NULL dá "desconhecido", e o NOT de "desconhecido"
// também é "desconhecido", o que faria a nota sumir da lista sem ninguém perceber)
const raiz = (coluna) => `LEFT(REPLACE(REPLACE(REPLACE(ISNULL(${coluna}, ''), '.', ''), '/', ''), '-', ''), 8)`;

// Nota entre empresas do grupo (não é compra)
const TRANSFERENCIA = (x) => `(${raiz(`${x}.emit_CNPJ`)} = ${raiz(`${x}.dest_CNPJ`)}
    OR ISNULL(${x}.natOp, '') LIKE '%TRANSFER%')`;

// Nota cancelada pelo emitente
const CANCELADA = (chave) => `EXISTS (
    SELECT 1 FROM EdocEventosNFe EV WITH (NOLOCK)
    WHERE EV.tpEvento = ${EVENTO_CANCELAMENTO} AND RIGHT(EV.chNFe, 44) = ${chave})`;

// Notas do período: as de compra (entrou ou não no estoque) e as que chegaram contra o CNPJ
// e não viraram nota de compra. A situação final (parada, a classificar...) é decidida no service.
async function notas(filtros) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('dias', sql.Int, filtros.dias)
    .query(`
      SET NOCOUNT ON;
      DECLARE @hoje date = CAST(GETDATE() AS date);
      DECLARE @desde date = DATEADD(day, -@dias, @hoje);

      IF OBJECT_ID('tempdb..#NC') IS NOT NULL DROP TABLE #NC;
      IF OBJECT_ID('tempdb..#XML') IS NOT NULL DROP TABLE #XML;

      -- 1. Notas de compra do período (sem transferências e sem canceladas)
      SELECT
        N.NF_COMPRA                                         AS nota_id,
        N.NF_NUMERO                                         AS numero,
        N.EMPRESA                                           AS empresa,
        LTRIM(RTRIM(EU.NOME_FANTASIA))                      AS nome_empresa,
        N.ENTIDADE                                          AS cod_fornecedor,
        LTRIM(RTRIM(NE.NOME))                               AS fornecedor,
        CONVERT(varchar(10), N.EMISSAO, 23)                 AS emissao,
        CONVERT(varchar(16), N.DATA_HORA, 120)              AS lancada_em,
        CONVERT(varchar(10), N.DATA_PROCESSAMENTO, 23)      AS entrou_em,
        N.TOTAL_GERAL                                       AS valor,
        CASE WHEN ISNULL(N.PROCESSAR, 'N') = 'S' THEN 1 ELSE 0 END AS entrou,
        CASE
          WHEN ISNULL(N.PROCESSAR, 'N') = 'S'
            THEN DATEDIFF(day, N.EMISSAO, N.DATA_PROCESSAMENTO)
          ELSE DATEDIFF(day, N.EMISSAO, @hoje)
        END                                                 AS dias
      INTO #NC
      FROM NF_COMPRA N WITH (NOLOCK)
      LEFT JOIN NF_COMPRA_ENTIDADE NE WITH (NOLOCK) ON NE.NF_COMPRA = N.NF_COMPRA
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = N.EMPRESA
      LEFT JOIN NFE X WITH (NOLOCK) ON X.ID = N.CHAVE_NFE
      WHERE N.EMISSAO >= @desde
        AND NOT (X.ID IS NOT NULL AND ${TRANSFERENCIA('X')})
        AND NOT (N.CHAVE_NFE IS NOT NULL AND ${CANCELADA('N.CHAVE_NFE')});

      -- 2. Notas que chegaram contra o CNPJ e não viraram nota de compra
      --    (sem transferências, sem devoluções, sem notas emitidas pelo próprio grupo)
      SELECT
        X.Registro                                          AS registro,
        X.nNF                                               AS numero,
        LTRIM(RTRIM(X.emit_xNome))                          AS fornecedor,
        X.emit_CNPJ                                         AS cnpj,
        LTRIM(RTRIM(X.dest_xNome))                          AS destinatario,
        LTRIM(RTRIM(X.natOp))                               AS operacao,
        CONVERT(varchar(10), X.dhEmi, 23)                   AS emissao,
        DATEDIFF(day, X.dhEmi, @hoje)                       AS dias,
        X.vNF                                               AS valor,
        LTRIM(RTRIM(CAST(X.ERRO_PROCESSAMENTO AS varchar(300)))) AS erro
      INTO #XML
      FROM NFE X WITH (NOLOCK)
      WHERE X.dhEmi >= @desde
        AND ${raiz('X.emit_CNPJ')} <> '${RAIZ_CNPJ_GRUPO}'
        AND NOT ${TRANSFERENCIA('X')}
        AND ISNULL(X.natOp, '') NOT LIKE '%DEVOLU%'
        AND NOT EXISTS (SELECT 1 FROM NF_COMPRA N WITH (NOLOCK) WHERE N.CHAVE_NFE = X.ID)
        AND NOT ${CANCELADA('X.ID')};

      -- As mais antigas primeiro (o service separa por situação)
      SELECT TOP (${LIMITE_LISTA}) * FROM #NC ORDER BY dias DESC, nota_id DESC;
      SELECT TOP (${LIMITE_LISTA}) * FROM #XML ORDER BY dias DESC;
    `);
  const [compras, xml] = recordsets;
  return { compras, xml };
}

// Histórico de cada fornecedor (desde o início do sistema): quantas notas mandou e quantas
// entraram no estoque. É a base da sugestão de tipo (service).
async function fornecedores() {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT
      N.ENTIDADE                                                   AS codigo,
      MAX(LTRIM(RTRIM(NE.NOME)))                                   AS nome,
      COUNT(*)                                                     AS notas,
      SUM(CASE WHEN ISNULL(N.PROCESSAR, 'N') = 'S' THEN 1 ELSE 0 END) AS finalizadas,
      SUM(N.TOTAL_GERAL)                                           AS valor,
      CONVERT(varchar(10), MAX(N.EMISSAO), 23)                     AS ultima_nota
    FROM NF_COMPRA N WITH (NOLOCK)
    LEFT JOIN NF_COMPRA_ENTIDADE NE WITH (NOLOCK) ON NE.NF_COMPRA = N.NF_COMPRA
    LEFT JOIN NFE X WITH (NOLOCK) ON X.ID = N.CHAVE_NFE
    WHERE N.ENTIDADE IS NOT NULL
      AND NOT (X.ID IS NOT NULL AND ${TRANSFERENCIA('X')})
    GROUP BY N.ENTIDADE;
  `);
  return recordset;
}

module.exports = { notas, fornecedores };
