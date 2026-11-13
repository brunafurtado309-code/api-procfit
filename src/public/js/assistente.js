// Assistente do painel: botão "Dúvidas" no canto de todas as telas (carregado pelo sessao.js).
//   Perguntar                 chat: explica contas, de onde vem cada número e o raciocínio da tela.
//                             Vai junto: a tela aberta, a loja do menu e o texto que está aparecendo.
//   Como esta tela calcula    as regras da tela aberta, escritas no código (sem custo).
//   Alertas                   só a conta principal: divergências que a auditoria acha sozinha a cada hora
//                             (bolinha no botão com os novos). "Perguntar" manda o alerta para o chat.
// O nome do assistente vem do servidor (ASSISTENTE_NOME no Render).
// A conversa fica guardada nesta aba do navegador (some ao fechar a aba ou ao sair).
(function () {
  if (window.__assistente) return;
  window.__assistente = true;

  const GUARDA = 'assistente-conversa';
  const chave = () => sessionStorage.getItem('apiKey') || '';
  const SUGESTOES = [
    'Como são calculados os números desta tela?',
    'De onde vêm esses dados no PROCFIT?',
    'Por que este valor é diferente do de outra tela?',
  ];

  let conversa = [];
  try { conversa = JSON.parse(sessionStorage.getItem(GUARDA) || '[]'); } catch (_) { conversa = []; }
  const guardar = () => { try { sessionStorage.setItem(GUARDA, JSON.stringify(conversa.slice(-30))); } catch (_) { /* cheio */ } };

  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };

  let nome = 'Bel';

  // Texto da resposta -> HTML seguro: escapa tudo e só depois aplica **negrito**, listas e parágrafos
  function formatar(texto) {
    const escapar = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const negrito = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const blocos = [];
    let lista = null;
    for (const bruta of escapar(String(texto)).split('\n')) {
      const linha = bruta.trim();
      const item = linha.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) {
        if (!lista) { lista = []; blocos.push(lista); }
        lista.push(negrito(item[1]));
        continue;
      }
      lista = null;
      if (linha) blocos.push(`<p>${negrito(linha.replace(/^#+\s*/, ''))}</p>`);
    }
    return blocos.map((b) => (Array.isArray(b) ? `<ul>${b.map((i) => `<li>${i}</li>`).join('')}</ul>` : b)).join('');
  }

  // O que está na tela agora: janela aberta primeiro (detalhe de produto, pedido...), depois o conteúdo
  function contextoDaTela() {
    const janela = document.querySelector('dialog[open]');
    const principal = document.querySelector('main');
    const textos = [janela?.innerText, principal?.innerText].filter(Boolean);
    const seletorLoja = document.querySelector('.lateral__loja select');
    const lojaCodigo = typeof modulos !== 'undefined' && modulos.lojaAtual ? modulos.lojaAtual() : '';
    return {
      titulo: document.querySelector('.topo h1')?.textContent?.trim() || document.title,
      endereco: location.pathname + location.hash,
      loja: lojaCodigo || '',
      lojaNome: lojaCodigo && seletorLoja ? seletorLoja.selectedOptions[0]?.textContent : '',
      texto: textos.join('\n\n').slice(0, 9000),
      selecao: selecaoGuardada,
    };
  }

  // Texto que a pessoa marcou na tela antes de abrir o chat ("o que é isto?")
  let selecaoGuardada = '';

  // ---------- Montagem ----------
  const botao = criar('button', 'assistente-botao');
  botao.type = 'button';
  botao.setAttribute('aria-label', 'Abrir o assistente de dúvidas');
  botao.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1V13"/><circle cx="12" cy="15" r=".6"/></svg><span>Dúvidas</span>';

  const painel = criar('section', 'assistente');
  painel.hidden = true;
  painel.setAttribute('aria-label', 'Assistente do painel');

  const topo = criar('header', 'assistente__topo');
  const titulo = criar('div');
  const tituloNome = criar('strong', null, nome);
  titulo.append(tituloNome, criar('span', 'assistente__sub', 'Assistente do painel · contas, origem dos dados e raciocínio das telas'));
  const limpar = criar('button', 'assistente__acao', 'Nova conversa');
  limpar.type = 'button';
  const fechar = criar('button', 'assistente__fechar', '×');
  fechar.type = 'button';
  fechar.setAttribute('aria-label', 'Fechar o assistente');
  topo.append(titulo, limpar, fechar);

  const abas = criar('nav', 'assistente__abas');
  const abaChat = criar('button', 'assistente__aba ativa', 'Perguntar');
  const abaRegras = criar('button', 'assistente__aba', 'Como esta tela calcula');
  const abaAlertas = criar('button', 'assistente__aba', 'Alertas');
  abaAlertas.hidden = true; // só a conta principal
  abaChat.type = abaRegras.type = abaAlertas.type = 'button';
  abas.append(abaChat, abaRegras, abaAlertas);

  const mensagens = criar('div', 'assistente__mensagens');
  mensagens.setAttribute('aria-live', 'polite');
  const regras = criar('div', 'assistente__regras');
  regras.hidden = true;
  const alertas = criar('div', 'assistente__alertas');
  alertas.hidden = true;

  const form = criar('form', 'assistente__form');
  const campo = criar('textarea');
  campo.rows = 2;
  campo.maxLength = 2000;
  campo.placeholder = 'Ex.: como sai o preço para empatar do Cookies?';
  const enviar = criar('button', null, 'Enviar');
  enviar.type = 'submit';
  form.append(campo, enviar);

  painel.append(topo, abas, mensagens, regras, alertas, form);

  document.addEventListener('selectionchange', () => {
    const selecao = window.getSelection?.();
    const sel = String(selecao || '').trim();
    if (sel && !painel.contains(selecao.anchorNode)) selecaoGuardada = sel.slice(0, 1000);
  });

  // ---------- Chat ----------
  function balao(m) {
    const b = criar('div', `assistente__msg assistente__msg--${m.papel}${m.erro ? ' assistente__msg--erro' : ''}`);
    if (m.papel === 'assistente' && !m.erro) b.innerHTML = formatar(m.texto);
    else b.textContent = m.texto;
    if (m.consultas?.length) b.append(criar('small', 'assistente__fontes', [...new Set(m.consultas)].join(' · ')));
    return b;
  }

  function desenhar() {
    mensagens.replaceChildren();
    if (!conversa.length) {
      const vazio = criar('div', 'assistente__vazio');
      vazio.append(criar('p', null, `Oi! Eu sou a ${nome}. Pergunte sobre qualquer número ou conta do painel: eu olho a tela aberta e os dados do sistema para explicar.`),
        criar('p', 'assistente__dica', 'Dica: marque um valor na tela com o mouse antes de perguntar "o que é isto?".'));
      for (const s of SUGESTOES) {
        const chip = criar('button', 'assistente__sugestao', s);
        chip.type = 'button';
        chip.addEventListener('click', () => perguntar(s));
        vazio.append(chip);
      }
      mensagens.append(vazio);
      return;
    }
    for (const m of conversa) mensagens.append(balao(m));
    mensagens.scrollTop = mensagens.scrollHeight;
  }

  let ocupado = false;
  async function perguntar(texto) {
    const pergunta = String(texto || '').trim();
    if (!pergunta || ocupado) return;
    ocupado = true;
    enviar.disabled = true;
    const historico = conversa.filter((m) => !m.erro).map(({ papel, texto: t }) => ({ papel, texto: t }));
    conversa.push({ papel: 'pessoa', texto: pergunta });
    campo.value = '';
    desenhar();
    const pensando = criar('div', 'assistente__msg assistente__msg--assistente assistente__pensando', `${nome} está olhando a tela e os dados…`);
    mensagens.append(pensando);
    mensagens.scrollTop = mensagens.scrollHeight;
    try {
      const r = await fetch('/assistente/perguntar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': chave() },
        body: JSON.stringify({ pergunta, historico, tela: contextoDaTela() }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.erro || 'O assistente não respondeu agora. Tente de novo.');
      conversa.push({ papel: 'assistente', texto: corpo.resposta, consultas: corpo.consultas });
    } catch (err) {
      conversa.push({ papel: 'assistente', texto: err.message, erro: true });
    } finally {
      selecaoGuardada = '';
      guardar();
      ocupado = false;
      enviar.disabled = false;
      desenhar();
      campo.focus();
    }
  }

  form.addEventListener('submit', (ev) => { ev.preventDefault(); perguntar(campo.value); });
  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); perguntar(campo.value); }
  });
  limpar.addEventListener('click', () => { conversa = []; guardar(); desenhar(); campo.focus(); });

  // ---------- Regras da tela (sem custo) ----------
  let regrasCarregadas = false;
  async function mostrarRegras() {
    if (regrasCarregadas) return;
    regras.replaceChildren(criar('p', 'assistente__dica', 'Carregando as regras desta tela…'));
    try {
      const r = await fetch('/assistente/ajuda?tela=' + encodeURIComponent(location.pathname), { headers: { 'x-api-key': chave() } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || 'Não foi possível carregar.');
      regras.replaceChildren();
      if (!d.secoes.length) {
        regras.append(criar('p', null, 'Esta tela não tem cálculos próprios: ela mostra os dados das outras telas. Use "Perguntar" para tirar a dúvida.'));
      }
      for (const s of d.secoes) {
        const bloco = criar('details', 'assistente__regra');
        bloco.open = d.secoes.length <= 2;
        bloco.append(criar('summary', null, s.titulo), criar('pre', null, s.texto));
        regras.append(bloco);
      }
      if (!d.ia) {
        regras.prepend(criar('p', 'assistente__aviso', 'O chat ainda não está ligado. Aqui estão as regras escritas para esta tela.'));
      }
      regrasCarregadas = true;
    } catch (err) {
      regras.replaceChildren(criar('p', 'assistente__msg--erro', err.message));
    }
  }

  // qual: 'chat' | 'regras' | 'alertas' (true/false continuam valendo: chat / regras)
  function trocarAba(qual) {
    if (qual === true) qual = 'chat';
    if (qual === false) qual = 'regras';
    abaChat.classList.toggle('ativa', qual === 'chat');
    abaRegras.classList.toggle('ativa', qual === 'regras');
    abaAlertas.classList.toggle('ativa', qual === 'alertas');
    mensagens.hidden = qual !== 'chat';
    form.hidden = qual !== 'chat';
    limpar.hidden = qual !== 'chat';
    regras.hidden = qual !== 'regras';
    alertas.hidden = qual !== 'alertas';
    if (qual === 'regras') mostrarRegras();
    if (qual === 'alertas') mostrarAlertas();
    if (qual === 'chat') campo.focus();
  }
  abaChat.addEventListener('click', () => trocarAba(true));
  abaRegras.addEventListener('click', () => trocarAba(false));
  abaAlertas.addEventListener('click', () => trocarAba('alertas'));

  // ---------- Alertas da auditoria (só a conta principal) ----------
  const bolinha = criar('span', 'assistente-botao__bolinha');
  bolinha.hidden = true;
  botao.append(bolinha);
  let statusAlertas = 'aberto';
  // Filtros da lista de alertas (na hora): tipo, busca (cliente, vendedor, produto, nota) e valor mínimo
  const filtroAlertas = { grupo: '', busca: '', valor: '' };

  const apiAuditoria = async (url, opcoes = {}) => {
    const r = await fetch(url, { ...opcoes, headers: { 'Content-Type': 'application/json', 'x-api-key': chave() } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || 'Não foi possível carregar os alertas.');
    return d;
  };

  function mostrarNovos(n) {
    bolinha.hidden = !n;
    bolinha.textContent = n > 99 ? '99+' : String(n || '');
    abaAlertas.textContent = n ? `Alertas (${n} novos)` : 'Alertas';
  }
  async function conferirNovos() {
    try { mostrarNovos((await apiAuditoria('/auditoria/novos')).novos); } catch (_) { /* sem acesso */ }
  }

  const quando = (t) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  async function mostrarAlertas() {
    alertas.replaceChildren(criar('p', 'assistente__dica', 'Carregando os alertas…'));
    try {
      const d = await apiAuditoria('/auditoria?status=' + statusAlertas);
      alertas.replaceChildren();

      // Topo: última verificação, botão de verificar e filtro de situação
      const topoAlertas = criar('div', 'alertas__topo');
      const info = criar('span', 'assistente__dica', d.rodando ? 'Verificando agora…'
        : d.ultima ? `Última verificação: ${quando(d.ultima.fim)} · ${d.ultima.novos} novos, ${d.ultima.resolvidos} resolvidos` : 'Ainda não verificou.');
      const verificar = criar('button', 'assistente__acao', 'Verificar agora');
      verificar.type = 'button';
      verificar.addEventListener('click', async () => {
        verificar.disabled = true;
        info.textContent = 'Verificando… (pode levar até 1 minuto)';
        try { await apiAuditoria('/auditoria/rodar', { method: 'POST' }); } catch (err) { info.textContent = err.message; }
        verificar.disabled = false;
        mostrarAlertas();
      });
      const filtro = criar('select', 'alertas__filtro');
      for (const [v, t] of [['aberto', 'Abertos'], ['ignorado', 'Ignorados'], ['resolvido', 'Resolvidos']]) {
        const total = d.contagem[v]?.total ?? 0;
        filtro.append(new Option(`${t} (${total})`, v));
      }
      filtro.value = statusAlertas;
      filtro.addEventListener('change', () => { statusAlertas = filtro.value; mostrarAlertas(); });
      topoAlertas.append(info, verificar, filtro);
      alertas.append(topoAlertas);

      const filtros = criar('div', 'alertas__filtros');
      const tipo = criar('select', 'alertas__filtro');
      tipo.append(new Option('Todos os tipos', ''), ...Object.entries(d.grupos).map(([g, nomeGrupo]) => new Option(nomeGrupo, g)));
      tipo.value = filtroAlertas.grupo;
      const busca = criar('input', 'alertas__busca');
      busca.type = 'search';
      busca.placeholder = 'Cliente, vendedor, produto ou nota';
      busca.value = filtroAlertas.busca;
      const valor = criar('input', 'alertas__valor');
      valor.type = 'number';
      valor.min = '0';
      valor.step = '0.01';
      valor.placeholder = 'Valor a partir de R$';
      valor.value = filtroAlertas.valor;
      filtros.append(tipo, busca, valor);
      alertas.append(filtros);
      const lista = criar('div', 'alertas__lista');
      alertas.append(lista);
      const refiltrar = () => {
        filtroAlertas.grupo = tipo.value;
        filtroAlertas.busca = busca.value;
        filtroAlertas.valor = valor.value;
        desenharLista();
      };
      tipo.addEventListener('change', refiltrar);
      busca.addEventListener('input', refiltrar);
      valor.addEventListener('input', refiltrar);

      // Regras que não conseguiram rodar na última verificação
      const falhas = Object.entries(d.ultima?.regras || {}).filter(([, r]) => r.erro);
      if (falhas.length) alertas.append(criar('p', 'assistente__aviso', `${falhas.length} verificação(ões) não rodaram da última vez (banco ocupado ou fora do ar). Tente "Verificar agora".`));

      function desenharLista() {
      lista.replaceChildren();
      const termo = filtroAlertas.busca.trim().toLowerCase();
      const minimo = Number(filtroAlertas.valor) || 0;
      const visiveis = d.alertas.filter((a) => (!filtroAlertas.grupo || a.grupo === filtroAlertas.grupo)
        && (!termo || `${a.titulo} ${a.detalhe}`.toLowerCase().includes(termo))
        && (!minimo || Math.abs(Number(a.valor) || 0) >= minimo));
      if (!visiveis.length) {
        lista.append(criar('p', 'assistente__dica', !d.alertas.length && statusAlertas === 'aberto' ? 'Nenhuma divergência em aberto. ✓' : 'Nenhum alerta com esses filtros.'));
      }

      // Um bloco por grupo (Preço e custo, Notas e pedidos, Financeiro, Telas que não batem)
      for (const [grupo, nomeGrupo] of Object.entries(d.grupos)) {
        const doGrupo = visiveis.filter((a) => a.grupo === grupo);
        if (!doGrupo.length) continue;
        const bloco = criar('details', 'alertas__grupo');
        bloco.open = doGrupo.some((a) => !a.visto) || doGrupo.length <= 5 || Boolean(termo || minimo || filtroAlertas.grupo);
        const novosNoGrupo = doGrupo.filter((a) => !a.visto).length;
        bloco.append(criar('summary', null, `${nomeGrupo} · ${doGrupo.length}${novosNoGrupo ? ` (${novosNoGrupo} novos)` : ''}`));
        for (const a of doGrupo) {
          const item = criar('div', `alerta${a.visto ? '' : ' alerta--novo'}`);
          item.append(criar('strong', 'alerta__titulo', a.titulo), criar('p', 'alerta__detalhe', a.detalhe));
          const rodape = criar('div', 'alerta__rodape');
          rodape.append(criar('span', 'assistente__dica', a.status === 'aberto' ? `desde ${quando(a.primeira_vez)}`
            : `${a.status === 'ignorado' ? 'ignorado' : 'resolvido'} em ${quando(a.mudou_em)}${a.mudou_por && a.mudou_por !== 'auditoria' ? ` por ${a.mudou_por}` : ''}`));
          const perguntar = criar('button', 'assistente__sugestao', `Perguntar à ${nome.split(' ')[0]}`);
          perguntar.type = 'button';
          perguntar.addEventListener('click', () => {
            trocarAba('chat');
            perguntar(`Explique este alerta da auditoria e o que eu faço para resolver: "${a.titulo}". ${a.detalhe}`);
          });
          const mudar = criar('button', 'assistente__acao', a.status === 'aberto' ? 'Ignorar' : 'Reabrir');
          mudar.type = 'button';
          mudar.title = a.status === 'aberto' ? 'Não é problema: não acender de novo' : 'Voltar para os abertos';
          mudar.addEventListener('click', async () => {
            mudar.disabled = true;
            try {
              await apiAuditoria('/auditoria/' + a.id, { method: 'PATCH', body: JSON.stringify({ status: a.status === 'aberto' ? 'ignorado' : 'aberto' }) });
              item.remove();
            } catch (err) { mudar.disabled = false; mudar.textContent = err.message; }
          });
          rodape.append(perguntar, mudar);
          item.append(rodape);
          bloco.append(item);
        }
        lista.append(bloco);
      }
      }
      desenharLista();

      // Abriu a lista dos abertos: os novos passam a vistos (a bolinha apaga)
      if (statusAlertas === 'aberto' && d.alertas.some((a) => !a.visto)) {
        apiAuditoria('/auditoria/vistos', { method: 'POST' }).then(() => mostrarNovos(0)).catch(() => {});
      }
    } catch (err) {
      alertas.replaceChildren(criar('p', 'assistente__msg--erro', err.message));
    }
  }

  // Conta principal: mostra a aba e confere os novos agora e a cada 5 minutos
  fetch('/auth/eu', { headers: { 'x-api-key': chave() } })
    .then((r) => (r.ok ? r.json() : null))
    .then((eu) => {
      if (!eu?.mestre) return;
      abaAlertas.hidden = false;
      conferirNovos();
      setInterval(conferirNovos, 5 * 60 * 1000);
    })
    .catch(() => {});

  function abrir(sim) {
    painel.hidden = !sim;
    botao.hidden = sim;
    document.body.classList.toggle('assistente-aberto', sim);
    if (sim) { desenhar(); if (!form.hidden) campo.focus(); }
    else botao.focus();
  }
  botao.addEventListener('click', () => abrir(true));
  fechar.addEventListener('click', () => abrir(false));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !painel.hidden && !document.querySelector('dialog[open]')) abrir(false); });

  // Nome do assistente e, com o chat desligado, abre direto nas regras da tela
  fetch('/assistente/ajuda?tela=' + encodeURIComponent(location.pathname), { headers: { 'x-api-key': chave() } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      if (d.nome) {
        nome = d.nome;
        tituloNome.textContent = nome;
        botao.setAttribute('aria-label', `Abrir a ${nome}, assistente de dúvidas`);
        if (!painel.hidden) desenhar();
      }
      if (!d.ia) { abaChat.textContent = 'Perguntar (desligado)'; trocarAba(false); }
    })
    .catch(() => {});

  document.body.append(botao, painel);
})();
