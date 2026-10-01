// Camada de dados da CONCILIAÇÃO: consultas SQL de títulos e pedidos sem nota.
// As consultas ficam em src/sql para ficar fácil de ler e ajustar.
// As regras de títulos são as mesmas do financeiro.repository.js.

const fs = require('fs');
const path = require('path');
const { sql, getPool } = require('../config/db');

const PASTA_SQL = path.join(__dirname, '..', 'sql');

// Coluna de CPF/CNPJ do cadastro ENTIDADES.
// A API procura sozinha na primeira consulta e guarda o resultado.
let colunasDocumento; // undefined = ainda não procurou

async function expressaoDocumento(pool) {
  if (colunasDocumento === undefined) {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'ENTIDADES'
        AND (COLUMN_NAME LIKE '%CNPJ%' OR COLUMN_NAME LIKE '%CPF%' OR COLUMN_NAME LIKE 'INSCRICAO_FEDERAL%')
      ORDER BY
        CASE WHEN COLUMN_NAME LIKE '%CNPJ%' AND COLUMN_NAME LIKE '%CPF%' THEN 0
             WHEN COLUMN_NAME LIKE 'INSCRICAO_FEDERAL%' THEN 1
             ELSE 2 END,
        ORDINAL_POSITION`);
    colunasDocumento = r.recordset
      .map(l => l.COLUMN_NAME)
      .filter(nome => typeof nome === 'string' && /^[A-Za-z0-9_]+$/.test(nome))
      .slice(0, 2);
    console.log(colunasDocumento.length
      ? `[conciliacao] CPF/CNPJ lido de ENTIDADES.${colunasDocumento.join(' / ')}`
      : '[conciliacao] Coluna de CPF/CNPJ não encontrada em ENTIDADES: a conciliação usa nome e valor.');
  }
  if (!colunasDocumento.length) return 'CAST(NULL AS varchar(30))';
  const partes = colunasDocumento.map(c => `NULLIF(LTRIM(RTRIM(CAST(E.[${c}] AS varchar(30)))), '')`);
  return partes.length === 1 ? partes[0] : `COALESCE(${partes.join(', ')})`;
}

async function executarConsulta(arquivo, inicio, fim) {
  let consulta = fs.readFileSync(path.join(PASTA_SQL, arquivo), 'utf8');

  // Olha só o código SQL (sem os comentários) para saber se ainda falta preencher
  const semComentarios = consulta.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  if (semComentarios.includes('PREENCHER_')) {
    return {
      naoConfigurado: true,
      mensagem: `A consulta ${arquivo} ainda não foi configurada com as tabelas do PROCFIT.`
    };
  }

  const pool = await getPool();
  if (consulta.includes('{{CPF_CNPJ}}')) {
    consulta = consulta.split('{{CPF_CNPJ}}').join(await expressaoDocumento(pool));
  }

  const resultado = await pool.request()
    .input('inicio', sql.Date, inicio)
    .input('fim', sql.Date, fim)
    .query(consulta);

  return { dados: resultado.recordset };
}

module.exports = { executarConsulta };
