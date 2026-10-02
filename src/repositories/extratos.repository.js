// Extratos do banco guardados no painel (Postgres no Neon, o mesmo banco dos usuários).
//
// Por que guardar: o PROCFIT ainda não recebe o extrato do banco. Assim, cada arquivo do Itaú
// (ou da Rede, ou de boletos) é enviado UMA vez; a Conciliação passa a ler os lançamentos daqui
// sozinha, mês a mês, sem precisar escolher o arquivo de novo.
//
// Lançamento repetido não entra duas vezes: cada um tem uma "impressão digital" (hash) feita de
// conta + origem + data + valor + descrição + documento + chave + ordem dentro do arquivo.
// Mandar o mesmo arquivo de novo, ou dois arquivos com dias em comum, não duplica nada.

const crypto = require('crypto');
const { db } = require('../config/usuariosDb');

let tabelaPronta = null;

async function conexao() {
  const pool = await db();
  if (!tabelaPronta) {
    tabelaPronta = pool.query(`
      CREATE TABLE IF NOT EXISTS extrato_lancamentos (
        hash          TEXT PRIMARY KEY,
        conta         TEXT NOT NULL DEFAULT '',
        origem        TEXT NOT NULL,
        data          DATE NOT NULL,
        valor         NUMERIC(14, 2) NOT NULL,
        descricao     TEXT,
        nome          TEXT,
        documento     TEXT,
        chave         TEXT,
        agrupado      BOOLEAN NOT NULL DEFAULT false,
        pix           BOOLEAN NOT NULL DEFAULT false,
        arquivo       TEXT,
        importado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
        importado_por TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_extrato_lancamentos_data ON extrato_lancamentos (data);
    `).catch((err) => {
      tabelaPronta = null; // tenta de novo na próxima chamada
      throw err;
    });
  }
  await tabelaPronta;
  return pool;
}

const texto = (v, max = 300) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

// Guarda os lançamentos de um arquivo. Devolve quantos eram novos e quantos já existiam.
async function guardar({ arquivo, conta, origem, entradas }, usuario) {
  const pool = await conexao();
  const vistos = new Map();
  const linhas = entradas.map((e) => {
    const base = [texto(conta), texto(origem), e.data, Number(e.valor).toFixed(2),
      texto(e.desc), texto(e.doc), texto(e.chave)].join('|');
    const ordem = (vistos.get(base) || 0) + 1; // dois lançamentos iguais no mesmo dia continuam sendo dois
    vistos.set(base, ordem);
    return {
      hash: crypto.createHash('sha1').update(`${base}|${ordem}`).digest('hex'),
      conta: texto(conta, 40), origem: texto(origem, 20), data: e.data, valor: Number(e.valor),
      descricao: texto(e.desc), nome: texto(e.nome, 200), documento: texto(e.doc, 30), chave: texto(e.chave, 80),
      agrupado: !!e.agrupado, pix: !!e.pix,
    };
  });
  if (!linhas.length) return { novos: 0, repetidos: 0 };

  const col = (k) => linhas.map((l) => l[k]);
  const { rowCount } = await pool.query(`
    INSERT INTO extrato_lancamentos
      (hash, conta, origem, data, valor, descricao, nome, documento, chave, agrupado, pix, arquivo, importado_por)
    SELECT h, c, o, d::date, v, ds, n, doc, ch, ag, px, $12, $13
    FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::text[],
                $8::text[], $9::text[], $10::boolean[], $11::boolean[])
         AS t(h, c, o, d, v, ds, n, doc, ch, ag, px)
    ON CONFLICT (hash) DO NOTHING`,
  [col('hash'), col('conta'), col('origem'), col('data'), col('valor'), col('descricao'), col('nome'),
    col('documento'), col('chave'), col('agrupado'), col('pix'), texto(arquivo, 200), texto(usuario, 120) || null]);
  return { novos: rowCount, repetidos: linhas.length - rowCount };
}

// Lançamentos do mês (todas as contas e arquivos)
async function doMes(mes) {
  const pool = await conexao();
  const [ano, m] = mes.split('-').map(Number);
  const inicio = `${mes}-01`;
  const fim = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, '0')}-01`;
  const { rows } = await pool.query(`
    SELECT hash AS id, conta, origem, to_char(data, 'YYYY-MM-DD') AS data, valor::float AS valor,
           descricao, nome, documento, chave, agrupado, pix, arquivo
    FROM extrato_lancamentos
    WHERE data >= $1::date AND data < $2::date
    ORDER BY data, hash`, [inicio, fim]);
  return rows;
}

// Arquivos já enviados (para conferir o que está guardado)
async function importacoes() {
  const pool = await conexao();
  const { rows } = await pool.query(`
    SELECT arquivo, conta, origem, COUNT(*)::int AS lancamentos,
           to_char(MIN(data), 'YYYY-MM-DD') AS de, to_char(MAX(data), 'YYYY-MM-DD') AS ate,
           to_char(MAX(importado_em) AT TIME ZONE 'America/Fortaleza', 'YYYY-MM-DD HH24:MI') AS enviado_em,
           MAX(importado_por) AS enviado_por
    FROM extrato_lancamentos
    GROUP BY arquivo, conta, origem
    ORDER BY MAX(importado_em) DESC
    LIMIT 100`);
  return rows;
}

// Remove todos os lançamentos de um arquivo (para corrigir um envio errado)
async function removerArquivo(arquivo) {
  const pool = await conexao();
  const { rowCount } = await pool.query('DELETE FROM extrato_lancamentos WHERE arquivo = $1', [texto(arquivo, 200)]);
  return { removidos: rowCount };
}

module.exports = { guardar, doMes, importacoes, removerArquivo };
