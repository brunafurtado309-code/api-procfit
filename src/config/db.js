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
  // Tempo máximo que uma consulta pode levar. Sem isto, o pacote mssql usa 15 s,
  // e as consultas pesadas (ex.: faturamento por vendedor no mês inteiro) passavam disso.
  // Dá para mudar sem mexer no código: DB_REQUEST_TIMEOUT_MS no .env / no Render.
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS) || 90000,
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

let pool = null;
let conectando = null;

async function getPool() {
  // Já conectado: reaproveita
  if (pool && pool.connected) return pool;

  // Várias requisições ao mesmo tempo esperam a MESMA tentativa de conexão
  if (!conectando) {
    conectando = (async () => {
      try {
        // Se havia um pool quebrado, fecha antes de abrir outro
        if (pool) await pool.close().catch(() => {});
        const novo = new sql.ConnectionPool(config);
        // Erro no pool (ex.: rede caiu) não pode derrubar a API: só registra.
        // Na próxima requisição, getPool() percebe e reconecta.
        novo.on('error', (err) => {
          console.error(`[${new Date().toLocaleString('pt-BR')}] Erro na conexão com o banco:`, err.message);
        });
        pool = await novo.connect();
        return pool;
      } catch (err) {
        pool = null;
        throw err;
      } finally {
        conectando = null;
      }
    })();
  }
  return conectando;
}

module.exports = { sql, getPool };
