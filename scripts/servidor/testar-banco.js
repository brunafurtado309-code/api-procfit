// Testa a conexão com o banco usando o .env do projeto.
// Mostra só o resultado (nunca a senha). Sai com código 0 se conectou.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const sql = require('mssql');

// O aviso de TLS por IP é inofensivo; não precisa aparecer aqui
process.removeAllListeners('warning');

const faltando = ['DB_SERVER', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD', 'API_KEY']
  .filter((k) => !process.env[k]);
if (faltando.length) {
  console.log(`Variaveis vazias no .env: ${faltando.join(', ')}`);
  process.exit(1);
}

console.log(`Conectando em ${process.env.DB_SERVER}:${process.env.DB_PORT}...`);
sql.connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true },
  connectionTimeout: 15000,
})
  .then((pool) => pool.request().query('SELECT DB_NAME() AS banco'))
  .then((r) => {
    console.log(`Conectou no banco ${r.recordset[0].banco}.`);
    process.exit(0);
  })
  .catch((e) => {
    console.log(`Falhou: ${e.code || ''} ${e.message}`);
    process.exit(1);
  });
