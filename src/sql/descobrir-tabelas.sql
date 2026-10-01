/* =====================================================================
   RODAR NO SSMS, no banco do PROCFIT (não é usado pela API).
   Serve para achar as tabelas e colunas de títulos a receber,
   e montar o conciliacao-titulos.sql.
   ===================================================================== */

-- 1) Tabelas que têm coluna de vencimento (onde os títulos costumam morar)
SELECT DISTINCT
    c.TABLE_SCHEMA  AS esquema,
    c.TABLE_NAME    AS tabela,
    c.COLUMN_NAME   AS coluna,
    c.DATA_TYPE     AS tipo
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.COLUMN_NAME LIKE '%VENC%'
ORDER BY c.TABLE_NAME;

-- 2) Tabelas com nomes ligados a financeiro / receber / títulos
SELECT TABLE_SCHEMA AS esquema, TABLE_NAME AS tabela, TABLE_TYPE AS tipo
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE '%TITUL%'
   OR TABLE_NAME LIKE '%RECEB%'
   OR TABLE_NAME LIKE '%FINANC%'
   OR TABLE_NAME LIKE '%PARCEL%'
   OR TABLE_NAME LIKE '%BAIXA%'
ORDER BY TABLE_NAME;

-- 3) Depois de achar a tabela candidata, veja as colunas dela
--    (troque NOME_DA_TABELA):
-- SELECT COLUMN_NAME, DATA_TYPE
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'NOME_DA_TABELA'
-- ORDER BY ORDINAL_POSITION;

-- 4) E uma amostra dos dados:
-- SELECT TOP 20 * FROM NOME_DA_TABELA ORDER BY 1 DESC;

-- 5) Tabelas de PEDIDOS (para a lista "Pedidos sem nota")
SELECT TABLE_SCHEMA AS esquema, TABLE_NAME AS tabela, TABLE_TYPE AS tipo
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE '%PEDID%'
   OR TABLE_NAME LIKE '%ORCAM%'
   OR TABLE_NAME LIKE '%VENDA%'
ORDER BY TABLE_NAME;
