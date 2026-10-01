// Conexao com o banco de USUARIOS do painel (Postgres no Neon).
// E separado do banco do PROCFIT: aqui a API escreve; no PROCFIT ela so le.

const { Pool } = require('pg');

let pool = null;
let tabelasProntas = null;

function erroConfiguracao() {
  const erro = new Error('Banco de usuários não configurado (falta a DATABASE_URL).');
  erro.status = 503;
  return erro;
}

// Devolve a conexao pronta, criando as tabelas na primeira vez.
async function db() {
  if (!process.env.DATABASE_URL) throw erroConfiguracao();

  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: true, max: 5 });
  }

  if (!tabelasProntas) {
    tabelasProntas = pool
      .query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id            SERIAL PRIMARY KEY,
          nome          TEXT NOT NULL,
          email         TEXT NOT NULL UNIQUE,
          senha         TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'pendente',
          setores       TEXT[] NOT NULL DEFAULT '{}',
          criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS sessoes (
          token_hash TEXT PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          expira_em  TIMESTAMPTZ NOT NULL
        );
      `)
      .catch((err) => {
        tabelasProntas = null; // tenta de novo na proxima chamada
        throw err;
      });
  }

  await tabelasProntas;
  return pool;
}

module.exports = { db };
