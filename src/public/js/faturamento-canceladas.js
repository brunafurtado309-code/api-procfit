// Faturamento > Notas canceladas / financeiro: notas canceladas que ainda mexem no financeiro.
// A regra (de onde vem cada número) está em src/repositories/notas-canceladas.repository.js.
// Três abas: #devolucoes e #notas (só as que ainda mexem no financeiro) e #todos (tudo o que foi
// cancelado: nota, devolução, cupom do caixa e pedido, dizendo o tipo em cada linha). Também no menu.

(function () {
  const el = (id) => document.getElementById(id);
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dinheiro = (v) => moeda.format(Number(v) || 0);
  const n = (v) => Number(v) || 0;
  const plural = (q, um, varios) => `${q.toLocaleString('pt-BR')} ${q === 1 ? um : varios}`;
  const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const dataHoraBR = (t) => (t ? `${dataBR(t)} ${String(t).slice(11, 16)}` : '—');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  let dados = null;
  // Aba Devolução (nov/2026): todas as notas de devolução do período, com o título que geraram.
  // Consulta à parte (/faturamento/devolucoes), carregada quando a aba está aberta.
  let devol = null;
  let devolCarregando = null;
  // Aba "Todos os cancelamentos": carrega só quando a aba é aberta (consulta à parte)
  let todos = null;
  let todosCarregando = null;
  let tipoTodos = ''; // '' = todos os tipos
  let abaAtual = 'devolucoes';
  // Situações do filtro em cada aba ("gerando" junta as duas que ainda abatem)
  const OPCOES_SITUACAO = {
    devolucoes: [['', 'Todas'], ['com_titulo', 'Gerou título financeiro'], ['sem_titulo', 'Não gerou título financeiro'], ['cancelada', 'Canceladas']],
    notas: [['', 'Todas'], ['com', 'Gerando financeiro'], ['cobranca_dupla', 'Cobrança em dobro'], ['recebida', 'Cancelada com recebimento'],
      ['em_aberto', 'Título em aberto'], ['sem', 'Sem financeiro']],
    todos: [['', 'Todos'], ['mexe', 'Mexe no financeiro'], ['ok', 'Sem efeito no financeiro']],
  };
  const situacaoEscolhida = { devolucoes: '', notas: '', todos: '' };

  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  // Célula com o valor e, embaixo, uma linha pequena (mesmo padrão das outras telas)
  function celula(valor, classe = '', pequena = '') {
    const td = criar('td', classe);
    if (valor instanceof Node) td.append(valor);
    else td.append(String(valor ?? '—'));
    if (pequena) td.append(criar('span', 'qtd', pequena));
    return td;
  }
  const status = (texto, erro) => { el('status').textContent = texto || ''; el('status').classList.toggle('erro', Boolean(erro)); };

  function periodo(dias) {
    const fim = new Date();
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - (dias - 1));
    el('inicio').value = iso(inicio);
    el('fim').value = iso(fim);
  }

  async function carregar() {
    status('Carregando…');
    const url = new URL('/faturamento/notas-canceladas', location.origin);
    url.searchParams.set('inicio', el('inicio').value);
    url.searchParams.set('fim', el('fim').value);
    if (typeof modulos !== 'undefined') modulos.marcarLoja(url); // loja escolhida no menu
    try {
      const r = await fetch(url, { headers: { 'x-api-key': sessionStorage.getItem('apiKey') || '' } });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.erro || 'Não foi possível carregar.');
      dados = corpo;
      todos = null; // período ou loja mudou: a lista completa busca de novo
      devol = null; // e a lista de devoluções também
      if (abaAtual === 'todos' || abaAtual === 'notas') carregarTodos();
      if (abaAtual === 'devolucoes') carregarDevolucoes();
      montarOpcoes();
      desenhar();
      status('');
      el('painel').hidden = false;
    } catch (err) {
      status(err.message, true);
    }
  }

  const bate = (termo, ...campos) => !termo || campos.some((c) => String(c ?? '').toLowerCase().includes(termo));

  // Filtros da lista: situação, vendedor, cliente e valor mínimo (na hora, sem ir ao banco)
  function passaFiltros(linha, valor) {
    const sit = situacaoEscolhida[abaAtual];
    if (abaAtual === 'todos') {
      if ((sit === 'mexe' && !linha.mexe_financeiro) || (sit === 'ok' && linha.mexe_financeiro)) return false;
    } else if (abaAtual === 'notas' && (sit === 'com' || sit === 'sem')) {
      // "com" = qualquer situação do bloco que gera financeiro; "sem" = só o bloco sem financeiro
      if ((sit === 'com') !== !linha.sem_financeiro) return false;
    } else if (abaAtual === 'notas' && sit && linha.sem_financeiro) {
      return false; // escolheu uma situação de financeiro: o bloco sem financeiro fica vazio
    } else if (sit === 'gerando' ? !['abatendo', 'abatendo_estorno'].includes(linha.situacao) : sit && linha.situacao !== sit) return false;
    const vendedor = el('filtro-vendedor').value;
    if (vendedor && String(linha.cod_vendedor ?? '') !== vendedor) return false;
    const cliente = el('filtro-cliente').value.trim().toLowerCase();
    if (cliente && !String(linha.cliente ?? '').toLowerCase().includes(cliente) && String(linha.cod_cliente ?? '') !== cliente) return false;
    const minimo = Number(el('filtro-valor').value);
    if (minimo > 0 && n(valor) < minimo) return false;
    return true;
  }

  // Opções de vendedor e cliente: as que aparecem nas duas listas
  function montarOpcoes() {
    const vendedores = new Map();
    const clientes = new Set();
    for (const l of [...(dados?.devolucoes || []), ...(dados?.vendas || []), ...(todos?.lista || []), ...(devol?.lista || [])]) {
      if (l.cod_vendedor != null) vendedores.set(String(l.cod_vendedor), l.vendedor || `Vendedor ${l.cod_vendedor}`);
      if (l.cliente) clientes.add(l.cliente);
    }
    const atual = el('filtro-vendedor').value;
    el('filtro-vendedor').replaceChildren(new Option('Todos', ''),
      ...[...vendedores.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([c, nome]) => new Option(nome, c)));
    el('filtro-vendedor').value = vendedores.has(atual) ? atual : '';
    el('lista-clientes').replaceChildren(...[...clientes].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((c) => new Option(c)));
  }

  function montarSituacao() {
    el('filtro-situacao').replaceChildren(...OPCOES_SITUACAO[abaAtual].map(([v, t]) => new Option(t, v)));
    el('filtro-situacao').value = situacaoEscolhida[abaAtual];
  }

  function desenhar() {
    if (abaAtual === 'todos') { desenharTodos(); return; }
    if (abaAtual === 'devolucoes') { desenharDevolucoes(); return; }
    if (!dados) return;
    const termo = el('pesquisa-termo').value.trim().toLowerCase();
    const r = dados.resumo;

    el('resumo-vendas').textContent = r.vendas_com_financeiro ? dinheiro(r.valor_vendas_pendente + r.valor_vendas_recebido) : 'Nenhuma';
    el('resumo-vendas-explica').textContent = `${plural(r.vendas_com_financeiro, 'nota', 'notas')} · ${dinheiro(r.valor_vendas_pendente)} em aberto e ${dinheiro(r.valor_vendas_recebido)} recebidos sem estorno`
      + `${r.vendas_cobranca_dupla ? ` · ${plural(r.vendas_cobranca_dupla, 'cobrança em dobro', 'cobranças em dobro')}` : ''} · ${plural(r.vendas_canceladas, 'nota de venda cancelada', 'notas de venda canceladas')} no período`;

    // C. Notas e cupons cancelados SEM financeiro (da lista completa), mais o resumo com e sem
    desenharSemFinanceiro(termo);

    // B. Notas de venda canceladas com financeiro
    const vendas = dados.vendas
      .filter((v) => passaFiltros(v, n(v.pendente) + n(v.recebido)))
      .filter((v) => bate(termo, v.nota, v.id, v.nota_substituta_registro, ...(v.baixas || []).map((b) => b.registro), v.pedido, v.cliente, v.cod_cliente, v.numeros_titulos, v.nota_substituta));
    el('titulo-vendas').textContent = `Notas de venda canceladas com financeiro (${vendas.length})`;
    const corpoB = el('tabela-vendas').tBodies[0];
    corpoB.replaceChildren(...vendas.map((v) => {
      const tr = criar('tr', `linha-vencida${v.cobranca_dupla ? ' canceladas-dupla' : ''}`);
      const recebidoQuando = n(v.recebido) > 0.009 && v.ultimo_recebimento
        ? `em ${dataBR(v.ultimo_recebimento)}, ${v.recebido_depois ? 'depois' : 'antes'} do cancelamento` : '';
      const estorno = n(v.estornado) > 0.009 ? ` · estornado ${dinheiro(v.estornado)}` : '';
      const substituta = v.nota_substituta
        ? celula(`nota ${v.nota_substituta}`, `esquerda${v.cobranca_dupla ? ' negativo' : ''}`,
          `registro ${v.nota_substituta_registro} · ${dataBR(v.nota_substituta_dia)} · ${n(v.substituta_pendente) > 0.009 ? `${dinheiro(v.substituta_pendente)} em aberto` : 'quitada'}${v.substituta_por === 'cliente_valor' ? ' · mesmo cliente e valor' : ''}`)
        : celula('—', 'esquerda', 'nenhuma achada');
      tr.append(
        celula(`${v.nota}`, 'esquerda', `registro ${v.id} · emitida em ${dataBR(v.nota_dia)}${v.pedido ? ` · pedido ${v.pedido}` : ''}`),
        celula(dataHoraBR(v.cancelado_em), 'esquerda', v.com_protocolo ? 'com protocolo SEFAZ' : 'sem protocolo SEFAZ'),
        celula(v.cliente || `cliente ${v.cod_cliente ?? '—'}`, 'esquerda', v.vendedor ? `vendedor ${v.vendedor}` : ''),
        celula(dinheiro(v.valor_nota)),
        celula(v.numeros_titulos || '—', 'esquerda', v.vence ? `vence ${dataBR(v.vence)}` : ''),
        celula(dinheiro(v.pendente), n(v.pendente) > 0.009 ? 'negativo' : ''),
        celulaRecebido(v, recebidoQuando, estorno),
        substituta,
        celula(v.acao, 'esquerda canceladas-acao'),
      );
      return tr;
    }));
    if (!vendas.length) {
      const tr = criar('tr');
      const td = criar('td', 'vazio', 'Nenhuma nota de venda cancelada com financeiro, com esses filtros, no período. ✓');
      td.colSpan = 9;
      tr.append(td);
      corpoB.append(tr);
    }
  }

  // ---------- Aba Devolução: todas as notas de devolução, com o título que geraram ----------
  async function carregarDevolucoes() {
    if (devolCarregando) return devolCarregando;
    const url = new URL('/faturamento/devolucoes', location.origin);
    url.searchParams.set('inicio', el('inicio').value);
    url.searchParams.set('fim', el('fim').value);
    if (typeof modulos !== 'undefined') modulos.marcarLoja(url);
    el('titulo-devolucoes').textContent = 'Notas de devolução (carregando…)';
    devolCarregando = (async () => {
      try {
        const r = await fetch(url, { headers: { 'x-api-key': sessionStorage.getItem('apiKey') || '' } });
        const corpo = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(corpo.erro || 'Não foi possível carregar as devoluções.');
        devol = corpo;
        el('painel').hidden = false;
        montarOpcoes();
        if (abaAtual === 'devolucoes') desenhar();
      } catch (err) {
        status(err.message, true);
        el('titulo-devolucoes').textContent = 'Notas de devolução';
      } finally {
        devolCarregando = null;
      }
    })();
    return devolCarregando;
  }

  const SELO_DEVOLUCAO = { com_titulo: 'Gerou título', sem_titulo: 'Não gerou título', cancelada: 'Cancelada' };

  function desenharDevolucoes() {
    const corpo = el('tabela-devolucoes').tBodies[0];
    if (!devol) {
      el('resumo-devolucoes').textContent = '—';
      el('resumo-devolucoes-explica').textContent = '';
      corpo.replaceChildren();
      return;
    }
    const termo = el('pesquisa-termo').value.trim().toLowerCase();
    const r = devol.resumo;
    el('resumo-devolucoes').textContent = r.notas ? dinheiro(r.valor) : 'Nenhuma';
    el('resumo-devolucoes-explica').textContent = [
      plural(r.notas, 'nota de devolução', 'notas de devolução'),
      `${plural(r.com_titulo, 'gerou', 'geraram')} título (${dinheiro(r.valor_abatido)} abatidos)`,
      `${plural(r.sem_titulo, 'não gerou', 'não geraram')} título (${dinheiro(r.valor_sem_titulo)})`,
      r.canceladas ? `${plural(r.canceladas, 'cancelada', 'canceladas')}${r.canceladas_abatendo ? `, ${plural(r.canceladas_abatendo, 'ainda abatendo', 'ainda abatendo')} título` : ''}` : null,
    ].filter(Boolean).join(' · ');

    const lista = devol.lista
      .filter((d) => passaFiltros(d, d.valor_devolucao))
      .filter((d) => bate(termo, d.nota_devolucao, d.id, d.nota_origem, d.nota_origem_registro, d.pedido, d.cliente, d.cod_cliente, d.numeros_titulos));
    el('titulo-devolucoes').textContent = `Notas de devolução (${lista.length})`;

    corpo.replaceChildren(...lista.map((d) => {
      const tr = criar('tr', d.abatendo ? 'linha-vencida' : d.situacao === 'cancelada' ? 'canceladas-ok' : '');
      const origem = criar('td', 'esquerda');
      origem.append(`nota ${d.nota_origem ?? '—'}`);
      origem.append(criar('span', 'qtd', [d.nota_origem_registro ? `registro ${d.nota_origem_registro}` : '',
        d.nota_origem_dia ? `de ${dataBR(d.nota_origem_dia)}` : '', d.pedido ? `pedido ${d.pedido}` : ''].filter(Boolean).join(' · ')));

      // Título financeiro: cada título numa linha, com o vencimento e quanto está em aberto hoje
      const titulo = criar('td', 'esquerda');
      if (d.titulos.length) {
        for (const t of d.titulos) {
          const linha = criar('span', 'canceladas-baixa__linha');
          linha.append(criar('strong', null, `título ${t.titulo}`));
          linha.append(` · ${t.como === 'proprio' ? 'título da devolução' : 'abatido'}${t.vencimento ? ` · vence ${dataBR(t.vencimento)}` : ''}`);
          titulo.append(linha);
          titulo.append(criar('span', 'qtd', n(t.pendente) > 0.009 ? `${dinheiro(t.pendente)} em aberto hoje` : 'título quitado'));
        }
      } else {
        titulo.append(criar('span', d.situacao === 'sem_titulo' ? 'negativo' : '', 'Não gerou título'));
      }

      const selo = criar('span', `tipo-cancelamento tipo-cancelamento--${d.situacao === 'cancelada' ? 'devolucao' : 'nota'}`, SELO_DEVOLUCAO[d.situacao]);
      const situacao = criar('td', 'esquerda canceladas-acao');
      situacao.append(selo, criar('span', `qtd${d.abatendo ? ' negativo' : ''}`, d.acao));

      tr.append(
        celula(`${d.nota_devolucao}`, 'esquerda', `registro ${d.id}${d.usuario ? ` · por ${d.usuario}` : ''}`),
        celula(dataBR(d.devolucao_dia), 'esquerda', d.cancelado_em
          ? `cancelada em ${dataHoraBR(d.cancelado_em)}${d.com_protocolo ? '' : ' (sem protocolo SEFAZ)'}` : ''),
        origem,
        celula(d.cliente || `cliente ${d.cod_cliente ?? '—'}`, 'esquerda', d.vendedor ? `vendedor ${d.vendedor}` : ''),
        celula(dinheiro(d.valor_devolucao)),
        titulo,
        celula(dinheiro(d.efeito), '', n(d.desfeito) > 0.009 ? `abateu ${dinheiro(d.abatido)} · desfeito ${dinheiro(d.desfeito)}` : ''),
        situacao,
      );
      return tr;
    }));
    if (!lista.length) {
      const tr = criar('tr');
      const td = criar('td', 'vazio', 'Nenhuma nota de devolução com esses filtros no período.');
      td.colSpan = 8;
      tr.append(td);
      corpo.append(tr);
    }
  }

  // ---------- Aba Notas: as canceladas que NÃO geram financeiro ----------
  // Vêm da lista completa (todosCancelamentos): notas fiscais sem título em aberto nem recebimento
  // preso, e os cupons do caixa (pagos na hora, não geram título).
  function desenharSemFinanceiro(termo) {
    const r = dados.resumo;
    const corpo = el('tabela-sem-financeiro').tBodies[0];
    if (!todos) {
      el('titulo-sem-financeiro').textContent = 'Notas e cupons cancelados sem financeiro (carregando…)';
      corpo.replaceChildren();
      el('resumo-notas-total').textContent = `${plural(r.vendas_com_financeiro, 'nota gera', 'notas geram')} financeiro · carregando as que não geram…`;
      return;
    }
    // Nota: toda cancelada que NÃO está no bloco de cima (assim cada nota aparece em um bloco só).
    // Cupom: todos (pagos no caixa, não geram título).
    const comFinanceiro = new Set(dados.vendas.map((v) => String(v.id)));
    const semTodas = todos.lista.filter((l) => l.tipo === 'cupom' || (l.tipo === 'nota' && !comFinanceiro.has(String(l.registro))));
    const notasSem = semTodas.filter((l) => l.tipo === 'nota').length;
    const cuponsSem = semTodas.length - notasSem;
    const totalCanceladas = r.vendas_com_financeiro + semTodas.length;
    el('resumo-notas-total').textContent = `${plural(totalCanceladas, 'cancelada', 'canceladas')} no período: `
      + `${plural(r.vendas_com_financeiro, 'gera', 'geram')} financeiro · `
      + `${plural(semTodas.length, 'não gera', 'não geram')} (${plural(notasSem, 'nota fiscal', 'notas fiscais')} e ${plural(cuponsSem, 'cupom', 'cupons')})`;

    const lista = semTodas
      .map((l) => ({ ...l, sem_financeiro: true }))
      .filter((l) => passaFiltros(l, l.valor))
      .filter((l) => bate(termo, l.numero, l.registro, l.pedido, l.caixa, l.cliente, l.cod_cliente));
    el('titulo-sem-financeiro').textContent = `Notas e cupons cancelados sem financeiro (${lista.length})`;
    corpo.replaceChildren(...lista.map((l) => {
      const tr = criar('tr', 'canceladas-ok');
      const detalhe = [];
      if (l.tipo === 'cupom' && l.caixa) detalhe.push(`caixa ${l.caixa}`);
      if (l.tipo === 'nota' && l.registro) detalhe.push(`registro ${l.registro}`);
      if (l.pedido) detalhe.push(`pedido ${l.pedido}`);
      if (l.documento_dia) detalhe.push(`emitido em ${dataBR(l.documento_dia)}`);
      const quando = [];
      if (l.usuario) quando.push(`por ${l.usuario}`);
      if (l.tipo === 'nota') quando.push(l.com_protocolo ? 'com protocolo SEFAZ' : 'sem protocolo SEFAZ');
      tr.append(
        celula(criar('span', `tipo-cancelamento tipo-cancelamento--${l.tipo}`, TIPOS[l.tipo]), 'esquerda'),
        celula(l.numero ?? '—', 'esquerda', detalhe.join(' · ')),
        celula(l.tipo === 'cupom' ? dataBR(l.cancelado_em) : dataHoraBR(l.cancelado_em), 'esquerda', quando.join(' · ')),
        celula(l.cliente || (l.cod_cliente ? `cliente ${l.cod_cliente}` : '—'), 'esquerda', l.vendedor ? `vendedor ${l.vendedor}` : ''),
        celula(l.valor == null ? '—' : dinheiro(l.valor)),
        celula(l.observacao || (l.tipo === 'cupom' ? 'Pago no caixa: não gera título' : 'Título zerado: nada a fazer ✓'), 'esquerda canceladas-acao'),
      );
      return tr;
    }));
    if (!lista.length) {
      const tr = criar('tr');
      const td = criar('td', 'vazio', 'Nenhuma nota ou cupom cancelado sem financeiro com esses filtros, no período.');
      td.colSpan = 6;
      tr.append(td);
      corpo.append(tr);
    }
  }

  // ---------- Aba "Todos os cancelamentos" ----------
  const TIPOS = { nota: 'Nota fiscal', devolucao: 'Devolução', cupom: 'Cupom do caixa', pedido: 'Pedido' };
  const PLURAIS = { nota: ['nota fiscal', 'notas fiscais'], devolucao: ['devolução', 'devoluções'],
    cupom: ['cupom', 'cupons'], pedido: ['pedido', 'pedidos'] };

  async function carregarTodos() {
    if (todosCarregando) return todosCarregando;
    const url = new URL('/faturamento/notas-canceladas/todos', location.origin);
    url.searchParams.set('inicio', el('inicio').value);
    url.searchParams.set('fim', el('fim').value);
    if (typeof modulos !== 'undefined') modulos.marcarLoja(url);
    el('titulo-todos').textContent = 'Todos os cancelamentos (carregando…)';
    todosCarregando = (async () => {
      try {
        const r = await fetch(url, { headers: { 'x-api-key': sessionStorage.getItem('apiKey') || '' } });
        const corpo = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(corpo.erro || 'Não foi possível carregar os cancelamentos.');
        todos = corpo;
        montarOpcoes();
        if (abaAtual === 'todos' || abaAtual === 'notas') desenhar();
      } catch (err) {
        status(err.message, true);
        el('titulo-todos').textContent = 'Todos os cancelamentos';
      } finally {
        todosCarregando = null;
      }
    })();
    return todosCarregando;
  }

  function desenharTodos() {
    if (!todos) return;
    const termo = el('pesquisa-termo').value.trim().toLowerCase();
    const r = todos.resumo;
    const total = Object.values(r).reduce((t, x) => t + x.qtd, 0);
    const mexem = Object.values(r).reduce((t, x) => t + x.mexe_financeiro, 0);
    el('resumo-todos').textContent = total ? plural(total, 'cancelamento', 'cancelamentos') : 'Nenhum';
    el('resumo-todos-explica').textContent = [
      ...Object.keys(TIPOS).filter((t) => r[t]?.qtd).map((t) => `${plural(r[t].qtd, ...PLURAIS[t])} (${dinheiro(r[t].valor)})`),
      mexem ? `${plural(mexem, 'ainda mexe', 'ainda mexem')} no financeiro` : 'nenhum mexe no financeiro ✓',
    ].join(' · ');

    // Botões de tipo: clicar filtra a lista (clicar de novo, ou em "Todos", tira o filtro)
    const botoes = [['', `Todos (${total})`], ...Object.keys(TIPOS).map((t) => [t, `${TIPOS[t]} (${r[t]?.qtd ?? 0})`])];
    el('tipos-todos').replaceChildren(...botoes.map(([tipo, texto]) => {
      const b = criar('button', `canceladas-tipo${tipo === tipoTodos ? ' canceladas-tipo--ativo' : ''}`, texto);
      b.type = 'button';
      b.addEventListener('click', () => { tipoTodos = tipo === tipoTodos ? '' : tipo; desenharTodos(); });
      return b;
    }));

    const lista = todos.lista
      .filter((l) => !tipoTodos || l.tipo === tipoTodos)
      .filter((l) => passaFiltros(l, l.valor))
      .filter((l) => bate(termo, l.numero, l.registro, l.pedido, l.caixa, l.cliente, l.cod_cliente));
    el('titulo-todos').textContent = `${tipoTodos ? TIPOS[tipoTodos] : 'Todos os cancelamentos'} (${lista.length})`;
    const corpo = el('tabela-todos').tBodies[0];
    corpo.replaceChildren(...lista.map((l) => {
      const tr = criar('tr', l.mexe_financeiro ? 'linha-vencida' : '');
      const detalhe = [];
      if (l.tipo === 'cupom' && l.caixa) detalhe.push(`caixa ${l.caixa}`);
      if ((l.tipo === 'nota' || l.tipo === 'devolucao') && l.registro) detalhe.push(`registro ${l.registro}`);
      if (l.tipo !== 'pedido' && l.pedido) detalhe.push(`pedido ${l.pedido}`);
      if (l.documento_dia) detalhe.push(`${l.tipo === 'pedido' ? 'feito' : 'emitido'} em ${dataBR(l.documento_dia)}`);
      const quando = [];
      if (l.usuario) quando.push(`por ${l.usuario}`);
      if (l.tipo === 'nota' || l.tipo === 'devolucao') quando.push(l.com_protocolo ? 'com protocolo SEFAZ' : 'sem protocolo SEFAZ');
      tr.append(
        celula(criar('span', `tipo-cancelamento tipo-cancelamento--${l.tipo}`, l.tipo_nome || TIPOS[l.tipo] || l.tipo), 'esquerda'),
        celula(l.numero ?? '—', 'esquerda', detalhe.join(' · ')),
        // Cupom: o banco guarda só o dia do caixa, sem a hora
        celula(l.tipo === 'cupom' ? dataBR(l.cancelado_em) : dataHoraBR(l.cancelado_em), 'esquerda', quando.join(' · ')),
        celula(l.cliente || (l.cod_cliente ? `cliente ${l.cod_cliente}` : '—'), 'esquerda', l.vendedor ? `vendedor ${l.vendedor}` : ''),
        celula(l.valor == null ? '—' : dinheiro(l.valor)),
        celula(l.mexe_financeiro ? 'Mexe no financeiro' : l.tipo === 'cupom' ? 'Sem título (caixa)' : 'OK ✓',
          `esquerda${l.mexe_financeiro ? ' negativo' : ''}`),
        celula(l.observacao || '—', 'esquerda canceladas-acao'),
      );
      return tr;
    }));
    if (!lista.length) {
      const tr = criar('tr');
      const td = criar('td', 'vazio', 'Nenhum cancelamento com esses filtros no período.');
      td.colSpan = 7;
      tr.append(td);
      corpo.append(tr);
    }
    if (todos.lista.length >= todos.limite) {
      status(`Mostrando os ${todos.limite} cancelamentos mais recentes: escolha um período menor ou uma loja para ver todos.`);
    }
  }

  // Recebido: valor, quando e ONDE foi baixado. Baixa em Bancos: o cabeçalho do recebimento com os
  // campos da consulta "Recebimentos de Título a Receber (Bancos)" do PROCFIT (Recebimento, Data, Login,
  // Entidade, Conta, Movimento, Data de Recebimento, Modalidade, Descrição)
  function celulaRecebido(v, quando, estorno) {
    const td = celula(dinheiro(v.recebido), n(v.recebido) > 0.009 ? 'negativo' : '', `${quando}${estorno}`);
    for (const b of v.baixas || []) {
      const bloco = criar('span', 'qtd canceladas-baixa');
      if (b.tab === 668401 && b.rb_recebimento) {
        bloco.append(criar('strong', null, `${b.acerto ? 'PIX do acerto de despacho' : 'Bancos por títulos'} · Recebimento ${b.rb_recebimento}`));
        const linhas = [
          `Data ${dataHoraBR(b.lancado_em)}${b.login ? ` · Login ${b.login}` : ''}`,
          b.rb_entidade != null ? `Entidade ${b.rb_entidade}${b.rb_entidade_nome ? ` ${b.rb_entidade_nome}` : ''}` : '',
          `${b.conta_bancaria != null ? `Conta ${b.conta_bancaria} · ` : ''}Movimento ${dataBR(b.rb_movimento)} · Recebimento em ${dataBR(b.rb_data_recebimento)}`,
          `${b.forma ? `${b.forma} · ` : ''}${dinheiro(b.valor)} neste título${b.acerto ? ` · acerto ${b.acerto}` : ''}`,
          b.rb_descricao ? `Descrição: ${b.rb_descricao}` : '',
        ].filter(Boolean);
        for (const l of linhas) bloco.append(criar('span', 'canceladas-baixa__linha', l));
        // Recebimento lançado em nome de outra entidade: na consulta de Bancos ele aparece com esse nome
        if (b.rb_entidade != null && b.titulo_entidade != null && String(b.rb_entidade) !== String(b.titulo_entidade)) {
          bloco.append(criar('span', 'canceladas-baixa__aviso', 'Lançado em nome de outra entidade: na consulta de Bancos, procure pelo nº do Recebimento.'));
        }
      } else if (b.tab === 668401) {
        bloco.append(criar('strong', null, `Bancos por títulos · Recebimento ${b.registro}`));
        bloco.append(criar('span', 'canceladas-baixa__aviso', 'Esse recebimento não existe mais na tela de Bancos: a baixa ficou no título sem o lançamento. Estornar direto no título.'));
      } else {
        const partes = [b.onde];
        if (b.acerto) partes.push(`acerto ${b.acerto}`);
        else if (b.registro) partes.push(`registro ${b.registro}`);
        partes.push(`${dinheiro(b.valor)} em ${dataBR(b.dia)}`);
        if (b.forma) partes.push(b.forma);
        if (b.usuario) partes.push(`por ${b.usuario}`);
        bloco.append(partes.join(' · '));
      }
      td.append(bloco);
    }
    return td;
  }

  // ---------- Abas ----------
  const PESQUISA = {
    devolucoes: 'Encontrar por nota ou registro, nota original, pedido, título ou cliente',
    notas: 'Encontrar por nota ou registro, nº do recebimento, pedido, título ou cliente',
    todos: 'Encontrar por nota, cupom, pedido, caixa ou cliente',
  };
  function abrirAba(aba) {
    if (!PESQUISA[aba]) aba = 'devolucoes';
    for (const b of el('abas').querySelectorAll('[data-aba]')) {
      const ativa = b.dataset.aba === aba;
      b.classList.toggle('aba--ativa', ativa);
      if (ativa) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    el('aba-devolucoes').hidden = aba !== 'devolucoes';
    el('aba-notas').hidden = aba !== 'notas';
    el('aba-todos').hidden = aba !== 'todos';
    abaAtual = aba;
    // A aba Notas também usa a lista completa (bloco das canceladas sem financeiro)
    if ((aba === 'todos' || aba === 'notas') && !todos && dados) carregarTodos();
    if (aba === 'devolucoes' && !devol && dados) carregarDevolucoes();
    // Na Devolução o período é o dia da devolução; nas outras abas, o dia do cancelamento
    el('rotulo-inicio').textContent = aba === 'devolucoes' ? 'Devolvida de' : 'Cancelada de';
    montarSituacao();
    desenhar();
    el('pesquisa-termo').placeholder = PESQUISA[aba];
    if (location.hash !== `#${aba}`) history.replaceState(null, '', `#${aba}`);
  }
  for (const b of el('abas').querySelectorAll('[data-aba]')) b.addEventListener('click', () => abrirAba(b.dataset.aba));
  window.addEventListener('hashchange', () => abrirAba(location.hash.slice(1)));

  // ---------- Eventos ----------
  for (const b of el('atalhos').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      for (const o of el('atalhos').querySelectorAll('button')) o.classList.toggle('atalho--ativo', o === b);
      periodo(Number(b.dataset.dias));
      carregar();
    });
  }
  el('filtros').addEventListener('submit', (ev) => {
    ev.preventDefault();
    for (const o of el('atalhos').querySelectorAll('button')) o.classList.remove('atalho--ativo');
    carregar();
  });
  el('filtro-situacao').addEventListener('change', () => { situacaoEscolhida[abaAtual] = el('filtro-situacao').value; desenhar(); });
  for (const id of ['filtro-vendedor', 'filtro-cliente', 'filtro-valor']) el(id).addEventListener('input', desenhar);
  el('filtros-lista').addEventListener('submit', (ev) => ev.preventDefault());
  el('limpar-filtros').addEventListener('click', () => {
    el('filtro-vendedor').value = '';
    el('filtro-cliente').value = '';
    el('filtro-valor').value = '';
    situacaoEscolhida[abaAtual] = OPCOES_SITUACAO[abaAtual][0][0];
    montarSituacao();
    desenhar();
  });
  el('form-pesquisa').addEventListener('submit', (ev) => ev.preventDefault());
  el('pesquisa-termo').addEventListener('input', desenhar);

  // Menu da esquerda e a loja do menu
  if (typeof modulos !== 'undefined') {
    modulos.setoresDaChave().then((s) => modulos.desenharMenu(s, 'faturamento')).catch(() => {});
    modulos.aoMudarLoja(() => carregar());
  }

  abrirAba(location.hash.slice(1));
  periodo(90);
  carregar();
})();
