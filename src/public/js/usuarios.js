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

  const NOMES_TELAS = {
    vendas: 'Vendas', financeiro: 'Financeiro', faturamento: 'Faturamento: pedidos',
    faturamento_vendedores: 'Faturamento: faturados por vendedor', logistica: 'Logística', precificacao: 'Precificação',
    precificacao_edita: 'Precificação: edita preço',
    precos: 'Tabela de preços', movimentos: 'Entradas e saídas', admin: 'Administrativo',
  };
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
      throw new Error('Somente a administradora principal pode liberar acessos. Entre no painel com a chave mestra.');
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
    const senha = montarSenha(u, () => linha);
    const linha = el('tr', { className: u.status === 'pendente' ? 'pendente' : '' }, [
      el('td', {}, [el('strong', { textContent: u.nome }), el('br'), el('span', { className: 'email', textContent: u.email })]),
      el('td', { textContent: cadastro }),
      el('td', {}, situacao),
      el('td', {}, telas),
      el('td', {}, [botao, aviso]),
      el('td', { className: 'celula-senha' }, senha),
    ]);
    if (u.pediu_senha_em) linha.classList.add('pediu-senha');
    return linha;
  }

  // Coluna "Senha": pedido de "esqueci minha senha" e o botão que gera a senha provisória.
  // A senha provisória aparece uma vez só, aqui na tela, para copiar e passar para a pessoa.
  function montarSenha(u, linhaDe) {
    const area = el('div', { className: 'senha' });
    const situacao = el('span', { className: 'senha__situacao' });
    if (u.pediu_senha_em) {
      const quando = new Date(u.pediu_senha_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      situacao.textContent = 'Pediu nova senha em ' + quando;
      situacao.classList.add('senha__situacao--pedido');
    } else if (u.troca_senha) {
      situacao.textContent = 'Com senha provisória';
    }

    const gerar = el('button', { type: 'button', className: 'botao-secundario', textContent: 'Gerar senha provisória' });
    const resultado = el('div', { className: 'senha__resultado', hidden: true });

    gerar.addEventListener('click', async () => {
      if (!confirm('Gerar uma senha provisória para ' + u.nome + '?\nA senha atual deixa de valer e a pessoa sai do painel.')) return;
      gerar.disabled = true;
      try {
        const r = await chamar('/usuarios/' + u.id + '/senha', { method: 'POST' });
        const codigo = el('code', { textContent: r.senhaProvisoria });
        const copiar = el('button', { type: 'button', className: 'botao-secundario', textContent: 'Copiar' });
        copiar.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(r.senhaProvisoria); copiar.textContent = 'Copiada ✓'; }
          catch (_) { copiar.textContent = 'Selecione e copie'; }
        });
        resultado.replaceChildren(codigo, copiar, el('small', { textContent: 'Passe para a pessoa. Ela aparece só agora.' }));
        resultado.hidden = false;
        situacao.textContent = 'Com senha provisória';
        situacao.classList.remove('senha__situacao--pedido');
        linhaDe().classList.remove('pediu-senha');
        atualizarResumo();
      } catch (err) {
        situacao.textContent = err.message;
        situacao.classList.add('senha__situacao--pedido');
      } finally {
        gerar.disabled = false;
      }
    });

    area.append(situacao, gerar, resultado);
    return area;
  }

  let ultimaLista = [];
  function atualizarResumo() {
    const usuarios = ultimaLista;
    const pendentes = usuarios.filter((u) => u.status === 'pendente').length;
    const pedidos = document.querySelectorAll('#linhas tr.pediu-senha').length;
    $('resumo').replaceChildren(
      el('span', { textContent: usuarios.length + (usuarios.length === 1 ? ' usuário' : ' usuários') }),
      pendentes ? el('span', { className: 'pend', textContent: ' · ' + pendentes + ' aguardando liberação' }) : '',
      pedidos ? el('span', { className: 'pend', textContent: ' · ' + pedidos + (pedidos === 1 ? ' pediu nova senha' : ' pediram nova senha') }) : ''
    );
  }

  async function carregar() {
    try {
      const { setores, usuarios } = await chamar('/usuarios');
      const ordem = ['vendas', 'financeiro', 'faturamento', 'faturamento_vendedores', 'logistica', 'precificacao', 'precificacao_edita', 'precos', 'movimentos', 'admin'].filter((s) => setores.includes(s));
      const linhas = $('linhas');
      linhas.replaceChildren();

      if (!usuarios.length) {
        mostrar('Ninguém pediu acesso ainda. Passe o link de cadastro: ' + location.origin + location.pathname.replace(/usuarios\.html$/, 'login.html'));
        return;
      }

      ultimaLista = usuarios;
      for (const u of usuarios) linhas.append(montarLinha(u, ordem));
      atualizarResumo();
      $('tabela').hidden = false;
      mostrar('');
    } catch (err) {
      mostrar(err.message, 'erro');
    }
  }

  // Menu da esquerda, igual ao das outras telas. Espera a página carregar: o modulos.js
  // é "defer" e só roda depois deste arquivo.
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof modulos === 'undefined') return;
    modulos.setoresDaChave().then((setores) => modulos.desenharMenu(setores, 'usuarios')).catch(() => {});
  });
  carregar();
})();
