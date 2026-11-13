// Logística > NOTAS DE ENTRADA: todas as notas que chegaram para as lojas e as que já tiveram entrada.
// Diferente de "Entradas e saídas" (só quantidades, sem valores): aqui vão valores e produtos.
//
// Regras já conferidas no banco (out/2026, ver precificacao.repository.js e logistica.repository.js):
//   NF_COMPRA          a nota. O PROCFIT cria sozinho quando o XML chega. EMISSAO = data da nota,
//                      MOVIMENTO = data da compra, DATA_HORA = quando foi criada no sistema.
//                      PROCESSAR = 'S' = a logística DEU ENTRADA; DATA_PROCESSAMENTO = quando.
//                      (em 90 dias, 236 de 237 notas 'S' tinham estoque; nenhuma 'N' tinha)
//                      TOTAL_GERAL = valor da nota. CHAVE_NFE = NFE.ID (o XML).
//   NF_COMPRA_ENTIDADE NOME = fornecedor da nota.
//   NF_COMPRA_PRODUTOS os itens (só existem depois da entrada): PRODUTO, QUANTIDADE, UNIDADE_MEDIDA,
//                      QUANTIDADE_EMBALAGEM, QUANTIDADE_ESTOQUE (já convertida para a unidade do
//                      estoque), VALOR_UNITARIO, TOTAL_PRODUTO.
//   Tipo               transferência = mesma raiz de CNPJ entre emitente e destinatário no XML (o
//                      grupo usa 35.018.014) ou natureza de operação com "TRANSFER"; o resto é compra.
//   Cancelada          EdocEventosNFe, evento 110111 (cancelamento pelo emitente), pela chave.
//   Quem deu entrada   não fica gravado: a nota chega pelo eDoc com o usuário ADMIN e quem finaliza
//                      não é registrado (conferido em out/2026). Mostra o usuário só quando não é o ADMIN.
// Período: "Com entrada" = pela data da entrada; "Aguardando entrada" = pela emissão; "Todas" = a
// entrada, ou a emissão para as que ainda não entraram.

const { sql, getPool } = require('../config/db');

const LIMITE_LISTA = 3000;
const raiz = (coluna) => `LEFT(REPLACE(REPLACE(REPLACE(ISNULL(${coluna}, ''), '.', ''), '/', ''), '-', ''), 8)`;
const TRANSFERENCIA = (x) => `(${raiz(`${x}.emit_CNPJ`)} = ${raiz(`${x}.dest_CNPJ`)} OR ISNULL(${x}.natOp, '') LIKE '%TRANSFER%')`;
const QUEM = (u) => `CASE WHEN LTRIM(RTRIM(${u}.LOGIN)) = 'ADMIN' THEN NULL
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(${u}.NOME)), ''), LTRIM(RTRIM(${u}.LOGIN))) END`;

async function listar(f) {
  const pool = await getPool();
  const { recordsets } = await pool.request()
    .input('inicio', sql.VarChar(10), f.inicio)
    .input('fim', sql.VarChar(10), f.fim)
    .input('empresa', sql.Int, f.empresa ?? null)
    .input('situacao', sql.VarChar(10), f.situacao)
    .input('busca', sql.VarChar(80), f.busca ?? null)
    .query(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#N') IS NOT NULL DROP TABLE #N;
      DECLARE @ini date = CAST(@inicio AS date);
      DECLARE @ate date = DATEADD(day, 1, CAST(@fim AS date));

      SELECT N.NF_COMPRA AS id, N.NF_NUMERO AS nota, N.EMPRESA AS empresa, N.ENTIDADE AS cod_fornecedor,
             LTRIM(RTRIM(NE.NOME)) AS fornecedor,
             N.EMISSAO, N.MOVIMENTO, N.DATA_HORA, N.DATA_PROCESSAMENTO,
             CASE WHEN N.PROCESSAR = 'S' THEN 1 ELSE 0 END AS deu_entrada,
             ISNULL(N.TOTAL_GERAL, 0) AS valor, N.CHAVE_NFE AS chave, N.USUARIO_LOGADO,
             CASE WHEN X.ID IS NOT NULL AND ${TRANSFERENCIA('X')} THEN 1 ELSE 0 END AS transferencia,
             LTRIM(RTRIM(X.natOp)) AS natureza
      INTO #N
      FROM NF_COMPRA N WITH (NOLOCK)
      LEFT JOIN NF_COMPRA_ENTIDADE NE WITH (NOLOCK) ON NE.NF_COMPRA = N.NF_COMPRA
      LEFT JOIN NFE X WITH (NOLOCK) ON X.ID = N.CHAVE_NFE
      WHERE (@empresa IS NULL OR N.EMPRESA = @empresa)
        AND (
              (@situacao = 'entrada'  AND N.PROCESSAR = 'S'
                 AND COALESCE(N.DATA_PROCESSAMENTO, N.MOVIMENTO) >= @ini AND COALESCE(N.DATA_PROCESSAMENTO, N.MOVIMENTO) < @ate)
           OR (@situacao = 'pendente' AND ISNULL(N.PROCESSAR, 'N') <> 'S'
                 AND N.EMISSAO >= @ini AND N.EMISSAO < @ate)
           OR (@situacao = 'todas'
                 AND CASE WHEN N.PROCESSAR = 'S' THEN COALESCE(N.DATA_PROCESSAMENTO, N.MOVIMENTO) ELSE N.EMISSAO END >= @ini
                 AND CASE WHEN N.PROCESSAR = 'S' THEN COALESCE(N.DATA_PROCESSAMENTO, N.MOVIMENTO) ELSE N.EMISSAO END < @ate)
        )
        AND (@busca IS NULL
             OR CAST(N.NF_NUMERO AS varchar(20)) = @busca
             OR CAST(N.NF_COMPRA AS varchar(20)) = @busca
             OR NE.NOME LIKE '%' + @busca + '%'
             OR EXISTS (SELECT 1 FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
                        JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = P.PRODUTO
                        WHERE P.NF_COMPRA = N.NF_COMPRA
                          AND (CAST(PR.PRODUTO AS varchar(20)) = @busca OR PR.DESCRICAO LIKE '%' + @busca + '%')))
      OPTION (RECOMPILE);

      -- [0] Uma linha por nota
      SELECT TOP (${LIMITE_LISTA})
             N.id, N.nota, N.empresa, LTRIM(RTRIM(EU.NOME_FANTASIA)) AS loja, N.cod_fornecedor, N.fornecedor,
             CONVERT(varchar(10), N.EMISSAO, 23) AS emissao,
             CONVERT(varchar(16), N.DATA_HORA, 120) AS chegou_em,
             CONVERT(varchar(16), N.DATA_PROCESSAMENTO, 120) AS entrada_em,
             N.deu_entrada, N.valor, N.transferencia, N.natureza,
             CASE WHEN N.deu_entrada = 1 AND N.DATA_PROCESSAMENTO IS NOT NULL AND N.EMISSAO IS NOT NULL
                  THEN DATEDIFF(day, CAST(N.EMISSAO AS date), CAST(N.DATA_PROCESSAMENTO AS date)) END AS dias_ate_entrada,
             CASE WHEN N.deu_entrada = 0 AND N.EMISSAO IS NOT NULL
                  THEN DATEDIFF(day, CAST(N.EMISSAO AS date), CAST(GETDATE() AS date)) END AS dias_parada,
             CASE WHEN N.chave IS NOT NULL AND EXISTS (SELECT 1 FROM EdocEventosNFe EV WITH (NOLOCK)
                       WHERE EV.tpEvento = 110111 AND RIGHT(EV.chNFe, 44) = N.chave) THEN 1 ELSE 0 END AS cancelada,
             ISNULL(IT.itens, 0) AS itens, ISNULL(IT.quantidade, 0) AS quantidade_estoque,
             ${QUEM('U')} AS lancada_por
      FROM #N N
      LEFT JOIN EMPRESAS_USUARIAS EU WITH (NOLOCK) ON EU.EMPRESA_USUARIA = N.empresa
      LEFT JOIN USUARIOS U WITH (NOLOCK) ON U.USUARIO = N.USUARIO_LOGADO
      OUTER APPLY (SELECT COUNT(*) AS itens, SUM(ISNULL(P.QUANTIDADE_ESTOQUE, 0)) AS quantidade
                   FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK) WHERE P.NF_COMPRA = N.id) IT
      ORDER BY COALESCE(N.DATA_PROCESSAMENTO, N.DATA_HORA, N.EMISSAO) DESC;

      -- [1] Por fornecedor
      SELECT TOP 200 N.cod_fornecedor, MAX(N.fornecedor) AS fornecedor, COUNT(*) AS notas,
             SUM(N.valor) AS valor, SUM(N.deu_entrada) AS com_entrada, MAX(N.transferencia) AS transferencia
      FROM #N N
      GROUP BY N.cod_fornecedor
      ORDER BY SUM(N.valor) DESC;
    `);
  return { notas: recordsets[0], fornecedores: recordsets[1], limite: LIMITE_LISTA };
}

// Os itens de uma nota
async function itens(id) {
  const pool = await getPool();
  const { recordset } = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT P.PRODUTO AS produto, LTRIM(RTRIM(PR.DESCRICAO)) AS descricao,
             P.QUANTIDADE AS quantidade, LTRIM(RTRIM(P.UNIDADE_MEDIDA)) AS unidade,
             P.QUANTIDADE_EMBALAGEM AS embalagem, P.QUANTIDADE_ESTOQUE AS quantidade_estoque,
             P.VALOR_UNITARIO AS valor_unitario, P.TOTAL_PRODUTO AS total
      FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
      LEFT JOIN PRODUTOS PR WITH (NOLOCK) ON PR.PRODUTO = P.PRODUTO
      WHERE P.NF_COMPRA = @id
      ORDER BY PR.DESCRICAO;
    `);
  return recordset;
}

module.exports = { listar, itens, LIMITE_LISTA };
