// Tela de entrar / criar conta do painel.
(function () {
  // Preenchido automaticamente pelo comando de instalação com o mesmo lugar onde o painel guarda a chave
  const ARMAZENAMENTO = 'sessionStorage';
  const CHAVE_PAINEL = 'apiKey';

  function guardarToken(token) {
    const tipo = ARMAZENAMENTO.startsWith('__') ? 'localStorage' : ARMAZENAMENTO;
    const nome = CHAVE_PAINEL.startsWith('__') ? 'apiKey' : CHAVE_PAINEL;
    window[tipo].setItem(nome, token);
  }

  const $ = (id) => document.getElementById(id);
  const mensagem = $('mensagem');

  function mostrar(texto, tipo) {
    mensagem.textContent = texto || '';
    mensagem.className = 'mensagem ' + (tipo || '');
  }

  // qual: 'entrar' | 'criar' | 'esqueci' | 'principal' (as duas últimas ficam dentro da aba Entrar)
  function trocarAba(qual) {
    for (const nome of ['entrar', 'criar', 'esqueci', 'principal']) $('form-' + nome).hidden = nome !== qual;
    $('aba-entrar').classList.toggle('ativa', qual !== 'criar');
    $('aba-criar').classList.toggle('ativa', qual === 'criar');
    mostrar('');
  }

  async function enviar(url, dados) {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });
    let corpo = {};
    try { corpo = await resposta.json(); } catch (_) { /* resposta sem corpo */ }
    if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível concluir. Tente de novo.');
    return corpo;
  }

  async function travar(form, tarefa) {
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try { await tarefa(); } catch (err) { mostrar(err.message, 'erro'); } finally { botao.disabled = false; }
  }

  $('aba-entrar').addEventListener('click', () => trocarAba('entrar'));
  $('aba-criar').addEventListener('click', () => trocarAba('criar'));

  $('form-entrar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    travar(ev.target, async () => {
      mostrar('Entrando...');
      const r = await enviar('/auth/login', { email: $('entrar-email').value, senha: $('entrar-senha').value });
      guardarToken(r.token);
      // Senha provisória: primeiro cria a senha nova; senão, tela inicial com os cartões de cada módulo
      window.location.href = r.trocarSenha ? 'conta.html' : 'inicio.html';
    });
  });

  // ---- Esqueci minha senha ----
  $('link-esqueci').addEventListener('click', () => {
    trocarAba('esqueci');
    $('esqueci-email').value = $('entrar-email').value;
    $('esqueci-email').focus();
  });
  $('link-principal').addEventListener('click', () => {
    trocarAba('principal');
    $('principal-email').value = $('esqueci-email').value;
    $('principal-email').focus();
  });
  for (const botao of document.querySelectorAll('[data-voltar]')) {
    botao.addEventListener('click', () => trocarAba('entrar'));
  }

  $('form-esqueci').addEventListener('submit', (ev) => {
    ev.preventDefault();
    travar(ev.target, async () => {
      const email = $('esqueci-email').value;
      const r = await enviar('/auth/esqueci', { email });
      trocarAba('entrar');
      $('entrar-email').value = email;
      mostrar(r.mensagem, 'ok');
    });
  });

  $('form-principal').addEventListener('submit', (ev) => {
    ev.preventDefault();
    travar(ev.target, async () => {
      if ($('principal-senha').value !== $('principal-senha2').value) throw new Error('As duas senhas não são iguais.');
      const email = $('principal-email').value;
      const r = await enviar('/auth/recuperar-principal', {
        email, chave: $('principal-chave').value, senhaNova: $('principal-senha').value,
      });
      ev.target.reset();
      trocarAba('entrar');
      $('entrar-email').value = email;
      mostrar(r.mensagem, 'ok');
    });
  });

  $('form-criar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    travar(ev.target, async () => {
      if ($('criar-senha').value !== $('criar-senha2').value) throw new Error('As duas senhas não são iguais.');
      const email = $('criar-email').value;
      const r = await enviar('/auth/cadastro', { nome: $('criar-nome').value, email, senha: $('criar-senha').value });
      ev.target.reset();
      trocarAba('entrar');
      $('entrar-email').value = email;
      mostrar(r.mensagem, 'ok');
    });
  });
})();
