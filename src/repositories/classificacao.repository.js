// Classificações da precificação guardadas no painel (Postgres no Neon, o mesmo banco dos usuários).
//
// Por que aqui e não no PROCFIT: o PROCFIT não tem essa diferença (revenda, produção, uso e consumo)
// e a API só lê o banco dele. Quem decide é uma pessoa, na tela; a decisão fica guardada aqui.
//
// Uma tabela serve para tudo que se classifica ("alvo"):
//   fornecedor  código da entidade no PROCFIT (NF_COMPRA.ENTIDADE)
//   nota        código da nota de compra (NF_COMPRA.NF_COMPRA), para fornecedor que manda as duas coisas
//   produto     (próximo passo) código do produto
// Toda mudança vira uma linha no histórico: o que era, o que ficou, quem mudou e quando.

const { db } = require('../config/usuariosDb');

let tabelasProntas = null;

async function conexao() {
  const pool = await db();
  if (!tabelasProntas) {
    tabelasProntas = pool.query(`
      CREATE TABLE IF NOT EXISTS precificacao_classificacao (
        alvo        TEXT NOT NULL,
        codigo      BIGINT NOT NULL,
        tipo        TEXT NOT NULL,
        alterado_por TEXT,
        alterado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (alvo, codigo)
      );
      CREATE TABLE IF NOT EXISTS precificacao_classificacao_historico (
        id          SERIAL PRIMARY KEY,
        alvo        TEXT NOT NULL,
        codigo      BIGINT NOT NULL,
        antes       TEXT,
        depois      TEXT,
        alterado_por TEXT,
        alterado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ix_precificacao_historico_alvo
        ON precificacao_classificacao_historico (alvo, codigo);
    `).catch((err) => {
      tabelasProntas = null; // tenta de novo na próxima chamada
      throw err;
    });
  }
  await tabelasProntas;
  return pool;
}

// Todas as classificações de um alvo, num Map: código -> { tipo, alterado_por, alterado_em }
async function listar(alvo) {
  const pool = await conexao();
  const { rows } = await pool.query(
    'SELECT codigo, tipo, alterado_por, alterado_em FROM precificacao_classificacao WHERE alvo = $1',
    [alvo],
  );
  return new Map(rows.map((r) => [Number(r.codigo), {
    tipo: r.tipo, alterado_por: r.alterado_por, alterado_em: r.alterado_em,
  }]));
}

// Grava (ou apaga, com tipo null) a classificação de um código e registra no histórico.
// Roda dentro da transação de quem chamou. Devolve true se mudou alguma coisa.
async function gravarUm(cliente, alvo, codigo, tipo, usuario) {
  const atual = await cliente.query(
    'SELECT tipo FROM precificacao_classificacao WHERE alvo = $1 AND codigo = $2 FOR UPDATE',
    [alvo, codigo],
  );
  const antes = atual.rows[0]?.tipo ?? null;
  if (antes === tipo) return false;
  if (tipo === null) {
    await cliente.query('DELETE FROM precificacao_classificacao WHERE alvo = $1 AND codigo = $2', [alvo, codigo]);
  } else {
    await cliente.query(
      `INSERT INTO precificacao_classificacao (alvo, codigo, tipo, alterado_por, alterado_em)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (alvo, codigo)
       DO UPDATE SET tipo = EXCLUDED.tipo, alterado_por = EXCLUDED.alterado_por, alterado_em = now()`,
      [alvo, codigo, tipo, usuario],
    );
  }
  await cliente.query(
    `INSERT INTO precificacao_classificacao_historico (alvo, codigo, antes, depois, alterado_por)
     VALUES ($1, $2, $3, $4, $5)`,
    [alvo, codigo, antes, tipo, usuario],
  );
  return true;
}

// Grava o mesmo tipo para um ou vários códigos, tudo de uma vez: se um falhar, nenhum é gravado
// (transação). Devolve quantos mudaram de fato (os que já tinham esse tipo não contam).
async function definir(alvo, codigos, tipo, usuario) {
  const lista = Array.isArray(codigos) ? codigos : [codigos];
  const pool = await conexao();
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    let mudaram = 0;
    for (const codigo of lista) {
      if (await gravarUm(cliente, alvo, codigo, tipo, usuario)) mudaram += 1;
    }
    await cliente.query('COMMIT');
    return { mudou: mudaram > 0, mudaram };
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = { listar, definir };
