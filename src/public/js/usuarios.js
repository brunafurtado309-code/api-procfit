// Tela de aprovação de usuários (só para quem tem acesso ao setor admin).
(function () {
  // Preenchido automaticamente pelo comando de instalação com o mesmo lugar onde o painel guarda a chave
  const ARMAZENAMENTO = 'sessionStorage';
  const CHAVE_PAINEL = 'apiKey';

  function chaveGuardada() {
    const tipo = ARMAZENAMENTO.startsWith('__') ? 'localStorage' : ARMAZENAMENTO;
    const nome = CHAVE_PAINEL.startsWith('__') ? 'apiKey' : CHAVE_PAINEL;
    return window[tipo].getItem(nome) || '';
  }

  const NOMES_TELAS = { vendas: 'Vendas', financeiro: 'Financeiro', faturamento: 'Faturamento', admin: 'Administrativo' };
  const NOMES_STATUS = { pendente: 'Aguardando', aprovado: 'Liberado', bloqueado: 'Bloqueado' };

  const $ = (id) => document.getElementById(id);

  function mostrar(texto, tipo) {
    $('mensagem').textContent = texto || '';
    $('mensagem').className = 'mensagem ' + (tipo || '');
  }

  async function chamar(url, opcoes = {}) {
    const resposta = await fetch(url, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', 'x-api-key': chaveGuardada() },
    });
    let corpo = {};
    try { corpo = await resposta.json(); } catch (_) { /* sem corpo */ }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error('Você precisa entrar com uma conta de administrador para ver esta tela.');
    }
    if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível carregar.');
    return corpo;
  }

  function el(tag, props = {}, filhos = []) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const f of [].concat(filhos)) e.append(f);
    return e;
  }

  function montarLinha(u, setores) {
    const situacao = el('select');
    for (const s of Object.keys(NOMES_STATUS)) situacao.append(el('option', { value: s, textContent: NOMES_STATUS[s], selected: u.status === s }));

    const telas = el('div', { className: 'telas' });
    const caixas = setores.map((s) => {
      const c = el('input', { type: 'checkbox', value: s, checked: u.setores.includes(s) });
      telas.append(el('label', {}, [c, NOMES_TELAS[s] || s]));
      return c;
    });

    const aviso = el('span', { className: 'status-linha' });
    const botao = el('button', { type: 'button', className: 'salvar', textContent: 'Salvar' });

    botao.addEventListener('click', async () => {
      const escolhidas = caixas.filter((c) => c.checked).map((c) => c.value);
      if (situacao.value === 'aprovado' && !escolhidas.length) {
        aviso.textContent = 'Marque pelo menos uma tela.';
        aviso.className = 'status-linha erro';
        return;
      }
      botao.disabled = true;
      try {
        await chamar('/usuarios/' + u.id, { method: 'PATCH', body: JSON.stringify({ status: situacao.value, setores: escolhidas }) });
        aviso.textContent = 'Salvo ✓';
        aviso.className = 'status-linha ok';
        linha.classList.toggle('pendente', situacao.value === 'pendente');
      } catch (err) {
        aviso.textContent = err.message;
        aviso.className = 'status-linha erro';
      } finally {
        botao.disabled = false;
      }
    });

    const cadastro = new Date(u.criado_em).toLocaleDateString('pt-BR');
    const linha = el('tr', { className: u.status === 'pendente' ? 'pendente' : '' }, [
      el('td', {}, [el('strong', { textContent: u.nome }), el('br'), el('span', { className: 'email', textContent: u.email })]),
      el('td', { textContent: cadastro }),
      el('td', {}, situacao),
      el('td', {}, telas),
      el('td', {}, [botao, aviso]),
    ]);
    return linha;
  }

  async function carregar() {
    try {
      const { setores, usuarios } = await chamar('/usuarios');
      const ordem = ['vendas', 'financeiro', 'faturamento', 'admin'].filter((s) => setores.includes(s));
      const linhas = $('linhas');
      linhas.replaceChildren();

      if (!usuarios.length) {
        mostrar('Ninguém pediu acesso ainda. Passe o link de cadastro: ' + location.origin + location.pathname.replace(/usuarios\.html$/, 'login.html'));
        return;
      }

      const pendentes = usuarios.filter((u) => u.status === 'pendente').length;
      $('resumo').replaceChildren(
        el('span', { textContent: usuarios.length + (usuarios.length === 1 ? ' usuário' : ' usuários') }),
        pendentes ? el('span', { className: 'pend', textContent: ' · ' + pendentes + ' aguardando liberação' }) : ''
      );
      for (const u of usuarios) linhas.append(montarLinha(u, ordem));
      $('tabela').hidden = false;
      mostrar('');
    } catch (err) {
      mostrar(err.message, 'erro');
    }
  }

  carregar();
})();
