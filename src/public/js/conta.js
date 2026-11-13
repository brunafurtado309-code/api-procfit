// Tela "Minha senha": qualquer pessoa logada troca a própria senha.
// Quem entrou com senha provisória cai aqui direto (o servidor não deixa abrir outra tela antes).
(function () {
  const $ = (id) => document.getElementById(id);
  const chave = () => sessionStorage.getItem('apiKey') || '';
  let provisoria = false;

  function mostrar(texto, tipo) {
    $('mensagem').textContent = texto || '';
    $('mensagem').className = 'mensagem ' + (tipo || '');
  }

  // Senha provisória: mostra o aviso e esconde o menu até criar a senha nova
  fetch('/auth/eu', { headers: { 'x-api-key': chave() } })
    .then((r) => (r.ok ? r.json() : null))
    .then((eu) => {
      provisoria = !!(eu && eu.trocaSenha);
      $('aviso-provisoria').hidden = !provisoria;
      if (!provisoria && typeof modulos !== 'undefined') {
        modulos.setoresDaChave().then((setores) => modulos.desenharMenu(setores, 'conta')).catch(() => {});
      }
    })
    .catch(() => {});

  $('form-senha').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if ($('senha-nova').value !== $('senha-nova2').value) {
      mostrar('As duas senhas novas não são iguais.', 'erro');
      return;
    }
    const botao = ev.target.querySelector('button[type="submit"]');
    botao.disabled = true;
    mostrar('Salvando...');
    try {
      const resposta = await fetch('/auth/senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': chave() },
        body: JSON.stringify({ senhaAtual: $('senha-atual').value, senhaNova: $('senha-nova').value }),
      });
      let corpo = {};
      try { corpo = await resposta.json(); } catch (_) { /* sem corpo */ }
      if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível trocar a senha.');
      ev.target.reset();
      if (provisoria) {
        mostrar('Senha criada! Abrindo o painel...', 'ok');
        setTimeout(() => { window.location.href = 'inicio.html'; }, 1200);
      } else {
        mostrar('Senha trocada! Use a senha nova no próximo acesso.', 'ok');
      }
    } catch (err) {
      mostrar(err.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });
})();
