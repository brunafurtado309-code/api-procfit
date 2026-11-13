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
  const { rows } = await pool.query('SELECT id, nome, senha, status, setores, troca_senha FROM usuarios WHERE email = $1', [email]);
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

  return { token, nome: usuario.nome, setores: usuario.setores, trocarSenha: usuario.troca_senha };
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
    `SELECT u.nome, u.email, u.status, u.setores, u.troca_senha
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_em > now()`,
    [resumoToken(token)]
  );
  const usuario = rows[0];
  if (!usuario) return null;
  const trocaSenha = !!usuario.troca_senha;
  if (ehPrincipal(usuario.email)) return { nome: usuario.nome, setores: SETORES, mestre: true, trocaSenha };
  if (usuario.status !== 'aprovado') return null;
  return { nome: usuario.nome, setores: usuario.setores, mestre: false, trocaSenha };
}

// ---- Administracao ----
async function listar() {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT id, nome, email, status, setores, criado_em, troca_senha, pediu_senha_em
       FROM usuarios
      ORDER BY (status = 'pendente') DESC, (pediu_senha_em IS NOT NULL) DESC, criado_em DESC`
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

// ---- Senhas (nov/2026) ----
function validarSenhaNova(senha) {
  senha = String(senha || '');
  if (senha.length < 8) throw erro(400, 'A senha nova precisa ter pelo menos 8 caracteres.');
  if (senha.length > 100) throw erro(400, 'A senha pode ter no máximo 100 caracteres.');
  return senha;
}

// Senha provisoria facil de ditar: sem letras que confundem (0/O, 1/l/I)
function senhaProvisoria() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const parte = () => Array.from({ length: 4 }, () => letras[crypto.randomInt(letras.length)]).join('');
  return `${parte()}-${parte()}-${parte()}`;
}

// Quem esta logado troca a propria senha (confere a atual antes).
// As outras sessoes dessa pessoa caem; a de agora continua.
async function trocarSenha(token, { senhaAtual, senhaNova }) {
  if (!String(token || '').startsWith(PREFIXO_SESSAO)) throw erro(401, 'Entre no painel com o seu login para trocar a senha.');
  senhaNova = validarSenhaNova(senhaNova);

  const pool = await db();
  const { rows } = await pool.query(
    `SELECT u.id, u.senha FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_em > now()`,
    [resumoToken(token)]
  );
  const usuario = rows[0];
  if (!usuario) throw erro(401, 'Sua sessão expirou. Entre de novo.');
  if (!(await conferirSenha(String(senhaAtual || ''), usuario.senha))) throw erro(400, 'A senha atual não confere.');
  if (await conferirSenha(senhaNova, usuario.senha)) throw erro(400, 'A senha nova precisa ser diferente da atual.');

  await pool.query(
    `UPDATE usuarios SET senha = $2, troca_senha = false, pediu_senha_em = NULL, atualizado_em = now() WHERE id = $1`,
    [usuario.id, await gerarHash(senhaNova)]
  );
  await pool.query('DELETE FROM sessoes WHERE usuario_id = $1 AND token_hash <> $2', [usuario.id, resumoToken(token)]);
  return { ok: true, mensagem: 'Senha trocada!' };
}

// "Esqueci minha senha": so marca o pedido para a administradora ver na tela de Usuarios.
// A resposta e sempre a mesma, para ninguem descobrir quais e-mails tem cadastro.
async function pedirNovaSenha({ email }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro(400, 'Informe um e-mail válido.');
  const pool = await db();
  await pool.query('UPDATE usuarios SET pediu_senha_em = now() WHERE email = $1', [email]);
  return {
    ok: true,
    mensagem: 'Pedido enviado! A administradora vai gerar uma senha provisória e te passar. No primeiro acesso, você cria a sua senha nova.',
  };
}

// A administradora gera uma senha provisoria para alguem (aparece so uma vez na tela).
// A pessoa sai de todos os lugares e, ao entrar com ela, e obrigada a criar uma senha nova.
async function redefinirSenha(id) {
  id = Number(id);
  if (!Number.isInteger(id) || id <= 0) throw erro(400, 'Usuário inválido.');
  const provisoria = senhaProvisoria();
  const pool = await db();
  const { rows } = await pool.query(
    `UPDATE usuarios SET senha = $2, troca_senha = true, pediu_senha_em = NULL, atualizado_em = now()
      WHERE id = $1 RETURNING id, nome, email`,
    [id, await gerarHash(provisoria)]
  );
  if (!rows[0]) throw erro(404, 'Usuário não encontrado.');
  await pool.query('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
  return { ...rows[0], senhaProvisoria: provisoria };
}

// Se a conta principal esquecer a senha: recupera com a chave mestra (API_KEY do Render/.env)
async function recuperarPrincipal({ email, chave, senhaNova }) {
  email = String(email || '').trim().toLowerCase();
  const mestra = String(process.env.API_KEY || '');
  const recebida = String(chave || '');
  const chaveOk =
    mestra.length > 0 &&
    recebida.length === mestra.length &&
    crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(mestra));
  if (!ehPrincipal(email) || !chaveOk) throw erro(403, 'E-mail ou chave mestra não conferem.');
  senhaNova = validarSenhaNova(senhaNova);

  const pool = await db();
  const { rowCount } = await pool.query(
    `UPDATE usuarios SET senha = $2, troca_senha = false, pediu_senha_em = NULL, atualizado_em = now() WHERE email = $1`,
    [email, await gerarHash(senhaNova)]
  );
  if (!rowCount) throw erro(404, 'A conta principal ainda não foi criada. Use "Criar conta".');
  await pool.query('DELETE FROM sessoes WHERE usuario_id = (SELECT id FROM usuarios WHERE email = $1)', [email]);
  return { ok: true, mensagem: 'Senha da conta principal trocada! Já pode entrar.' };
}

module.exports = {
  cadastrar, entrar, sair, sessaoPorToken, listar, atualizar,
  trocarSenha, pedirNovaSenha, redefinirSenha, recuperarPrincipal, HORAS_SESSAO,
};