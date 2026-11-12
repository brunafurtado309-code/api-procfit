// Vendas > Vendedores: controle do gestor, compacto.
//   - faixa com os números da equipe;
//   - lista de vendedores (esquerda) e, ao clicar, a análise do vendedor e dos clientes dele (direita);
//   - pedidos em orçamento, cancelados e devoluções canceladas em abas (uma lista por vez),
//     só do vendedor escolhido quando há um;
//   - aviso de notas que parecem duplicadas.
// Dados: /vendas/controle-vendedores (equipe) e /vendas/analise-vendedor (um vendedor), ambos em
// src/services/vendas-vendedores.service.js. Cada bloco é desenhado separado: se um der problema,
// os outros aparecem.
// Usa o que o app.js já tem: buscar, moeda, inteiro, el, contar, dataBR, abrirFatVendedor,
// cargaAtual, ChaveInvalida, pedidoJanela e graficos.

const vendasVendedores = (() => {
  // Linhas por vez nas listas (botão "Mostrar mais"): menos no celular, onde cada linha vira um cartão
  const POR_VEZ = window.matchMedia('(max-width: 720px)').matches ? 15 : 50;
  const QUEDA = 0.2; // cliente "compra menos" quando cai 20% ou mais
  const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  let dados = null;            // equipe (controle-vendedores)
  let filtrosCarga = null;     // filtros da carga atual
  let vendedorAtual = null;    // código do vendedor escolhido (string) ou null
  let analise = null;          // análise do vendedor escolhido
  let cargaAnalise = 0;
  let listaAtiva = 'orcamentos';
  let filtroClientes = 'todos';
  let ordemClientes = { campo: 'atual', direcao: 'desc' };
  const mostrando = { orcamentos: POR_VEZ, cancelados: POR_VEZ };

  const dinheiro = (v) => moeda.format(Number(v) || 0);
  const num = (v) => Number(v) || 0;
  const pct = (parte, todo, casas = 1) => (todo > 0 ? `${(parte / todo * 100).toFixed(casas).replace('.', ',')}%` : '—');
  const sinal = (n, casas = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(casas).replace('.', ',')}%`;
  const nomeVendedor = (x) => x.vendedor || (x.cod_vendedor != null ? `Vendedor ${x.cod_vendedor}` : 'Sem vendedor');
  const nomeCliente = (x) => x.cliente || (x.cod_cliente != null ? `Cliente ${x.cod_cliente}` : '—');
  const doVendedor = (lista) => (vendedorAtual ? lista.filter((x) => String(x.cod_vendedor) === vendedorAtual) : lista);
  const diaDaSemana = (iso) => new Date(`${iso}T12:00:00`).getDay();
  const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function criar(tag, classe, texto) {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto != null) no.textContent = texto;
    return no;
  }

  function td(conteudo, classe, auxiliar, classeAuxiliar = 'qtd') {
    const c = criar('td', classe);
    if (conteudo instanceof Node) c.append(conteudo);
    else c.textContent = conteudo ?? '—';
    if (auxiliar) c.append(criar('span', classeAuxiliar, auxiliar));
    return c;
  }

  function cabecalho(tabela, titulos, ordenar) {
    const tr = document.createElement('tr');
    for (const [texto, esquerda, campo] of titulos) {
      const th = criar('th', esquerda ? 'esquerda' : null);
      th.scope = 'col';
      if (campo && ordenar) {
        const ativa = ordenar.atual.campo === campo;
        const botao = criar('button', ativa ? 'ordenar ordenar--ativo' : 'ordenar');
        botao.type = 'button';
        const seta = criar('span', 'ordenar__seta', ativa ? (ordenar.atual.direcao === 'asc' ? '▲' : '▼') : '↕');
        seta.setAttribute('aria-hidden', 'true');
        botao.append(texto, seta);
        botao.addEventListener('click', () => ordenar.mudar(campo));
        th.append(botao);
      } else {
        th.textContent = texto;
      }
      tr.append(th);
    }
    tabela.tHead.replaceChildren(tr);
  }

  // No celular as linhas viram cartões: cada célula ganha o nome da coluna
  function rotular(tabela) {
    const nomes = [...tabela.tHead.rows[0].cells].map((th) => th.textContent.replace(/[▲▼↕]/g, '').trim());
    for (const linha of [...tabela.tBodies[0].rows, ...(tabela.tFoot ? tabela.tFoot.rows : [])]) {
      let coluna = 0;
      for (const celula of linha.cells) {
        if (nomes[coluna]) celula.dataset.rotulo = nomes[coluna];
        coluna += celula.colSpan || 1;
      }
    }
  }

  function vazio(tabela, texto, colunas) {
    const tr = document.createElement('tr');
    const c = td(texto, 'vazio');
    c.colSpan = colunas;
    tr.append(c);
    tabela.tBodies[0].replaceChildren(tr);
    tabela.tFoot?.replaceChildren();
  }

  function parte(nome, desenhar) {
    try {
      desenhar();
    } catch (erro) {
      console.error(`Vendas > Vendedores: falha ao montar "${nome}"`, erro);
    }
  }

  const linkPedido = (numero) => (typeof pedidoJanela !== 'undefined' && numero != null ? pedidoJanela.link(numero) : (numero ?? '—'));

  function numero(titulo, valor, detalhe, classeDetalhe) {
    const caixa = criar('div', 'cv-kpi');
    caixa.append(criar('dt', null, titulo));
    const dd = criar('dd', null, valor);
    if (detalhe) dd.append(criar('small', classeDetalhe, detalhe));
    caixa.append(dd);
    return caixa;
  }

  // ---------- Faixa da equipe ----------
  function mostrarKpis() {
    const v = dados.vendedores;
    const soma = (campo) => v.reduce((t, x) => t + num(x[campo]), 0);
    const ativos = v.filter((x) => num(x.notas) > 0).length;
    const casosDuplicados = new Set(dados.duplicadas.map((d) => `${d.motivo}|${d.grupo}`)).size;
    el('cv-kpis').replaceChildren(
      numero('Faturado em nota', dinheiro(soma('valor')), `${contar(soma('notas'), 'nota', 'notas')} · ${contar(ativos, 'vendedor', 'vendedores')}`),
      numero('Líquido', dinheiro(soma('liquido')), soma('devolvido') > 0.009 ? `devolvido ${dinheiro(soma('devolvido'))}` : 'sem devolução'),
      numero('Em orçamento', dinheiro(soma('valor_orcamentos')), contar(soma('orcamentos'), 'pedido', 'pedidos')),
      numero('Cancelados', dinheiro(soma('valor_cancelados')), contar(soma('cancelados'), 'pedido', 'pedidos'),
        soma('cancelados') ? 'negativo' : null),
      numero('Pontos de atenção', inteiro.format(casosDuplicados + dados.devolucoesCanceladas.length),
        `${contar(casosDuplicados, 'nota duplicada?', 'notas duplicadas?')} · ${contar(dados.devolucoesCanceladas.length, 'devolução cancelada', 'devoluções canceladas')}`,
        casosDuplicados + dados.devolucoesCanceladas.length ? 'negativo' : null),
    );
  }

  // ---------- Lista de vendedores ----------
  function mostrarVendedores() {
    const tabela = el('cv-tabela-vendedores');
    const lista = dados.vendedores.filter((v) => num(v.notas) || num(v.orcamentos) || num(v.cancelados));
    const colunas = [['Vendedor', true], ['Faturado'], ['Part.', true], ['Orçamento'], ['Cancelado']];
    cabecalho(tabela, colunas);
    if (!lista.length) {
      vazio(tabela, 'Nenhuma nota nem pedido no período.', colunas.length);
      return;
    }
    const total = lista.reduce((t, v) => t + num(v.valor), 0);
    const maior = Math.max(...lista.map((v) => num(v.valor)), 1);
    tabela.tBodies[0].replaceChildren(...lista.map((v) => {
      const ativo = vendedorAtual === String(v.cod_vendedor);
      const tr = criar('tr', `linha-dia${ativo ? ' linha-dia--aberta' : ''}`);
      tr.title = ativo ? 'Fechar a análise' : 'Ver a análise deste vendedor';
      // Na lista vai o primeiro e o último nome (o nome inteiro aparece ao passar o mouse e na análise)
      const partes = nomeVendedor(v).split(/\s+/);
      const nome = criar('span', 'cv-nome', partes.length > 2 ? `${partes[0]} ${partes[partes.length - 1]}` : nomeVendedor(v));
      nome.title = nomeVendedor(v);
      const barra = criar('span', 'cv-part');
      const cheio = criar('span', 'cv-part__cheio');
      cheio.style.width = `${Math.max(2, (num(v.valor) / maior) * 100)}%`;
      barra.append(cheio);
      const part = criar('span', 'cv-part__caixa');
      part.append(barra, criar('span', 'cv-part__texto', pct(num(v.valor), total, 0)));
      const avisos = [];
      if (num(v.duplicadas)) avisos.push('duplicada?');
      if (num(v.devolucoes_canceladas)) avisos.push('dev. cancelada');
      // Aviso (nota duplicada, devolução cancelada) vai embaixo do nome, em laranja, no lugar do código
      tr.append(
        avisos.length
          ? td(nome, 'esquerda cel-titulo', avisos.join(' · '), 'qtd negativo')
          : td(nome, 'esquerda cel-titulo', `código ${v.cod_vendedor ?? '—'}`),
        td(num(v.notas) ? dinheiro(v.valor) : '—', null, num(v.notas) ? contar(v.notas, 'nota', 'notas') : null),
        td(part, 'esquerda cel-largo'),
        td(num(v.orcamentos) ? dinheiro(v.valor_orcamentos) : '—', null, num(v.orcamentos) ? contar(v.orcamentos, 'pedido', 'pedidos') : null),
        td(num(v.cancelados) ? dinheiro(v.valor_cancelados) : '—', num(v.cancelados) ? 'negativo' : null,
          num(v.cancelados) ? contar(v.cancelados, 'pedido', 'pedidos') : null),
      );
      tr.addEventListener('click', () => selecionarVendedor(ativo ? null : v));
      return tr;
    }));
    const soma = (campo) => lista.reduce((t, v) => t + num(v[campo]), 0);
    const rodape = document.createElement('tr');
    rodape.append(
      td('Total', 'esquerda cel-titulo', contar(lista.length, 'vendedor', 'vendedores')),
      td(dinheiro(soma('valor')), null, contar(soma('notas'), 'nota', 'notas')),
      td('100%', 'esquerda'),
      td(dinheiro(soma('valor_orcamentos')), null, contar(soma('orcamentos'), 'pedido', 'pedidos')),
      td(dinheiro(soma('valor_cancelados')), null, contar(soma('cancelados'), 'pedido', 'pedidos')),
    );
    tabela.tFoot.replaceChildren(rodape);
    rotular(tabela);
  }

  // ---------- Análise do vendedor escolhido ----------
  function selecionarVendedor(v) {
    vendedorAtual = v ? String(v.cod_vendedor) : null;
    analise = null;
    filtroClientes = 'todos';
    parte('vendedores', mostrarVendedores);
    parte('listas', mostrarListas);
    const painel = el('cv-detalhe');
    if (!v) {
      painel.replaceChildren(criar('p', 'explica cv-detalhe__vazio', 'Escolha um vendedor na lista para ver a análise dele e dos clientes.'));
      return;
    }
    painel.replaceChildren(cabecalhoDetalhe(v), criar('p', 'status', 'Montando a análise…'));
    if (window.matchMedia('(max-width: 1100px)').matches) painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    carregarAnalise(v);
  }

  function cabecalhoDetalhe(v) {
    const topo = criar('div', 'cv-detalhe__topo');
    const titulo = criar('div');
    titulo.append(criar('h2', null, nomeVendedor(v)));
    const ranking = dados.vendedores.findIndex((x) => x === v) + 1;
    titulo.append(criar('p', 'bloco__descricao',
      `código ${v.cod_vendedor ?? '—'} · ${ranking}º de ${dados.vendedores.length} em faturamento · ${dataBR(filtrosCarga.inicio)} a ${dataBR(filtrosCarga.fim)}`));
    const acoes = criar('div', 'cv-detalhe__acoes');
    const pedidos = criar('button', 'botao-secundario', 'Ver pedidos');
    pedidos.type = 'button';
    pedidos.title = 'Pedidos do vendedor: orçamentos, notas pagas, pendentes e cancelados';
    pedidos.addEventListener('click', () => abrirFatVendedor(v));
    const fechar = criar('button', 'botao-secundario', 'Fechar');
    fechar.type = 'button';
    fechar.addEventListener('click', () => selecionarVendedor(null));
    acoes.append(pedidos, fechar);
    topo.append(titulo, acoes);
    return topo;
  }

  async function carregarAnalise(v) {
    const minha = ++cargaAnalise;
    const codigo = String(v.cod_vendedor);
    try {
      const resposta = await buscar('analise-vendedor', { ...filtrosCarga, vendedor: v.cod_vendedor });
      if (minha !== cargaAnalise || vendedorAtual !== codigo) return;
      analise = resposta;
      parte('analise', () => mostrarAnalise(v));
    } catch (erro) {
      if (minha !== cargaAnalise || erro instanceof ChaveInvalida) return;
      const painel = el('cv-detalhe');
      painel.replaceChildren(cabecalhoDetalhe(v), criar('p', 'status status--erro', erro.message));
    }
  }

  function classificarCliente(c) {
    const a = num(c.atual);
    const b = num(c.anterior);
    if (b <= 0 && a > 0) return 'novo';
    if (b > 0 && a <= 0) return 'parou';
    if (b > 0 && a <= b * (1 - QUEDA)) return 'menos';
    if (b > 0 && a >= b * (1 + QUEDA)) return 'mais';
    return 'estavel';
  }

  function mostrarAnalise(v) {
    const painel = el('cv-detalhe');
    const conteudo = [cabecalhoDetalhe(v)];
    const erroNotas = analise.erros?.notas;
    const erroClientes = analise.erros?.clientes;
    if (erroNotas) conteudo.push(criar('p', 'status status--erro', `Números do vendedor: ${erroNotas}`));

    // Equipe e vendedor (pela sub-tela Faturados por vendedor: mesma conta)
    const equipe = analise.vendedores ?? [];
    const eu = equipe.find((x) => String(x.cod_vendedor) === vendedorAtual) ?? {};
    const somaEquipe = (campo) => equipe.reduce((t, x) => t + num(x[campo]), 0);
    const valor = num(eu.valor) || num(v.valor);
    const notas = num(eu.notas) || num(v.notas);
    const ticket = notas ? valor / notas : 0;
    const ticketEquipe = somaEquipe('notas') ? somaEquipe('valor') / somaEquipe('notas') : 0;
    const anterior = num(eu.valor_anterior);
    const crescimento = anterior > 0 ? ((valor - anterior) / anterior) * 100 : null;
    const devolvido = num(eu.devolvido) || num(v.devolvido);
    const devPct = valor ? devolvido / valor * 100 : 0;
    const devEquipe = somaEquipe('valor') ? somaEquipe('devolvido') / somaEquipe('valor') * 100 : 0;
    const ativos = equipe.filter((x) => num(x.notas) > 0);
    const mediaVendedor = ativos.length ? somaEquipe('valor') / ativos.length : 0;
    const ranking = equipe.findIndex((x) => String(x.cod_vendedor) === vendedorAtual) + 1;

    // Clientes
    const clientes = (analise.clientes ?? []).map((c) => ({ ...c, tipo: classificarCliente(c) }));
    const contarTipo = (t) => clientes.filter((c) => c.tipo === t);
    const pararam = contarTipo('parou');
    const menos = contarTipo('menos');
    const novos = contarTipo('novo');
    const comCompra = clientes.filter((c) => num(c.atual) > 0);
    const top3 = [...comCompra].sort((a, b) => num(b.atual) - num(a.atual)).slice(0, 3).reduce((t, c) => t + num(c.atual), 0);
    const concentracao = valor ? top3 / valor * 100 : 0;

    // Dias (com zero onde não teve nota) e pico
    const porDia = new Map((analise.porDia ?? []).map((d) => [String(d.dia).slice(0, 10), num(d.valor_vendedor)]));
    const dias = [];
    for (let d = new Date(`${filtrosCarga.inicio}T12:00:00`); isoDe(d) <= filtrosCarga.fim; d.setDate(d.getDate() + 1)) {
      dias.push({ dia: isoDe(d), valor: porDia.get(isoDe(d)) ?? 0 });
    }
    const hoje = isoDe(new Date());
    const pico = dias.reduce((m, d) => (d.valor > (m?.valor ?? 0) ? d : m), null);
    const semNota = dias.filter((d) => d.dia <= hoje && diaDaSemana(d.dia) !== 0 && d.valor === 0);

    // Pedidos do vendedor (lista da equipe)
    const orcamentos = doVendedor(dados.orcamentos);
    const parados = orcamentos.filter((p) => num(p.dias) > 7);
    const valorCancelado = num(v.valor_cancelados);

    // ---- Números ----
    const dl = criar('dl', 'cv-kpis cv-kpis--detalhe');
    dl.append(
      numero('Faturado', dinheiro(valor),
        crescimento === null ? 'sem nota no mês anterior' : `${sinal(crescimento)} contra o mês anterior`,
        crescimento === null ? null : crescimento >= 0 ? 'sobe' : 'negativo'),
      numero('Participação', pct(valor, somaEquipe('valor')), `${ranking || '—'}º de ${equipe.length || '—'} vendedores`),
      numero('Ticket médio', dinheiro(ticket), ticketEquipe ? `equipe ${dinheiro(ticketEquipe)} (${sinal((ticket / ticketEquipe - 1) * 100, 0)})` : null),
      numero('Clientes', inteiro.format(comCompra.length),
        `${contar(novos.length, 'novo', 'novos')} · ${contar(pararam.length, 'parou', 'pararam')} · ${contar(menos.length, 'compra menos', 'compram menos')}`,
        pararam.length || menos.length ? 'negativo' : null),
      numero('Em orçamento', dinheiro(v.valor_orcamentos), parados.length ? `${contar(parados.length, 'parado', 'parados')} há mais de 7 dias` : contar(num(v.orcamentos), 'pedido', 'pedidos'),
        parados.length ? 'negativo' : null),
      numero('Devolução', pct(devolvido, valor), `equipe ${devEquipe.toFixed(1).replace('.', ',')}%`,
        devPct > Math.max(1, devEquipe * 1.5) ? 'negativo' : null),
    );
    conteudo.push(dl);

    // ---- Leitura do gestor ----
    const fortes = [];
    const atencao = [];
    if (ranking === 1) fortes.push(`Maior faturamento da equipe (${pct(valor, somaEquipe('valor'))} do total).`);
    else if (valor >= mediaVendedor && mediaVendedor) fortes.push(`Acima da média por vendedor (${dinheiro(mediaVendedor)}).`);
    else if (mediaVendedor) atencao.push(`Abaixo da média por vendedor: ${dinheiro(valor)} contra ${dinheiro(mediaVendedor)}.`);
    if (crescimento !== null) {
      if (crescimento >= 5) fortes.push(`Cresceu ${sinal(crescimento)} sobre o mesmo intervalo do mês anterior.`);
      else if (crescimento <= -5) atencao.push(`Caiu ${sinal(crescimento)} contra o mês anterior (era ${dinheiro(anterior)}).`);
    }
    if (ticketEquipe) {
      const dif = (ticket / ticketEquipe - 1) * 100;
      if (dif >= 10) fortes.push(`Ticket ${sinal(dif, 0)} acima da equipe: pedidos maiores.`);
      else if (dif <= -10) atencao.push(`Ticket ${sinal(dif, 0)} abaixo da equipe: trabalhar mix e quantidade por pedido.`);
    }
    if (pararam.length) {
      const soma = pararam.reduce((t, c) => t + num(c.anterior), 0);
      const nomes = [...pararam].sort((a, b) => num(b.anterior) - num(a.anterior)).slice(0, 2).map(nomeCliente).join(', ');
      atencao.push(`${contar(pararam.length, 'cliente parou', 'clientes pararam')} de comprar (compravam ${dinheiro(soma)}): ${nomes}${pararam.length > 2 ? '…' : ''}.`);
    }
    if (menos.length) {
      const perda = menos.reduce((t, c) => t + num(c.anterior) - num(c.atual), 0);
      atencao.push(`${contar(menos.length, 'cliente compra', 'clientes compram')} 20% ou mais a menos: ${dinheiro(perda)} a menos que no mês anterior.`);
    }
    if (novos.length) fortes.push(`${contar(novos.length, 'cliente novo', 'clientes novos')} no período (${dinheiro(novos.reduce((t, c) => t + num(c.atual), 0))}).`);
    if (comCompra.length >= 3) {
      if (concentracao >= 50) atencao.push(`Carteira concentrada: 3 clientes fazem ${pct(top3, valor, 0)} do faturado.`);
      else fortes.push(`Carteira distribuída: os 3 maiores clientes são ${pct(top3, valor, 0)} do faturado.`);
    }
    if (parados.length) atencao.push(`${dinheiro(parados.reduce((t, p) => t + num(p.valor), 0))} em orçamento parado há mais de 7 dias: ligar para fechar.`);
    if (valor && valorCancelado / (valor + valorCancelado) >= 0.05) atencao.push(`Cancelou ${dinheiro(valorCancelado)} em pedidos (${pct(valorCancelado, valor + valorCancelado, 0)} do que vendeu).`);
    if (devolvido > 0.009 && devPct > Math.max(1, devEquipe * 1.5)) atencao.push(`Devolução de ${devPct.toFixed(1).replace('.', ',')}%, acima da equipe: conferir o pedido com o cliente antes de fechar.`);
    if (num(v.duplicadas)) atencao.push(`${contar(num(v.duplicadas), 'nota parece duplicada', 'notas parecem duplicadas')}: conferir no PROCFIT.`);
    if (semNota.length >= 2) atencao.push(`${contar(semNota.length, 'dia útil', 'dias úteis')} sem nenhuma nota: ${semNota.slice(-4).map((d) => dataBR(d.dia).slice(0, 5)).join(', ')}${semNota.length > 4 ? '…' : ''}.`);
    if (pico && valor) fortes.push(`Pico em ${DIAS_SEMANA[diaDaSemana(pico.dia)]}, ${dataBR(pico.dia).slice(0, 5)}: ${dinheiro(pico.valor)}.`);
    const leitura = criar('div', 'cv-leitura');
    const bloco = (titulo, itens, classe) => {
      const caixa = criar('div', classe);
      caixa.append(criar('h3', null, titulo));
      const ul = criar('ul');
      ul.append(...itens.map((t) => criar('li', null, t)));
      caixa.append(ul);
      return caixa;
    };
    leitura.append(
      bloco('Pontos fortes', fortes.length ? fortes : ['Sem destaque no período.'], 'cv-leitura--forte'),
      bloco('Pontos de atenção', atencao.length ? atencao : ['Nada fora do normal no período.'], 'cv-leitura--atencao'),
    );
    conteudo.push(leitura);

    // ---- Faturado por dia ----
    conteudo.push(criar('h3', 'cv-subtitulo', 'Faturado por dia'));
    const grafico = criar('div', 'grafico-rolagem cv-grafico');
    conteudo.push(grafico);

    // ---- Clientes do vendedor ----
    const topoClientes = criar('div', 'cv-clientes-topo');
    topoClientes.append(criar('h3', 'cv-subtitulo', 'Clientes do vendedor'));
    const chips = criar('div', 'cv-chips');
    const opcoes = [
      ['todos', 'Todos', clientes.length], ['menos', 'Compram menos', menos.length],
      ['parou', 'Pararam', pararam.length], ['novo', 'Novos', novos.length], ['mais', 'Compram mais', contarTipo('mais').length],
    ];
    for (const [id, texto, qtd] of opcoes) {
      const b = criar('button', `botao-secundario${filtroClientes === id ? ' atalho--ativo' : ''}`, `${texto} · ${qtd}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filtroClientes === id));
      b.addEventListener('click', () => { filtroClientes = id; mostrarAnalise(v); });
      chips.append(b);
    }
    topoClientes.append(chips);
    conteudo.push(topoClientes);
    if (erroClientes) conteudo.push(criar('p', 'status status--erro', `Clientes: ${erroClientes}`));
    const anteriorTexto = clientes[0]?.inicio_anterior
      ? `${dataBR(clientes[0].inicio_anterior)} a ${dataBR(clientes[0].fim_anterior)}` : 'mesmo intervalo do mês anterior';
    conteudo.push(criar('p', 'bloco__descricao', `Notas do vendedor por cliente: agora e no período anterior (${anteriorTexto}).`));
    const tabela = criar('table', 'tabela tabela-cartoes tabela--compacta');
    tabela.append(document.createElement('thead'), document.createElement('tbody'));
    const rolagem = criar('div', 'tabela-rolagem');
    rolagem.append(tabela);
    conteudo.push(rolagem);

    painel.replaceChildren(...conteudo);

    // Tabela de clientes (filtro + ordem)
    const filtrados = filtroClientes === 'todos' ? clientes : clientes.filter((c) => c.tipo === filtroClientes);
    const fator = ordemClientes.direcao === 'asc' ? 1 : -1;
    const valorDe = (c, campo) => (campo === 'variacao'
      ? (num(c.anterior) > 0 ? (num(c.atual) - num(c.anterior)) / num(c.anterior) : (num(c.atual) > 0 ? 9 : 0))
      : campo === 'cliente' ? nomeCliente(c) : campo === 'ultima_compra' ? (c.ultima_compra ?? '') : num(c[campo]));
    filtrados.sort((a, b) => {
      const x = valorDe(a, ordemClientes.campo);
      const y = valorDe(b, ordemClientes.campo);
      return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * fator;
    });
    cabecalho(tabela, [['Cliente', true, 'cliente'], ['Agora', false, 'atual'], ['Antes', false, 'anterior'],
      ['Variação', false, 'variacao'], ['Última compra', true, 'ultima_compra']], {
      atual: ordemClientes,
      mudar: (campo) => {
        ordemClientes = { campo, direcao: ordemClientes.campo === campo && ordemClientes.direcao === 'desc' ? 'asc' : (campo === 'cliente' ? 'asc' : 'desc') };
        mostrarAnalise(v);
      },
    });
    const SELO = { novo: 'novo', parou: 'parou', menos: 'compra menos', mais: 'compra mais' };
    if (!filtrados.length) {
      const tr = document.createElement('tr');
      const c = td(clientes.length ? 'Nenhum cliente neste filtro.' : 'Nenhum cliente com nota no período.', 'vazio');
      c.colSpan = 5;
      tr.append(c);
      tabela.tBodies[0].replaceChildren(tr);
    } else {
      tabela.tBodies[0].replaceChildren(...filtrados.map((c) => {
        const tr = criar('tr', c.tipo === 'parou' || c.tipo === 'menos' ? 'cv-linha-queda' : null);
        const nome = criar('span', null, nomeCliente(c));
        if (SELO[c.tipo]) nome.append(' ', criar('span', `cv-selo cv-selo--${c.tipo}`, SELO[c.tipo]));
        const a = num(c.atual);
        const b = num(c.anterior);
        const varTexto = b > 0 ? sinal((a - b) / b * 100, 0) : (a > 0 ? 'novo' : '—');
        const diasSem = c.ultima_compra ? Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${c.ultima_compra}T12:00:00`)) / 86400000) : null;
        tr.append(
          td(nome, 'esquerda cel-titulo', `código ${c.cod_cliente}`),
          td(a ? dinheiro(a) : '—', null, a ? contar(num(c.notas_atual), 'nota', 'notas') : null),
          td(b ? dinheiro(b) : '—', null, b ? contar(num(c.notas_anterior), 'nota', 'notas') : null),
          td(varTexto, b > 0 && a < b ? 'negativo' : (b > 0 && a > b ? 'sobe' : null), b > 0 ? `${a >= b ? '+' : '−'}${dinheiro(Math.abs(a - b))}` : null),
          td(c.ultima_compra ? dataBR(c.ultima_compra) : '—', `esquerda${diasSem != null && diasSem > 30 ? ' negativo' : ''}`,
            diasSem != null ? (diasSem === 0 ? 'hoje' : `há ${contar(diasSem, 'dia', 'dias')}`) : null),
        );
        return tr;
      }));
    }
    rotular(tabela);

    // Gráfico por último (precisa do painel na tela para medir a largura)
    if (typeof graficos !== 'undefined' && dias.length) {
      graficos.colunas(grafico, {
        titulo: `Faturado por dia: ${nomeVendedor(v)}`,
        altura: 170,
        rotulos: dias.map((d) => (window.matchMedia('(max-width: 720px)').matches ? d.dia.slice(8, 10) : dataBR(d.dia).slice(0, 5))),
        series: [{
          nome: 'Faturado em nota',
          valores: dias.map((d) => d.valor),
          cores: dias.map((d) => (pico && d.dia === pico.dia ? 'var(--verde-escuro)' : diaDaSemana(d.dia) === 0 ? 'var(--verde-claro)' : 'var(--verde)')),
        }],
      });
    } else {
      grafico.textContent = 'Gráfico indisponível agora.';
    }
  }

  // ---------- Listas: orçamento, cancelados, devoluções canceladas ----------
  const DESCRICAO_LISTA = {
    orcamentos: 'Pedidos feitos no período que ainda estão em orçamento ou pendentes de aprovação: venda que ainda pode acontecer. "Parado há" conta desde o dia do pedido.',
    cancelados: 'Pedidos feitos no período que foram cancelados, os mais recentes primeiro.',
    devcanceladas: 'Devoluções canceladas no período: a mercadoria não voltou, então a venda original continua valendo e não desconta do faturamento.',
  };

  function mostrarListas() {
    const quem = vendedorAtual ? nomeVendedor(dados.vendedores.find((v) => String(v.cod_vendedor) === vendedorAtual) ?? {}) : null;
    const orc = doVendedor(dados.orcamentos);
    const can = doVendedor(dados.cancelados);
    const dev = doVendedor(dados.devolucoesCanceladas);
    el('titulo-cv-listas').textContent = quem ? `Pedidos e devoluções de ${quem}` : 'Pedidos e devoluções';
    el('titulo-cv-orcamentos').textContent = `Em orçamento · ${inteiro.format(vendedorAtual ? orc.length : dados.totalOrcamentos)}`;
    el('titulo-cv-cancelados').textContent = `Cancelados · ${inteiro.format(vendedorAtual ? can.length : dados.totalCancelados)}`;
    el('titulo-cv-devcanceladas').textContent = `Devoluções canceladas · ${inteiro.format(dev.length)}`;
    for (const b of el('cv-abas').querySelectorAll('[data-lista]')) {
      const ativa = b.dataset.lista === listaAtiva;
      b.classList.toggle('atalho--ativo', ativa);
      b.setAttribute('aria-pressed', String(ativa));
    }
    for (const p of document.querySelectorAll('[data-lista-painel]')) p.hidden = p.dataset.listaPainel !== listaAtiva;
    el('cv-lista-descricao').textContent = DESCRICAO_LISTA[listaAtiva];
    if (listaAtiva === 'devcanceladas') parte('devolucoes canceladas', () => mostrarDevolucoesCanceladas(dev));
    else parte(listaAtiva, () => mostrarPedidos(listaAtiva, listaAtiva === 'orcamentos' ? orc : can));
  }

  function mostrarPedidos(tipo, lista) {
    const ehOrcamento = tipo === 'orcamentos';
    const tabela = el(ehOrcamento ? 'cv-tabela-orcamentos' : 'cv-tabela-cancelados');
    const total = vendedorAtual ? lista.length : (ehOrcamento ? dados.totalOrcamentos : dados.totalCancelados);
    const colunas = ehOrcamento
      ? [['Pedido', true], ['Dia', true], ['Cliente', true], ['Vendedor', true], ['Situação', true], ['Parado há'], ['Valor']]
      : [['Pedido', true], ['Dia do pedido', true], ['Cliente', true], ['Vendedor', true], ['Cancelado em', true], ['Valor']];
    if (vendedorAtual) colunas.splice(3, 1); // com um vendedor escolhido, a coluna só repetiria o nome
    cabecalho(tabela, colunas);
    const botaoMais = el(ehOrcamento ? 'cv-mais-orcamentos' : 'cv-mais-cancelados');
    if (!lista.length) {
      vazio(tabela, ehOrcamento ? 'Nenhum pedido em orçamento no período.' : 'Nenhum pedido cancelado no período.', colunas.length);
      botaoMais.hidden = true;
      return;
    }
    const visiveis = lista.slice(0, mostrando[tipo]);
    tabela.tBodies[0].replaceChildren(...visiveis.map((p) => {
      const tr = document.createElement('tr');
      tr.append(
        td(linkPedido(p.pedido), 'esquerda sem-quebra cel-titulo'),
        td(dataBR(p.dia), 'esquerda sem-quebra'),
        td(nomeCliente(p), 'esquerda cel-largo'),
      );
      if (!vendedorAtual) tr.append(td(nomeVendedor(p), 'esquerda cel-largo'));
      if (ehOrcamento) {
        const dias = num(p.dias);
        tr.append(
          td(p.situacao === 'aprovacao' ? 'Pendente de aprovação' : 'Orçamento', 'esquerda'),
          td(dias === 0 ? 'hoje' : contar(dias, 'dia', 'dias'), dias > 7 ? 'negativo' : null),
          td(dinheiro(p.valor), 'coluna-final'),
        );
      } else {
        tr.append(
          td(p.cancelado_em ? `${dataBR(p.cancelado_em.slice(0, 10))} ${p.cancelado_em.slice(11, 16)}` : 'status Cancelado', 'esquerda sem-quebra'),
          td(dinheiro(p.valor), 'negativo'),
        );
      }
      return tr;
    }));
    const soma = lista.reduce((t, p) => t + num(p.valor), 0);
    const rodape = document.createElement('tr');
    const rotulo = td(`Total${total > lista.length ? ` dos ${inteiro.format(lista.length)} maiores` : ''}`, 'esquerda cel-titulo');
    rotulo.colSpan = colunas.length - 1;
    rodape.append(rotulo, td(dinheiro(soma)));
    tabela.tFoot.replaceChildren(rodape);
    rotular(tabela);
    const restam = lista.length - visiveis.length;
    botaoMais.hidden = restam <= 0;
    botaoMais.textContent = `Mostrar mais ${Math.min(POR_VEZ, restam)} (faltam ${inteiro.format(restam)})`;
  }

  function mostrarDevolucoesCanceladas(lista) {
    const tabela = el('cv-tabela-devcanceladas');
    cabecalho(tabela, [['NF de devolução', true], ['Devolução em', true], ['Cancelada em', true],
      ['Nota original', true], ['Cliente', true], ['Vendedor', true], ['Valor']]);
    if (!lista.length) {
      vazio(tabela, 'Nenhuma devolução cancelada no período.', 7);
      return;
    }
    tabela.tBodies[0].replaceChildren(...lista.map((d) => {
      const tr = document.createElement('tr');
      tr.append(
        td(`NF ${d.nota_devolucao ?? '—'}`, 'esquerda sem-quebra cel-titulo'),
        td(dataBR(d.devolucao_dia), 'esquerda sem-quebra'),
        td(d.cancelado_em ? `${dataBR(d.cancelado_em.slice(0, 10))} ${d.cancelado_em.slice(11, 16)}` : '—', 'esquerda sem-quebra',
          d.com_protocolo ? null : 'sem protocolo da SEFAZ'),
        td(d.nota_origem != null ? `NF ${d.nota_origem}` : '—', 'esquerda sem-quebra'),
        td(nomeCliente(d), 'esquerda cel-largo'),
        td(nomeVendedor(d), 'esquerda cel-largo'),
        td(dinheiro(d.valor)),
      );
      return tr;
    }));
    rotular(tabela);
  }

  // ---------- Notas duplicadas ----------
  function mostrarDuplicadas() {
    const secao = el('cv-duplicadas');
    const notas = dados.duplicadas;
    secao.hidden = !notas.length;
    if (!notas.length) return;
    const grupos = new Map();
    for (const n of notas) {
      const k = `${n.motivo}|${n.grupo}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(n);
    }
    el('titulo-cv-duplicadas').textContent = `Notas que parecem duplicadas (${contar(grupos.size, 'caso', 'casos')})`;
    const tabela = el('cv-tabela-duplicadas');
    cabecalho(tabela, [['Notas', true], ['Dia', true], ['Cliente', true], ['Vendedor', true], ['Motivo', true], ['Valor de cada'], ['Somado']]);
    tabela.tBodies[0].replaceChildren(...[...grupos.values()].map((g) => {
      const n = g[0];
      const numeros = criar('span');
      g.forEach((x, i) => {
        if (i) numeros.append(', ');
        const nf = criar('span', x.conta_como_venda ? null : 'cv-fora', `NF ${x.nota}`);
        if (!x.conta_como_venda) nf.title = 'O PROCFIT não conta esta nota como venda (não está como venda na VENDAS_ANALITICAS)';
        numeros.append(nf);
      });
      const tr = document.createElement('tr');
      tr.append(
        td(numeros, 'esquerda cel-titulo'),
        td(dataBR(n.dia), 'esquerda sem-quebra'),
        td(nomeCliente(n), 'esquerda cel-largo'),
        td([...new Set(g.map(nomeVendedor))].join(', '), 'esquerda cel-largo'),
        td(n.motivo === 'pedido' ? `Mesmo pedido (${n.pedido})` : 'Mesmo cliente, dia e valor', 'esquerda'),
        td(dinheiro(n.valor)),
        td(dinheiro(g.reduce((t, x) => t + num(x.valor), 0)), 'negativo'),
      );
      return tr;
    }));
    rotular(tabela);
  }

  function desenhar() {
    el('cv-aviso-notas').hidden = !dados.erros?.notas;
    el('cv-aviso-notas').textContent = dados.erros?.notas ? `Faturado em nota: ${dados.erros.notas}` : '';
    el('cv-aviso-pedidos').hidden = !dados.erros?.pedidos;
    el('cv-aviso-pedidos').textContent = dados.erros?.pedidos ? `Orçamentos e cancelados: ${dados.erros.pedidos}` : '';
    parte('números', mostrarKpis);
    parte('duplicadas', mostrarDuplicadas);
    parte('vendedores', mostrarVendedores);
    parte('listas', mostrarListas);
  }

  async function carregar(filtros, minhaCarga) {
    const status = el('cv-status');
    status.classList.remove('status--erro');
    status.textContent = 'Carregando o controle por vendedor…';
    try {
      const resposta = await buscar('controle-vendedores', filtros);
      if (minhaCarga !== cargaAtual) return;
      dados = resposta;
      filtrosCarga = { ...filtros };
      mostrando.orcamentos = POR_VEZ;
      mostrando.cancelados = POR_VEZ;
      desenhar();
      status.textContent = '';
      // Vendedor que estava aberto continua aberto (com os números do período novo)
      const aberto = vendedorAtual && dados.vendedores.find((v) => String(v.cod_vendedor) === vendedorAtual);
      if (aberto) selecionarVendedor(aberto);
      else if (vendedorAtual) selecionarVendedor(null);
    } catch (erro) {
      if (minhaCarga !== cargaAtual || erro instanceof ChaveInvalida) return;
      status.textContent = erro.message;
      status.classList.add('status--erro');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const tipo of ['orcamentos', 'cancelados']) {
      el(`cv-mais-${tipo}`).addEventListener('click', () => {
        mostrando[tipo] += POR_VEZ;
        parte(tipo, mostrarListas);
      });
    }
    el('cv-abas').addEventListener('click', (evento) => {
      const botao = evento.target.closest('[data-lista]');
      if (!botao || !dados) return;
      listaAtiva = botao.dataset.lista;
      parte('listas', mostrarListas);
    });
  });

  return { carregar };
})();
