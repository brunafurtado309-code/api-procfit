// Regras de cadastro, login e aprovacao de usuarios do painel.

const crypto = require('crypto');
const { db } = require('../config/usuariosDb');
const { SETORES, PREFIXO_SESSAO } = require('../middlewares/auth');

const HORAS_SESSAO = 12;

// Conta principal: o e-mail definido em ADMIN_EMAIL (no Render/.env).
// Ela entra ja liberada, ve todas as telas e e a unica que libera acessos.
const emailPrincipal = () => String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ehPrincipal = (email) => !!emailPrincipal() && String(email || '').toLowerCase() === emailPrincipal();
const STATUS = ['pendente', 'aprovado', 'bloqueado'];

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

// ---- Senhas: guardadas com scrypt (ninguem consegue ler a senha original) ----
const scrypt = (senha, sal) =>
  new Promise((ok, falha) => crypto.scrypt(senha, sal, 64, (e, chave) => (e ? falha(e) : ok(chave))));

async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(senha, sal);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

async function conferirSenha(senha, guardado) {
  const [alg, salHex, hashHex] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !salHex || !hashHex) return false;
  const hash = await scrypt(senha, Buffer.from(salHex, 'hex'));
  const esperado = Buffer.from(hashHex, 'hex');
  return hash.length === esperado.length && crypto.timingSafeEqual(hash, esperado);
}

// O token de login nunca fica salvo puro no banco, so o "resumo" dele.
const resumoToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ---- Cadastro ----
async function cadastrar({ nome, email, senha }) {
  nome = String(nome || '').trim();
  email = String(email || '').trim().toLowerCase();
  senha = String(senha || '');

  if (nome.length < 2 || nome.length > 80) throw erro(400, 'Informe o seu nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw erro(400, 'Informe um e-mail v\u00e1lido.');
  if (senha.length < 8) throw erro(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (senha.length > 100) throw erro(400, 'A senha pode ter no m\u00e1ximo 100 caracteres.');

  const principal = ehPrincipal(email);
  const pool = await db();
  try {
    await pool.query('INSERT INTO usuarios (nome, email, senha, status, setores) VALUES ($1, $2, $3, $4, $5)', [
      nome,
      email,
      await gerarHash(senha),
      principal ? 'aprovado' : 'pendente',
      principal ? SETORES : [],
    ]);
  } catch (err) {
    if (err.code === '23505') throw erro(409, 'Este e-mail j\u00e1 est\u00e1 cadastrado.');
    throw err;
  }

  if (principal) return { ok: true, mensagem: 'Conta principal criada! J\u00e1 pode entrar.' };
  return { ok: true, mensagem: 'Cadastro enviado! Aguarde a libera\u00e7\u00e3o do administrador para entrar.' };
}

// ---- Login ----
async function entrar({ email, senha }) {
  email = String(email || '').trim().toLowerCase();
  senha = String(senha || '');
  if (!email || !senha) throw erro(400, 'Informe e-mail e senha.');

  const pool = await db();
  const { rows } = await pool.query('SELECT id, nome, senha, status, setores FROM usuarios WHERE email = $1', [email]);
  const usuario = rows[0];

  if (!usuario || !(await conferirSenha(senha, usuario.senha))) throw erro(401, 'E-mail ou senha inv\u00e1lidos.');
  if (ehPrincipal(email)) {
    usuario.status = 'aprovado';
    usuario.setores = SETORES;
  }
  if (usuario.status === 'pendente') throw erro(403, 'Seu cadastro ainda est\u00e1 aguardando libera\u00e7\u00e3o do administrador.');
  if (usuario.status !== 'aprovado') throw erro(403, 'Seu acesso est\u00e1 bloqueado. Fale com o administrador.');
  if (!usuario.setores.length) throw erro(403, 'Nenhuma tela foi liberada para voc\u00ea ainda. Fale com o administrador.');

  const token = PREFIXO_SESSAO + crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM sessoes WHERE expira_em < now()');
  await pool.query(
    `INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES ($1, $2, now() + interval '${HORAS_SESSAO} hours')`,
    [resumoToken(token), usuario.id]
  );

  return { token, nome: usuario.nome, setores: usuario.setores };
}

async function sair(token) {
  if (String(token || '').startsWith(PREFIXO_SESSAO)) {
    const pool = await db();
    await pool.query('DELETE FROM sessoes WHERE token_hash = $1', [resumoToken(token)]);
  }
  return { ok: true };
}

// Usado pela verificacao de acesso: le as telas do usuario a cada pedido,
// entao qualquer mudanca feita pelo admin vale na hora.
async function sessaoPorToken(token) {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT u.nome, u.email, u.status, u.setores
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_em > now()`,
    [resumoToken(token)]
  );
  const usuario = rows[0];
  if (!usuario) return null;
  if (ehPrincipal(usuario.email)) return { nome: usuario.nome, setores: SETORES, mestre: true };
  if (usuario.status !== 'aprovado') return null;
  return { nome: usuario.nome, setores: usuario.setores, mestre: false };
}

// ---- Administracao ----
async function listar() {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT id, nome, email, status, setores, criado_em
       FROM usuarios
      ORDER BY (status = 'pendente') DESC, criado_em DESC`
  );
  return { setores: SETORES, usuarios: rows };
}

async function atualizar(id, { status, setores }) {
  id = Number(id);
  if (!Number.isInteger(id) || id <= 0) throw erro(400, 'Usu\u00e1rio inv\u00e1lido.');
  if (status !== undefined && !STATUS.includes(status)) throw erro(400, 'Situa\u00e7\u00e3o inv\u00e1lida.');
  if (setores !== undefined) {
    if (!Array.isArray(setores) || setores.some((s) => !SETORES.includes(s))) throw erro(400, 'Telas inv\u00e1lidas.');
    setores = [...new Set(setores)];
  }

  const pool = await db();
  const alvo = await pool.query('SELECT email FROM usuarios WHERE id = $1', [id]);
  if (!alvo.rows[0]) throw erro(404, 'Usu\u00e1rio n\u00e3o encontrado.');
  if (ehPrincipal(alvo.rows[0].email)) throw erro(403, 'A conta principal n\u00e3o pode ser alterada.');

  const { rows } = await pool.query(
    `UPDATE usuarios
        SET status = COALESCE($2, status),
            setores = COALESCE($3, setores),
            atualizado_em = now()
      WHERE id = $1
  RETURNING id, nome, email, status, setores, criado_em`,
    [id, status ?? null, setores ?? null]
  );
  if (!rows[0]) throw erro(404, 'Usu\u00e1rio n\u00e3o encontrado.');

  // Bloqueou ou voltou para pendente: derruba quem estiver logado
  if (rows[0].status !== 'aprovado') {
    await pool.query('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
  }
  return rows[0];
}

module.exports = { cadastrar, entrar, sair, sessaoPorToken, listar, atualizar, HORAS_SESSAO };