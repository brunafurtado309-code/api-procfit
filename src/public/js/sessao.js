// Carregado no <head> de todas as telas do painel.
// Passa o login (cookie) para o lugar onde o painel procura a chave, troca "Trocar chave" por "Sair"
// e mostra o botao "Usuarios" so para a conta principal.
(function () {
  var COOKIE = 'painel_sessao';
  var m = document.cookie.match(/(?:^|;\s*)painel_sessao=([^;]+)/);
  var token = m ? decodeURIComponent(m[1]) : '';
  if (token && sessionStorage.getItem('apiKey') !== token) sessionStorage.setItem('apiKey', token);

  function sair() {
    fetch('/auth/sair', { method: 'POST', headers: { 'x-api-key': token } })
      .catch(function () {})
      .then(function () {
        document.cookie = COOKIE + '=; Max-Age=0; path=/';
        sessionStorage.removeItem('apiKey');
        window.location.href = 'login.html';
      });
  }

  // Qualquer clique em "Trocar chave"/"Sair" vira sair do login
  document.addEventListener('click', function (ev) {
    var alvo = ev.target.closest ? ev.target.closest('button, a') : null;
    if (alvo && /^(trocar chave|sair)$/i.test(alvo.textContent.trim())) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      sair();
    }
  }, true);

  var mestre = false;
  if (token) {
    fetch('/auth/eu', { headers: { 'x-api-key': token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { mestre = !!(d && d.mestre); ajustar(); })
      .catch(function () {});
  }

  function ajustar() {
    var itens = document.querySelectorAll('button, a');
    var ultimoDoMenu = null;
    for (var i = 0; i < itens.length; i++) {
      var texto = itens[i].textContent.trim();
      if (texto.toLowerCase() === 'trocar chave') itens[i].textContent = 'Sair';
      if (/^(Vendas|Financeiro|Administrativo|Faturamento)$/.test(texto) && itens[i].tagName === 'A') ultimoDoMenu = itens[i];
    }
    if (mestre && ultimoDoMenu && !document.getElementById('menu-usuarios')) {
      var novo = ultimoDoMenu.cloneNode(false);
      novo.id = 'menu-usuarios';
      novo.setAttribute('href', 'usuarios.html');
      novo.removeAttribute('aria-current');
      novo.className = novo.className.replace(/\S*(ativ|active)\S*/gi, '').trim();
      novo.textContent = 'Usu\u00e1rios';
      ultimoDoMenu.parentNode.insertBefore(novo, ultimoDoMenu.nextSibling);
    }
  }

  var agendado = false;
  new MutationObserver(function () {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(function () { agendado = false; ajustar(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();