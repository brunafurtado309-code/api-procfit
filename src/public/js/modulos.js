// Menu de módulos do painel, montado conforme o acesso de quem entrou.
//
// A API diz em /acessos quais setores a chave abre. O menu fica na COLUNA DA ESQUERDA (nov/2026),
// igual em todas as telas: Início (a tela com os cartões de cada módulo), os módulos liberados e,
// para a conta principal, Usuários. O botão « recolhe a coluna só nos ícones; a escolha fica guardada
// no navegador.
//
// Cada tela chama modulos.desenharMenu(setores, 'setor-da-tela'), como antes.
//
// LOJA (nov/2026): o painel todo é visto por loja. O seletor fica no menu da esquerda e na tela
// inicial; a escolha fica guardada no navegador e vale para todas as telas. As lojas vêm de /lojas
// (empresas com venda nos últimos 90 dias), então uma loja nova aparece sozinha. Vazio = todas.
//   modulos.lojaAtual()       código da loja escolhida, ou '' para todas
//   modulos.aoMudarLoja(fn)   a tela atualiza sozinha quando a loja muda; sem isso, a tela recarrega
//   modulos.seletorDeLoja()   cria mais um seletor ligado ao mesmo valor (usado na tela inicial)
//   modulos.marcarLoja(url)   põe ?empresa=<loja> na busca (telas do financeiro e administrativo)
//   modulos.lojaNoFiltro(sel) telas com filtro de empresa próprio (Logística, Entradas e saídas)
//                             começam na loja do menu
// modulos.PAGINAS também é usado pela tela inicial (inicio.js) para montar os cartões.
//
// MENU EM PASTAS (nov/2026): os módulos com várias telas viram pastas no menu da esquerda
// (SUBMENUS abaixo). Clicar em "Financeiro" abre as funções dele, uma dentro da outra
// (Financeiro > Contas a receber > Títulos em aberto...). As abas e divisões que ficavam em cima
// da tela (NAVS_NO_MENU) saem da tela, porque agora estão no menu. Se o item é uma aba da própria
// tela, o menu só aperta a aba (a tela não recarrega). Pastas abertas ficam guardadas no navegador.

const modulos = (() => {
  // Ícones do menu: desenhos simples de linha (SVG), na cor do texto
  const ICONES = {
    inicio: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
    vendas: '<path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    financeiro: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/>',
    faturamento: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7"/>',
    logistica: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    precificacao: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="m10 16 5-5"/>',
    precos: '<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/><path d="M18 15v6M16 17.5h4"/>',
    movimentos: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
    admin: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/><path d="M17 4.5 19 6l-2 1.5"/>',
    usuarios: '<circle cx="9" cy="8" r="3"/><path d="M3 19c.8-3.4 3.2-5 6-5s5.2 1.6 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.6.2 4.6 1.6 5.2 4.8"/>',
    conta: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
    recolher: '<path d="m14 6-6 6 6 6"/><path d="M19 6v12"/>',
  };

  // Telas do painel: título no menu, página e o que tem nela (aparece no cartão da tela inicial)
  const PAGINAS = {
    vendas: { titulo: 'Vendas', pagina: 'index.html',
      descricao: 'Venda do período, notas e cupons, vendedores, caixa das lojas e gráficos.' },
    financeiro: { titulo: 'Financeiro', pagina: 'financeiro.html',
      descricao: 'Contas a receber e a pagar, recebimentos, despachos, clientes e conciliação com o banco.' },
    faturamento: { titulo: 'Faturamento', pagina: 'faturamento.html',
      descricao: 'O caminho de cada pedido, do orçamento ao pagamento, e o que precisa de atenção.' },
    logistica: { titulo: 'Logística', pagina: 'logistica.html',
      descricao: 'Compras, vendas e estoque de cada produto, fornecedores e mudanças de preço.' },
    precificacao: { titulo: 'Precificação', pagina: 'precificacao.html',
      descricao: 'Margem, custo real com bonificação, preço sugerido, picos e quedas e as decisões de preço.' },
    precos: { titulo: 'Tabela de preços', pagina: 'precos.html',
      descricao: 'Produto, código e preço de venda de varejo, sempre atualizado pelo sistema.' },
    movimentos: { titulo: 'Entradas e saídas', pagina: 'movimentos.html',
      descricao: 'Entradas e saídas de cada produto e as notas de entrada, só com as quantidades.' },
    admin: { titulo: 'Administrativo', pagina: 'admin.html',
      descricao: 'Ações registradas no PROCFIT: quem fez o quê, por dia e por usuário.' },
  };
  // Funções de cada módulo no menu em pastas. "aba" = botão da própria tela (data-aba);
  // "itens" = pasta dentro da pasta.
  const SUBMENUS = {
    vendas: [
      // Sub-telas da tela de vendas (abas: só a parte escolhida aparece). Os gráficos ficam no Resumo.
      { titulo: 'Resumo', pagina: 'index.html#resumo', aba: 'resumo' },
      { titulo: 'Vendedores', pagina: 'index.html#vendedores', aba: 'vendedores' },
      { titulo: 'Caixa das lojas', pagina: 'index.html#caixa', aba: 'caixa' },
    ],
    financeiro: [
      { titulo: 'Contas a receber', itens: [
        { titulo: 'Títulos em aberto', pagina: 'financeiro.html#titulos', aba: 'titulos' },
        { titulo: 'Baixa parcial', pagina: 'financeiro.html#parciais', aba: 'parciais' },
        { titulo: 'Boletos e prazos', pagina: 'financeiro.html#boletos', aba: 'boletos' },
        { titulo: 'Cobrança', pagina: 'financeiro.html#cobranca', aba: 'cobranca' },
        { titulo: 'Despachos', pagina: 'despachos.html' },
        { titulo: 'Clientes e crédito', pagina: 'clientes.html' },
        { titulo: 'Recebimentos', pagina: 'recebimentos.html' },
        { titulo: 'Conciliação com o banco', pagina: 'conciliacao.html' },
      ] },
      { titulo: 'Contas a pagar', pagina: 'pagar.html' },
    ],
    // "setor" = a função tem permissão própria (sem ele, vale a permissão do módulo)
    faturamento: [
      { titulo: 'Pedidos', pagina: 'faturamento.html' },
      { titulo: 'Faturados por vendedor', pagina: 'faturamento-vendedores.html', setor: 'faturamento_vendedores' },
    ],
    precificacao: [
      { titulo: 'Análise', pagina: 'precificacao.html#analise', aba: 'analise' },
      { titulo: 'Notas e fornecedores', pagina: 'precificacao.html#notas', aba: 'notas' },
      { titulo: 'Produtos', pagina: 'precificacao.html#produtos', aba: 'produtos' },
    ],
    movimentos: [
      { titulo: 'Notas de entrada', pagina: 'movimentos.html#notas', aba: 'notas' },
      { titulo: 'Por produto', pagina: 'movimentos.html#produtos', aba: 'produtos' },
    ],
  };
  // Permissões que abrem só uma parte de um módulo: o módulo entra no menu com só aquela parte
  // (ex.: quem tem só "Faturamento: faturados por vendedor" vê a pasta Faturamento só com ela)
  const PARTES = { faturamento_vendedores: 'faturamento' };
  let setoresRecebidos = null; // tudo o que a chave abre (telas e permissões), vindo de /acessos

  // Funções da pasta que esta pessoa pode ver (pasta vazia some)
  function funcoesLiberadas(setor, lista = SUBMENUS[setor] ?? []) {
    const tem = (s) => (setoresRecebidos ?? [setor]).includes(s);
    return lista
      .map((f) => (f.itens ? { ...f, itens: funcoesLiberadas(setor, f.itens) } : f))
      .filter((f) => (f.itens ? f.itens.length > 0 : tem(f.setor ?? setor)));
  }

  // Página de entrada do módulo para esta pessoa (a primeira função liberada)
  function paginaDe(setor) {
    const padrao = PAGINAS[setor]?.pagina ?? 'index.html';
    const funcoes = funcoesLiberadas(setor);
    if (!SUBMENUS[setor] || !funcoes.length) return padrao;
    const primeira = primeiraPagina(funcoes);
    // A tela de sempre do módulo está liberada: entra por ela, como antes
    return arquivoDe(primeira) === arquivoDe(padrao) ? padrao : primeira;
  }

  // Navegação de cima da tela que passou para o menu em pastas (fica escondida)
  const NAVS_NO_MENU = [
    'nav.divisao[aria-label="Parte do financeiro"]',
    'nav.abas[aria-label="Visões do contas a receber"]',
    'nav.abas[aria-label="Visões do financeiro"]',
    '#painel > nav.abas#abas', // financeiro.html
    'nav.abas[aria-label="Partes da precificação"]',
    'nav.abas[aria-label="Partes do faturamento"]',
    'nav.abas[aria-label="Visões de entradas e saídas"]',
    'nav.abas[aria-label="Partes das vendas"]', // vendas
  ].join(', ');
  const PASTAS = 'menu-pastas-abertas';
  const RECOLHIDO = 'menu-lateral-recolhido';
  const LOJA = 'painel-loja';

  // ---------- Loja escolhida ----------
  let lojaGuardada = (() => { try { return localStorage.getItem(LOJA) ?? ''; } catch (_) { return ''; } })();
  let listaDeLojas = null; // pedido a /lojas, feito uma vez por tela
  const seletores = new Set();
  const avisar = new Set();

  const lojaAtual = () => lojaGuardada;

  // Lista de lojas. Se a API falhar, o erro vai para quem pediu (o seletor mostra o motivo)
  // e o próximo pedido tenta de novo.
  function lerLojas() {
    listaDeLojas ??= fetch('/lojas', { headers: { 'x-api-key': lerChave() } })
      .then(async (r) => {
        const corpo = await r.json().catch(() => ({}));
        if (r.status === 404) throw new Error('O servidor ainda não tem a lista de lojas (atualização não publicada).');
        if (!r.ok) throw new Error(corpo.erro ?? `A lista de lojas não carregou (erro ${r.status}).`);
        return corpo.lojas ?? [];
      })
      .catch((erro) => { listaDeLojas = null; throw erro; });
    return listaDeLojas;
  }

  const nomeDaLoja = async (codigo = lojaGuardada) => {
    if (!codigo) return null;
    const lojas = await lerLojas().catch(() => []);
    return lojas.find((l) => String(l.codigo) === String(codigo))?.nome ?? null;
  };

  function escolherLoja(codigo) {
    const valor = codigo == null ? '' : String(codigo);
    if (valor === lojaGuardada) return;
    lojaGuardada = valor;
    try { localStorage.setItem(LOJA, valor); } catch (_) { /* fica só nesta tela */ }
    for (const s of seletores) s.value = valor;
    if (avisar.size) for (const fn of avisar) fn(valor);
    else window.location.reload(); // tela que não se atualiza sozinha: lê tudo de novo já com a loja
  }

  const aoMudarLoja = (fn) => { avisar.add(fn); };

  // Põe a loja escolhida no endereço da busca (URL ou URLSearchParams). Se a tela já mandou
  // uma empresa, vale a da tela. Sem loja escolhida (todas), não muda nada.
  function marcarLoja(alvo) {
    if (!lojaGuardada || !alvo) return alvo;
    const parametros = alvo instanceof URL ? alvo.searchParams : alvo;
    if (!parametros.get('empresa')) parametros.set('empresa', lojaGuardada);
    return alvo;
  }

  // Para telas que têm o próprio filtro de empresa (inclui CD e galpão, por causa do estoque):
  // com uma loja escolhida no menu, o filtro da tela vai para ela.
  function lojaNoFiltro(select) {
    if (!lojaGuardada || !select) return;
    if (![...select.options].some((o) => o.value === lojaGuardada)) {
      select.append(new Option(`Empresa ${lojaGuardada}`, lojaGuardada));
    }
    select.value = lojaGuardada;
  }

  // Um <select> com "Todas as lojas" + as lojas que venderam. Todos os seletores andam juntos.
  function seletorDeLoja(classe = 'seletor-loja') {
    const select = document.createElement('select');
    select.className = classe;
    select.setAttribute('aria-label', 'Loja');
    select.title = 'Loja: vale para todas as telas do painel';
    select.append(new Option('Todas as lojas', ''));
    select.value = '';
    seletores.add(select);
    lerLojas().then((lojas) => {
      select.replaceChildren(new Option('Todas as lojas', ''),
        ...lojas.map((l) => new Option(l.nome || `Empresa ${l.codigo}`, String(l.codigo))));
      // Loja guardada que parou de vender: some do seletor e o painel volta para todas
      if (lojaGuardada && !lojas.some((l) => String(l.codigo) === lojaGuardada)) escolherLoja('');
      select.value = lojaGuardada;
    }).catch((erro) => {
      // Fica em "Todas", mas avisa por que as lojas não aparecem
      const aviso = new Option(`⚠ ${erro.message}`, '__erro');
      aviso.disabled = true;
      select.append(aviso);
      select.title = erro.message;
      console.error('Lojas:', erro);
    });
    select.addEventListener('change', () => escolherLoja(select.value));
    return select;
  }

  const lerChave = () => sessionStorage.getItem('apiKey') ?? '';

  async function setoresDaChave() {
    const resposta = await fetch('/acessos', { headers: { 'x-api-key': lerChave() } });
    if (resposta.status === 401) {
      const erro = new Error('Chave inválida');
      erro.chaveInvalida = true;
      throw erro;
    }
    if (!resposta.ok) throw new Error('Não foi possível conferir o acesso da chave');
    const { setores } = await resposta.json();
    setoresRecebidos = setores;
    // Só os módulos: permissões que não são tela (ex.: precificacao_edita) não entram no menu;
    // permissão de uma parte (PARTES) traz o módulo dela
    const telas = [];
    for (const setor of setores) {
      const modulo = PAGINAS[setor] ? setor : PARTES[setor];
      if (modulo && !telas.includes(modulo)) telas.push(modulo);
    }
    return telas;
  }

  function irPara(setor) {
    window.location.href = paginaDe(setor);
  }

  function icone(nome) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'lateral__icone');
    svg.innerHTML = ICONES[nome] ?? ICONES.inicio; // desenho fixo nosso, não vem de fora
    return svg;
  }

  function item(nome, titulo, pagina, atual) {
    const ativo = nome === atual;
    const link = document.createElement(ativo ? 'span' : 'a');
    link.className = `lateral__item${ativo ? ' lateral__item--ativo' : ''}`;
    if (!ativo) link.href = pagina;
    else link.setAttribute('aria-current', 'page');
    link.title = titulo;
    const texto = document.createElement('span');
    texto.className = 'lateral__texto';
    texto.textContent = titulo;
    link.append(icone(nome), texto);
    return link;
  }

  // ---------- Menu em pastas ----------
  const arquivoDe = (pagina) => (pagina.split('#')[0] || 'index.html');
  const arquivoAtual = () => window.location.pathname.split('/').pop() || 'index.html';
  const abaDaTela = () => document.querySelector('nav.abas .aba--ativa[data-aba]')?.dataset.aba ?? null;

  const lerPastas = () => { try { return new Set(JSON.parse(localStorage.getItem(PASTAS) ?? '[]')); } catch (_) { return new Set(); } };
  const guardarPastas = (abertas) => { try { localStorage.setItem(PASTAS, JSON.stringify([...abertas])); } catch (_) { /* sem problema */ } };

  // A função do menu é a tela aberta agora?
  function ehAtual(f) {
    if (arquivoDe(f.pagina) !== arquivoAtual()) return false;
    if (f.aba) return f.aba === (abaDaTela() ?? f.aba);
    const ancora = f.pagina.split('#')[1];
    return ancora ? window.location.hash === `#${ancora}` : true;
  }
  // A pasta tem a tela aberta agora? (pela página; a aba é marcada só no item)
  const temAtual = (lista) => lista.some((f) => (f.itens ? temAtual(f.itens) : arquivoDe(f.pagina) === arquivoAtual()));
  const primeiraPagina = (lista) => (lista[0].itens ? primeiraPagina(lista[0].itens) : lista[0].pagina);

  // Uma função (folha) da pasta
  function subitem(f, nivel, aoTrocar) {
    const link = document.createElement('a');
    link.className = 'lateral__subitem';
    link.style.setProperty('--nivel', nivel);
    link.href = f.pagina;
    link.title = f.titulo;
    link.textContent = f.titulo;
    link.funcao = f;
    link.addEventListener('click', (evento) => {
      // Aba da própria tela: aperta o botão da aba, sem recarregar
      if (!f.aba || arquivoDe(f.pagina) !== arquivoAtual()) return;
      const botao = document.querySelector(`nav.abas .aba[data-aba="${f.aba}"]`);
      if (!botao) return;
      evento.preventDefault();
      botao.click();
      window.history.replaceState(null, '', `#${f.aba}`);
      aoTrocar();
    });
    return link;
  }

  // Uma pasta: botão que abre/fecha + as funções dentro (pode ter pasta dentro de pasta)
  function pasta({ chave, titulo, iconeNome, lista, nivel, abertas, aoTrocar }) {
    const caixa = document.createElement('div');
    caixa.className = 'lateral__pasta';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = nivel === 0 ? 'lateral__item lateral__pasta-botao' : 'lateral__subitem lateral__pasta-botao';
    if (nivel > 0) botao.style.setProperty('--nivel', nivel);
    botao.title = titulo;
    if (iconeNome) botao.append(icone(iconeNome));
    const texto = document.createElement('span');
    texto.className = 'lateral__texto';
    texto.textContent = titulo;
    const seta = document.createElement('span');
    seta.className = 'lateral__seta';
    seta.setAttribute('aria-hidden', 'true');
    botao.append(texto, seta);

    const filhos = document.createElement('div');
    filhos.className = 'lateral__filhos';
    for (const f of lista) {
      filhos.append(f.itens
        ? pasta({ chave: `${chave}/${f.titulo}`, titulo: f.titulo, lista: f.itens, nivel: nivel + 1, abertas, aoTrocar })
        : subitem(f, nivel + 1, aoTrocar));
    }

    const abrir = (sim) => {
      caixa.classList.toggle('lateral__pasta--aberta', sim);
      botao.setAttribute('aria-expanded', String(sim));
      filhos.hidden = !sim;
    };
    // A pasta da tela aberta já vem aberta
    abrir(abertas.has(chave) || temAtual(lista));
    if (temAtual(lista)) caixa.classList.add('lateral__pasta--atual');

    botao.addEventListener('click', () => {
      // Menu recolhido (só ícones): não dá para mostrar a pasta, então vai para a primeira função
      if (document.body.classList.contains('lateral-recolhida')) {
        window.location.href = primeiraPagina(lista);
        return;
      }
      const sim = !caixa.classList.contains('lateral__pasta--aberta');
      abrir(sim);
      if (sim) abertas.add(chave); else abertas.delete(chave);
      guardarPastas(abertas);
    });
    caixa.append(botao, filhos);
    return caixa;
  }

  // Marca no menu a função da tela aberta (de novo a cada troca de aba)
  function marcarFuncaoAtual(lista) {
    for (const link of lista.querySelectorAll('.lateral__subitem[href]')) {
      const atual = ehAtual(link.funcao);
      link.classList.toggle('lateral__subitem--ativo', atual);
      if (atual) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  const lerRecolhido = () => { try { return localStorage.getItem(RECOLHIDO) === '1'; } catch (_) { return false; } };
  const guardarRecolhido = (sim) => { try { localStorage.setItem(RECOLHIDO, sim ? '1' : '0'); } catch (_) { /* sem problema */ } };

  // Desenha a coluna da esquerda (uma vez por tela). O menu antigo do topo (#modulos) fica escondido.
  function desenharMenu(setores, atual) {
    const antigo = document.getElementById('modulos');
    if (antigo) antigo.hidden = true;
    document.getElementById('menu-lateral')?.remove();

    const menu = document.createElement('nav');
    menu.id = 'menu-lateral';
    menu.className = 'lateral';
    menu.setAttribute('aria-label', 'Módulos do painel');

    const topo = document.createElement('div');
    topo.className = 'lateral__topo';
    const marca = document.createElement('a');
    marca.className = 'lateral__marca';
    marca.href = 'inicio.html';
    marca.textContent = 'Belo Norte';
    const recolher = document.createElement('button');
    recolher.type = 'button';
    recolher.className = 'lateral__recolher';
    recolher.append(icone('recolher'));
    // Celular: o menu vira uma gaveta que abre pelo botão ☰ do topo e fecha sozinha ao escolher
    // uma tela (a página fica com a largura toda, sem a coluna de ícones)
    const celular = window.matchMedia('(max-width: 720px)');
    const aplicar = (sim) => {
      const recolhido = sim && !celular.matches;
      document.body.classList.toggle('lateral-recolhida', recolhido);
      const texto = celular.matches ? 'Fechar o menu' : sim ? 'Abrir o menu' : 'Recolher o menu';
      recolher.setAttribute('aria-label', texto);
      recolher.title = texto;
    };
    recolher.addEventListener('click', () => {
      if (celular.matches) { abrirGaveta(false); return; }
      const sim = !document.body.classList.contains('lateral-recolhida');
      aplicar(sim);
      guardarRecolhido(sim);
    });
    topo.append(marca, recolher);

    const lista = document.createElement('div');
    lista.className = 'lateral__lista';
    lista.append(item('inicio', 'Início', 'inicio.html', atual));
    const abertas = lerPastas();
    const aoTrocar = () => marcarFuncaoAtual(lista);
    for (const setor of setores.filter((s) => PAGINAS[s])) {
      if (SUBMENUS[setor]) {
        lista.append(pasta({ chave: setor, titulo: PAGINAS[setor].titulo, iconeNome: setor,
          lista: funcoesLiberadas(setor), nivel: 0, abertas, aoTrocar }));
      } else {
        lista.append(item(setor, PAGINAS[setor].titulo, PAGINAS[setor].pagina, atual));
      }
    }
    // Usuários: só a conta principal. Já entra no menu (escondido) para o sessao.js não criar outro.
    const usuarios = item('usuarios', 'Usuários', 'usuarios.html', atual);
    usuarios.id = 'menu-usuarios';
    usuarios.hidden = true;
    lista.append(usuarios);
    // Minha senha: todo mundo que entrou com login troca a própria senha (nov/2026)
    lista.append(item('conta', 'Minha senha', 'conta.html', atual));

    const loja = document.createElement('label');
    loja.className = 'lateral__loja';
    const rotulo = document.createElement('span');
    rotulo.textContent = 'Loja';
    loja.append(rotulo, seletorDeLoja());

    menu.append(topo, loja, lista);
    document.body.prepend(menu);
    document.body.classList.add('com-lateral');

    // Gaveta do celular: botão ☰ no topo da página e um fundo escuro que fecha ao tocar
    document.querySelector('.topo__menu')?.remove();
    document.querySelector('.lateral-fundo')?.remove();
    const botaoMenu = document.createElement('button');
    botaoMenu.type = 'button';
    botaoMenu.className = 'topo__menu';
    botaoMenu.setAttribute('aria-label', 'Abrir o menu');
    botaoMenu.setAttribute('aria-controls', 'menu-lateral');
    botaoMenu.setAttribute('aria-expanded', 'false');
    botaoMenu.innerHTML = '<span></span><span></span><span></span>';
    const topoPagina = document.querySelector('.topo');
    if (topoPagina) topoPagina.prepend(botaoMenu);
    else { botaoMenu.classList.add('topo__menu--solto'); document.body.append(botaoMenu); }
    const fundo = document.createElement('div');
    fundo.className = 'lateral-fundo';
    document.body.append(fundo);
    function abrirGaveta(sim) {
      const aberto = sim && celular.matches;
      document.body.classList.toggle('menu-aberto', aberto);
      botaoMenu.setAttribute('aria-expanded', String(aberto));
      // Fechada no celular, a gaveta sai da ordem do teclado e do leitor de tela
      if (celular.matches && !aberto) menu.setAttribute('inert', '');
      else menu.removeAttribute('inert');
      if (aberto) menu.querySelector('.lateral__item, .lateral__subitem')?.focus({ preventScroll: true });
    }
    botaoMenu.addEventListener('click', () => abrirGaveta(!document.body.classList.contains('menu-aberto')));
    fundo.addEventListener('click', () => abrirGaveta(false));
    document.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape' && document.body.classList.contains('menu-aberto')) {
        abrirGaveta(false);
        botaoMenu.focus();
      }
    });
    // Escolheu uma tela (inclusive sub-tela na mesma página, ex.: index.html#vendedores): fecha
    menu.addEventListener('click', (evento) => {
      if (evento.target.closest('a[href]')) abrirGaveta(false);
    });
    celular.addEventListener('change', () => { aplicar(lerRecolhido()); abrirGaveta(false); });
    aplicar(lerRecolhido());
    abrirGaveta(false);

    // Abas e divisões de cima da tela agora estão no menu
    for (const nav of document.querySelectorAll(NAVS_NO_MENU)) nav.classList.add('no-menu');
    // A tela pode trocar de aba sozinha (filtro guardado, endereço): o menu acompanha
    aoTrocar();
    setTimeout(aoTrocar, 0);
    for (const nav of document.querySelectorAll('nav.abas')) {
      new MutationObserver(aoTrocar).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('hashchange', aoTrocar);

    fetch('/auth/eu', { headers: { 'x-api-key': lerChave() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((eu) => { if (eu?.mestre) usuarios.hidden = false; })
      .catch(() => {});
  }

  // Celular: tabelas com .tabela-cartoes viram cartões (css/style.css, seção 27). Cada célula
  // precisa do nome da coluna em data-rotulo; aqui ele vem do cabeçalho da tabela, sempre que
  // as linhas mudam. Célula que já tem data-rotulo (posto pela própria tela) não é mexida.
  function rotularTabela(tabela) {
    const cabecalho = tabela.tHead?.rows[tabela.tHead.rows.length - 1];
    if (!cabecalho) return;
    const nomes = [];
    for (const th of cabecalho.cells) {
      const texto = th.textContent.replace(/[▲▼↕]/g, '').trim();
      for (let i = 0; i < (th.colSpan || 1); i += 1) nomes.push(texto);
    }
    for (const corpo of [...tabela.tBodies, tabela.tFoot].filter(Boolean)) {
      for (const linha of corpo.rows) {
        let coluna = 0;
        for (const celula of linha.cells) {
          if (!celula.hasAttribute('data-rotulo') && nomes[coluna] && (celula.colSpan || 1) === 1) {
            celula.setAttribute('data-rotulo', nomes[coluna]);
          }
          coluna += celula.colSpan || 1;
        }
      }
    }
  }
  // Vale para as tabelas .tabela-cartoes e, nas telas com <body class="cartoes-celular">, para
  // todas (inclusive as criadas depois, em janelas e linhas que abrem).
  const SELETOR_CARTOES = 'table.tabela-cartoes, body.cartoes-celular table.tabela';
  function rotularCartoes() {
    for (const tabela of document.querySelectorAll(SELETOR_CARTOES)) rotularTabela(tabela);
  }
  function iniciarCartoes() {
    rotularCartoes();
    let agendado = false;
    new MutationObserver(() => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => { agendado = false; rotularCartoes(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarCartoes);
  else iniciarCartoes();

  return { setoresDaChave, irPara, paginaDe, desenharMenu, PAGINAS,
    lojaAtual, escolherLoja, aoMudarLoja, seletorDeLoja, lerLojas, nomeDaLoja, marcarLoja, lojaNoFiltro };
})();
