// Faturamento > Notas canceladas / financeiro: notas canceladas que ainda mexem no financeiro.
// A regra (de onde vem cada número) está em src/repositories/notas-canceladas.repository.js.
// Duas abas (devolução e nota de venda são coisas diferentes): #devolucoes e #notas, também no menu.

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
  let soFinanceiro = true;

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
      desenhar();
      status('');
      el('painel').hidden = false;
    } catch (err) {
      status(err.message, true);
    }
  }

  const bate = (termo, ...campos) => !termo || campos.some((c) => String(c ?? '').toLowerCase().includes(termo));

  function desenhar() {
    if (!dados) return;
    const termo = el('pesquisa-termo').value.trim().toLowerCase();
    const r = dados.resumo;

    el('resumo-devolucoes').textContent = r.devolucoes_gerando ? dinheiro(r.valor_devolucoes_gerando) : 'Nenhuma';
    el('resumo-devolucoes-explica').textContent = `${plural(r.devolucoes_gerando, 'devolução cancelada ainda abate', 'devoluções canceladas ainda abatem')} título · ${plural(r.devolucoes_canceladas, 'devolução cancelada', 'devoluções canceladas')} no período`;
    el('resumo-vendas').textContent = r.vendas_com_financeiro ? dinheiro(r.valor_vendas_pendente + r.valor_vendas_recebido) : 'Nenhuma';
    el('resumo-vendas-explica').textContent = `${plural(r.vendas_com_financeiro, 'nota', 'notas')} · ${dinheiro(r.valor_vendas_pendente)} em aberto e ${dinheiro(r.valor_vendas_recebido)} recebidos · ${plural(r.vendas_canceladas, 'nota de venda cancelada', 'notas de venda canceladas')} no período`;

    // A. Devoluções canceladas
    const devolucoes = dados.devolucoes
      .filter((d) => !soFinanceiro || d.gerando_financeiro)
      .filter((d) => bate(termo, d.nota_devolucao, d.nota_origem, d.pedido, d.cliente, d.cod_cliente, d.numeros_titulos));
    el('titulo-devolucoes').textContent = `Notas de devolução canceladas (${devolucoes.length})`;
    const corpoA = el('tabela-devolucoes').tBodies[0];
    corpoA.replaceChildren(...devolucoes.map((d) => {
      const tr = criar('tr', d.gerando_financeiro ? 'linha-vencida' : 'canceladas-ok');
      const origem = criar('span');
      origem.append(`nota ${d.nota_origem ?? '—'}`);
      const notaOrigem = criar('td', 'esquerda');
      notaOrigem.append(origem);
      if (d.pedido) notaOrigem.append(criar('span', 'qtd', `pedido ${d.pedido}`));
      let acao;
      if (d.gerando_financeiro) {
        acao = `Desfazer o abatimento de ${dinheiro(d.gerando)} no título.`;
        if (n(d.estornado_depois) > 0.009) acao += ` Teve estorno de ${dinheiro(d.estornado_depois)} depois: confira se já foi a correção.`;
      } else {
        acao = n(d.abatido) > 0.009 ? 'O abatimento já foi desfeito. ✓' : 'Não chegou a abater título. ✓';
      }
      tr.append(
        celula(`${d.nota_devolucao}`, 'esquerda', `devolvida em ${dataBR(d.devolucao_dia)}`),
        celula(dataHoraBR(d.cancelado_em), 'esquerda', d.com_protocolo ? 'com protocolo SEFAZ' : 'sem protocolo SEFAZ'),
        notaOrigem,
        celula(d.cliente || `cliente ${d.cod_cliente ?? '—'}`, 'esquerda', d.vendedor ? `vendedor ${d.vendedor}` : ''),
        celula(dinheiro(d.valor_devolucao)),
        celula(dinheiro(d.abatido), '', n(d.desfeito) > 0.009 ? `desfeito ${dinheiro(d.desfeito)}` : ''),
        celula(dinheiro(d.gerando), d.gerando_financeiro ? 'negativo' : ''),
        celula(d.numeros_titulos || '—', 'esquerda', n(d.titulos) ? `${dinheiro(d.titulos_pendente)} em aberto hoje` : ''),
        celula(acao, 'esquerda canceladas-acao'),
      );
      return tr;
    }));
    if (!devolucoes.length) {
      const tr = criar('tr');
      const td = criar('td', 'vazio', soFinanceiro ? 'Nenhuma devolução cancelada gerando financeiro no período. ✓' : 'Nenhuma devolução cancelada no período.');
      td.colSpan = 9;
      tr.append(td);
      corpoA.append(tr);
    }

    // B. Notas de venda canceladas com financeiro
    const vendas = dados.vendas.filter((v) => bate(termo, v.nota, v.pedido, v.cliente, v.cod_cliente, v.numeros_titulos));
    el('titulo-vendas').textContent = `Notas de venda canceladas com financeiro (${vendas.length})`;
    const corpoB = el('tabela-vendas').tBodies[0];
    corpoB.replaceChildren(...vendas.map((v) => {
      const tr = criar('tr', 'linha-vencida');
      const nota = criar('td', 'esquerda');
      nota.append(`${v.nota}`);
      nota.append(criar('span', 'qtd', `emitida em ${dataBR(v.nota_dia)}${v.pedido ? ` · pedido ${v.pedido}` : ''}`));
      const partes = [];
      if (n(v.pendente) > 0.009) partes.push(`Cancelar ${n(v.titulos) === 1 ? 'o título' : 'os títulos'} em aberto.`);
      if (n(v.recebido) > 0.009) partes.push(`Cliente pagou ${dinheiro(v.recebido)}: devolver ou deixar como crédito.`);
      tr.append(
        nota,
        celula(dataHoraBR(v.cancelado_em), 'esquerda', v.com_protocolo ? 'com protocolo SEFAZ' : 'sem protocolo SEFAZ'),
        celula(v.cliente || `cliente ${v.cod_cliente ?? '—'}`, 'esquerda', v.vendedor ? `vendedor ${v.vendedor}` : ''),
        celula(dinheiro(v.valor_nota)),
        celula(v.numeros_titulos || '—', 'esquerda', v.vence ? `vence ${dataBR(v.vence)}` : ''),
        celula(dinheiro(v.pendente), n(v.pendente) > 0.009 ? 'negativo' : ''),
        celula(dinheiro(v.recebido), n(v.recebido) > 0.009 ? 'negativo' : ''),
        celula(partes.join(' '), 'esquerda canceladas-acao'),
      );
      return tr;
    }));
    if (!vendas.length) {
      const tr = criar('tr');
      const td = criar('td', 'vazio', 'Nenhuma nota de venda cancelada com título em aberto ou recebido no período. ✓');
      td.colSpan = 8;
      tr.append(td);
      corpoB.append(tr);
    }
  }

  // ---------- Abas ----------
  const PESQUISA = {
    devolucoes: 'Encontrar por nota de devolução, nota original, pedido, título ou cliente',
    notas: 'Encontrar por nota, pedido, título ou cliente',
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
    el('so-financeiro').hidden = aba !== 'devolucoes'; // só faz sentido nas devoluções
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
  el('so-financeiro').addEventListener('click', () => {
    soFinanceiro = !soFinanceiro;
    el('so-financeiro').classList.toggle('atalho--ativo', soFinanceiro);
    el('so-financeiro').setAttribute('aria-pressed', String(soFinanceiro));
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
