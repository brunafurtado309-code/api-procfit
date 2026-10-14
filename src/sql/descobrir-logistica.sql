/* =====================================================================
   DESCOBERTA DO BANCO PARA A TELA DE LOGÍSTICA
   RODAR NO SSMS, no banco do PROCFIT (não é usado pela API).
   Só faz leitura: nenhum comando aqui altera dados.

   O que a tela precisa e o que cada bloco responde:
     - quantidade de produtos (estoque)   -> blocos 1, 2 e 6
     - fornecedor de cada produto          -> blocos 1, 2 e 6
     - valor unitário (custo de compra)    -> blocos 1, 2 e 6
     - valor de venda (preço)              -> blocos 1, 2 e 6
     - quando um valor foi mudado          -> blocos 3, 4 e 5

   Como rodar: selecione UM bloco por vez (do comentário até o próximo)
   e aperte F5. (Cada bloco termina com GO, então rodar o arquivo
   inteiro também funciona, sem erro de variável repetida.) Em cada resultado: clique com o botão direito na grade
   -> "Copiar com cabeçalhos" e cole numa planilha (uma aba por bloco),
   ou mande um print.
   ===================================================================== */


GO

-- =====================================================================
-- BLOCO 1 — Tabelas candidatas, com a quantidade de linhas
-- Procura pelo NOME da tabela. Tabela com 0 linhas não é usada pela
-- empresa e pode ser ignorada; as maiores costumam ser as "de verdade".
-- =====================================================================
SELECT
    t.name                                  AS tabela,
    SUM(p.rows)                             AS linhas,
    CASE
        WHEN t.name LIKE '%FORNEC%'                              THEN 'fornecedor'
        WHEN t.name LIKE '%ESTOQ%' OR t.name LIKE '%SALDO%'      THEN 'estoque'
        WHEN t.name LIKE '%CUSTO%'                               THEN 'custo'
        WHEN t.name LIKE '%PRECO%' OR t.name LIKE '%TABELA%'     THEN 'preço de venda'
        WHEN t.name LIKE '%COMPR%' OR t.name LIKE '%ENTRADA%'
          OR t.name LIKE '%RECEB%MERC%' OR t.name LIKE '%NF_COMPRA%' THEN 'compra / entrada'
        WHEN t.name LIKE '%PRODUT%'                              THEN 'produto'
    END                                     AS assunto
FROM sys.tables t
LEFT JOIN sys.partitions p
       ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name LIKE '%PRODUT%'
   OR t.name LIKE '%FORNEC%'
   OR t.name LIKE '%ESTOQ%'
   OR t.name LIKE '%SALDO%'
   OR t.name LIKE '%CUSTO%'
   OR t.name LIKE '%PRECO%'
   OR t.name LIKE '%COMPR%'
   OR t.name LIKE '%ENTRADA%'
   OR t.name LIKE '%NF_COMPRA%'
GROUP BY t.name
ORDER BY assunto, linhas DESC;


GO

-- =====================================================================
-- BLOCO 2 — Colunas que interessam, dentro dessas tabelas
-- Mostra onde estão quantidade, custo, preço e fornecedor.
-- =====================================================================
SELECT
    c.TABLE_NAME   AS tabela,
    c.COLUMN_NAME  AS coluna,
    c.DATA_TYPE    AS tipo
FROM INFORMATION_SCHEMA.COLUMNS c
JOIN INFORMATION_SCHEMA.TABLES t
  ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
WHERE (c.TABLE_NAME LIKE '%PRODUT%' OR c.TABLE_NAME LIKE '%FORNEC%'
    OR c.TABLE_NAME LIKE '%ESTOQ%'  OR c.TABLE_NAME LIKE '%SALDO%'
    OR c.TABLE_NAME LIKE '%CUSTO%'  OR c.TABLE_NAME LIKE '%PRECO%'
    OR c.TABLE_NAME LIKE '%COMPR%'  OR c.TABLE_NAME LIKE '%ENTRADA%')
  AND (c.COLUMN_NAME LIKE '%PRECO%'   OR c.COLUMN_NAME LIKE '%CUSTO%'
    OR c.COLUMN_NAME LIKE '%VALOR%'   OR c.COLUMN_NAME LIKE '%QUANT%'
    OR c.COLUMN_NAME LIKE '%ESTOQ%'   OR c.COLUMN_NAME LIKE '%SALDO%'
    OR c.COLUMN_NAME LIKE '%FORNEC%'  OR c.COLUMN_NAME LIKE '%ENTIDADE%'
    OR c.COLUMN_NAME LIKE '%DATA%'    OR c.COLUMN_NAME LIKE '%USUARIO%'
    OR c.COLUMN_NAME = 'PRODUTO')
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;


GO

-- =====================================================================
-- BLOCO 3 — O banco guarda histórico de alterações?
-- 3a) Tabelas de log / histórico / auditoria criadas pelo PROCFIT
-- =====================================================================
SELECT
    t.name       AS tabela,
    SUM(p.rows)  AS linhas
FROM sys.tables t
LEFT JOIN sys.partitions p
       ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name LIKE '%LOG%'
   OR t.name LIKE '%HIST%'
   OR t.name LIKE '%AUDIT%'
   OR t.name LIKE '%ALTERA%'
   OR t.name LIKE '%TRILHA%'
   OR t.name LIKE '%MANUT%PRECO%'
   OR t.name LIKE '%REAJUST%'
GROUP BY t.name
ORDER BY linhas DESC;

-- 3b) Recursos do próprio SQL Server que guardam histórico
--     (se tudo vier 0 / vazio, o histórico só existe se o PROCFIT gravar)
SELECT
    DB_NAME()                                                    AS banco,
    (SELECT is_cdc_enabled FROM sys.databases
      WHERE name = DB_NAME())                                    AS cdc_ligado,
    (SELECT COUNT(*) FROM sys.tables WHERE temporal_type = 2)    AS tabelas_temporais,
    (SELECT COUNT(*) FROM sys.triggers WHERE parent_class = 1)   AS gatilhos_em_tabelas;


GO

-- =====================================================================
-- BLOCO 4 — Gatilhos (triggers) nas tabelas de produto e preço
-- Gatilho costuma ser o que grava o "antes e depois" num log.
-- =====================================================================
SELECT
    OBJECT_NAME(tr.parent_id)  AS tabela,
    tr.name                    AS gatilho,
    tr.is_disabled             AS desligado
FROM sys.triggers tr
WHERE tr.parent_class = 1
  AND (OBJECT_NAME(tr.parent_id) LIKE '%PRODUT%'
    OR OBJECT_NAME(tr.parent_id) LIKE '%PRECO%'
    OR OBJECT_NAME(tr.parent_id) LIKE '%CUSTO%'
    OR OBJECT_NAME(tr.parent_id) LIKE '%FORNEC%')
ORDER BY tabela;


GO

-- =====================================================================
-- BLOCO 5 — Colunas de "última alteração" nas tabelas de produto
-- Se existir DATA_HORA / ULTIMA_ALTERACAO / USUARIO_LOGADO, ao menos
-- sabemos QUANDO e QUEM mudou por último (mesmo sem o histórico todo).
-- =====================================================================
SELECT
    c.TABLE_NAME   AS tabela,
    c.COLUMN_NAME  AS coluna,
    c.DATA_TYPE    AS tipo
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE (c.TABLE_NAME LIKE '%PRODUT%' OR c.TABLE_NAME LIKE '%PRECO%' OR c.TABLE_NAME LIKE '%CUSTO%')
  AND (c.DATA_TYPE IN ('datetime', 'datetime2', 'smalldatetime', 'date')
    OR c.COLUMN_NAME LIKE '%USUARIO%')
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;


GO

-- =====================================================================
-- BLOCO 6 — Rastrear UM produto pelo banco inteiro
-- Pega o produto mais vendido dos últimos 30 dias e lista TODAS as
-- tabelas onde ele aparece. É o jeito mais rápido de achar onde ficam
-- estoque, fornecedor, custo e preço desse produto.
-- Pode levar 1 ou 2 minutos (passa por várias tabelas).
-- =====================================================================
DECLARE @produto int = (
    SELECT TOP 1 PRODUTO
    FROM VENDAS_ANALITICAS WITH (NOLOCK)
    WHERE MOVIMENTO >= DATEADD(day, -30, CAST(GETDATE() AS date))
    GROUP BY PRODUTO
    ORDER BY SUM(QUANTIDADE) DESC
);

SELECT @produto AS produto_rastreado, DESCRICAO
FROM PRODUTOS WITH (NOLOCK)
WHERE PRODUTO = @produto;

DECLARE @achados TABLE (tabela sysname, linhas int);
DECLARE @tabela sysname, @comando nvarchar(max);

DECLARE tabelas CURSOR LOCAL FAST_FORWARD FOR
    SELECT c.TABLE_NAME
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES t
      ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
    WHERE c.COLUMN_NAME = 'PRODUTO'
      AND c.DATA_TYPE IN ('int', 'bigint', 'numeric', 'decimal', 'smallint');

OPEN tabelas;
FETCH NEXT FROM tabelas INTO @tabela;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- Conta no máximo 1000 linhas por tabela, para não pesar no banco
    SET @comando = N'SELECT @n = COUNT(*) FROM (SELECT TOP 1000 1 AS x FROM '
                 + QUOTENAME(@tabela) + N' WITH (NOLOCK) WHERE PRODUTO = @p) q';
    DECLARE @n int = 0;
    BEGIN TRY
        EXEC sp_executesql @comando, N'@p int, @n int OUTPUT', @p = @produto, @n = @n OUTPUT;
        IF @n > 0 INSERT INTO @achados VALUES (@tabela, @n);
    END TRY
    BEGIN CATCH
        -- tabela sem permissão de leitura: só pula
    END CATCH
    FETCH NEXT FROM tabelas INTO @tabela;
END
CLOSE tabelas;
DEALLOCATE tabelas;

SELECT tabela, linhas AS linhas_do_produto
FROM @achados
ORDER BY tabela;


GO

-- =====================================================================
-- BLOCO 7 — Prova com UM produto: confirmar o que cada número significa
-- (montado depois dos resultados dos blocos 1 e 2, em 14/10/2026)
--
-- Antes de rodar: aperte Ctrl+T (resultados em TEXTO). Assim todas as
-- respostas saem num texto só: clique nele, Ctrl+A, Ctrl+C e cole num
-- arquivo .txt. Para voltar à grade depois: Ctrl+D.
--
-- Por padrão usa o produto mais vendido dos últimos 30 dias. Para olhar
-- outro, troque a linha do @produto por:  DECLARE @produto numeric(15) = 123;
-- =====================================================================
SET NOCOUNT ON;

DECLARE @produto numeric(15) = (
    SELECT TOP 1 PRODUTO
    FROM VENDAS_ANALITICAS WITH (NOLOCK)
    WHERE MOVIMENTO >= DATEADD(day, -30, CAST(GETDATE() AS date))
    GROUP BY PRODUTO
    ORDER BY SUM(QUANTIDADE) DESC
);

PRINT '=== 7.1 Produto ===';
SELECT PRODUTO, DESCRICAO
FROM PRODUTOS WITH (NOLOCK)
WHERE PRODUTO = @produto;

PRINT '=== 7.2 Tabelas de preço (GRUPOS_PRECOS) ===';
SELECT * FROM GRUPOS_PRECOS WITH (NOLOCK);

PRINT '=== 7.3 Preço de venda por tabela de preço (PRODUTOS_VENDAS) ===';
SELECT GRUPO_PRECO, PRECO_VENDA, PRECO_VENDA_LIQUIDO, CUSTO_MEDIO, ULTIMO_CUSTO_ENTRADA_VALIDADO,
       MARGEM_BRUTA_PERCENTUAL, DATA_HORA_ALTERACAO_PRECO_VENDA, NOME_USUARIO_ALTERACAO_PRECO_VENDA,
       DATA_HORA_ATUALIZACAO_PRECO, USUARIO_ALTERACAO
FROM PRODUTOS_VENDAS WITH (NOLOCK)
WHERE PRODUTO = @produto;

PRINT '=== 7.4 Preço de venda por empresa (PRODUTOS_PARAMETROS_EMPRESAS) ===';
SELECT EMPRESA, PRECO_VENDA, PRECO_VENDA_ANTIGO, ULTIMA_ALTERACAO_PRECO, DATA_HORA_ATUALIZ_PRECO,
       CUSTO, ESTOQUE_MINIMO, ESTOQUE_MAXIMO, ULTIMA_ATUALIZACAO
FROM PRODUTOS_PARAMETROS_EMPRESAS WITH (NOLOCK)
WHERE PRODUTO = @produto;

PRINT '=== 7.5 Histórico do preço de venda (LOG_PRODUTOS_VENDAS, 20 mais recentes) ===';
SELECT TOP 20 DATA_HORA_GRAVACAO_LOG, TIPO_LOG, GRUPO_PRECO, PRECO_VENDA, DESCONTO_MAXIMO,
       USER_NAME, APP_NAME, HOST_NAME, OBJETO_ORIGEM
FROM LOG_PRODUTOS_VENDAS WITH (NOLOCK)
WHERE PRODUTO = @produto
ORDER BY DATA_HORA_GRAVACAO_LOG DESC;

PRINT '=== 7.6 Últimas compras: fornecedor e valor unitário (NF_COMPRA_PRODUTOS) ===';
SELECT TOP 10
    N.MOVIMENTO, N.EMPRESA, N.NF_NUMERO, N.ENTIDADE AS cod_fornecedor, NE.NOME AS fornecedor,
    P.QUANTIDADE, P.QUANTIDADE_EMBALAGEM, P.QUANTIDADE_ESTOQUE, P.UNIDADE_MEDIDA,
    P.VALOR_UNITARIO, P.CUSTO_UNITARIO, P.TOTAL_PRODUTO, P.PRECO_VENDA
FROM NF_COMPRA_PRODUTOS P WITH (NOLOCK)
JOIN NF_COMPRA N WITH (NOLOCK) ON N.NF_COMPRA = P.NF_COMPRA
LEFT JOIN NF_COMPRA_ENTIDADE NE WITH (NOLOCK) ON NE.NF_COMPRA = N.NF_COMPRA
WHERE P.PRODUTO = @produto
ORDER BY N.MOVIMENTO DESC;

PRINT '=== 7.7 Fornecedores cadastrados para o produto (PRODUTOS_FORNECEDORES) ===';
SELECT PF.ENTIDADE, E.NOME, PF.TIPO_FORNECEDOR, PF.VALOR_UNITARIO, PF.QUANTIDADE_EMBALAGEM, PF.UNIDADE_MEDIDA
FROM PRODUTOS_FORNECEDORES PF WITH (NOLOCK)
LEFT JOIN ENTIDADES E WITH (NOLOCK) ON E.ENTIDADE = PF.ENTIDADE
WHERE PF.PRODUTO = @produto;

PRINT '=== 7.8 Último custo por empresa (ULTIMO_CUSTO_PRODUTOS_EMPRESAS) ===';
SELECT EMPRESA, DATA, NF_NUMERO, PRECO_COMPRA, PRECO_COMPRA_BRUTO, ULTIMO_CUSTO, CUSTO_FINAL_LIQUIDO, QUANTIDADE_ESTOQUE
FROM ULTIMO_CUSTO_PRODUTOS_EMPRESAS WITH (NOLOCK)
WHERE PRODUTO = @produto;

PRINT '=== 7.9 Locais de estoque (CENTROS_ESTOQUE) ===';
SELECT * FROM CENTROS_ESTOQUE WITH (NOLOCK);

PRINT '=== 7.10 Últimos movimentos de estoque (ESTOQUE_LANCAMENTOS) ===';
SELECT TOP 15 DATA_HORA, CENTRO_ESTOQUE, TIPO_MOVIMENTO, FORMULARIO_ORIGEM, DOCUMENTO,
       ESTOQUE_ENTRADA, ESTOQUE_SAIDA, ESTOQUE_SALDO, CUSTO, CUSTO_MEDIO
FROM ESTOQUE_LANCAMENTOS WITH (NOLOCK)
WHERE PRODUTO = @produto
ORDER BY DATA_HORA DESC, ESTOQUE DESC;

PRINT '=== 7.11 Estoque fechado por mês (ESTOQUE_AGRUPADO_EMPRESAS) ===';
SELECT TOP 6 ANO, MES, EMPRESA, TOTAL_ESTOQUE_UNIDADES, TOTAL_ESTOQUE_VALOR, DATA_BASE
FROM ESTOQUE_AGRUPADO_EMPRESAS WITH (NOLOCK)
WHERE PRODUTO = @produto
ORDER BY ANO DESC, MES DESC;

PRINT '=== 7.12 Custo médio dia a dia (CUSTO_MEDIO_DIARIO_EMPRESA_CUSTO) ===';
SELECT TOP 10 MOVIMENTO, EMPRESA_CUSTO, ESTOQUE_SALDO, CUSTO_GERENCIAL, CUSTO_CONTABIL, TIPO_CUSTO
FROM CUSTO_MEDIO_DIARIO_EMPRESA_CUSTO WITH (NOLOCK)
WHERE PRODUTO = @produto
ORDER BY MOVIMENTO DESC;

PRINT '=== 7.13 Movimentos de estoque alterados ou apagados (ESTOQUE_LANCAMENTOS_LOG) ===';
SELECT TOP 10 DATA_HORA_LOG, TIPO_LOG, CENTRO_ESTOQUE, ESTOQUE_ENTRADA, ESTOQUE_SAIDA, ESTOQUE_SALDO,
       PROCEDURE_EXECUTADA, USER_NAME, APP_NAME
FROM ESTOQUE_LANCAMENTOS_LOG WITH (NOLOCK)
WHERE PRODUTO = @produto
ORDER BY DATA_HORA_LOG DESC;
GO
