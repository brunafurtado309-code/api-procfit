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
   e aperte F5. Em cada resultado: clique com o botão direito na grade
   -> "Copiar com cabeçalhos" e cole numa planilha (uma aba por bloco),
   ou mande um print.
   ===================================================================== */


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
