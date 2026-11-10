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
// modulos.PAGINAS também é usado pela tela inicial (inicio.js) para montar os cartões.

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
    // Só as telas: permissões que não são tela (ex.: precificacao_edita) não entram no menu
    return setores.filter((setor) => PAGINAS[setor]);
  }

  function irPara(setor) {
    window.location.href = PAGINAS[setor]?.pagina ?? 'index.html';
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
    const aplicar = (sim) => {
      document.body.classList.toggle('lateral-recolhida', sim);
      recolher.setAttribute('aria-label', sim ? 'Abrir o menu' : 'Recolher o menu');
      recolher.title = sim ? 'Abrir o menu' : 'Recolher o menu';
    };
    recolher.addEventListener('click', () => {
      const sim = !document.body.classList.contains('lateral-recolhida');
      aplicar(sim);
      guardarRecolhido(sim);
    });
    topo.append(marca, recolher);

    const lista = document.createElement('div');
    lista.className = 'lateral__lista';
    lista.append(item('inicio', 'Início', 'inicio.html', atual));
    for (const setor of setores.filter((s) => PAGINAS[s])) {
      lista.append(item(setor, PAGINAS[setor].titulo, PAGINAS[setor].pagina, atual));
    }
    // Usuários: só a conta principal. Já entra no menu (escondido) para o sessao.js não criar outro.
    const usuarios = item('usuarios', 'Usuários', 'usuarios.html', atual);
    usuarios.id = 'menu-usuarios';
    usuarios.hidden = true;
    lista.append(usuarios);

    const loja = document.createElement('label');
    loja.className = 'lateral__loja';
    const rotulo = document.createElement('span');
    rotulo.textContent = 'Loja';
    loja.append(rotulo, seletorDeLoja());

    menu.append(topo, loja, lista);
    document.body.prepend(menu);
    document.body.classList.add('com-lateral');
    aplicar(lerRecolhido());

    fetch('/auth/eu', { headers: { 'x-api-key': lerChave() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((eu) => { if (eu?.mestre) usuarios.hidden = false; })
      .catch(() => {});
  }

  return { setoresDaChave, irPara, desenharMenu, PAGINAS,
    lojaAtual, escolherLoja, aoMudarLoja, seletorDeLoja, lerLojas, nomeDaLoja };
})();
