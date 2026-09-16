// Conexão com o banco do PROCFIT (SQL Server).
// Usa um "pool": um conjunto de conexões reaproveitáveis,
// para não abrir e fechar conexão a cada requisição.

const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    useUTC: false, // datas do banco já estão no horário do Brasil
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function getPool() {
  // Cria o pool só na primeira vez; depois reaproveita.
  if (!pool) pool = await sql.connect(config);
  return pool;
}

module.exports = { sql, getPool };
