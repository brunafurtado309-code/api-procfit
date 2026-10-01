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

  function trocarAba(qual) {
    const entrar = qual === 'entrar';
    $('form-entrar').hidden = !entrar;
    $('form-criar').hidden = entrar;
    $('aba-entrar').classList.toggle('ativa', entrar);
    $('aba-criar').classList.toggle('ativa', !entrar);
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
      window.location.href = './';
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
