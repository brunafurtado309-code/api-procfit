// Logística > Notas de entrada: todas as notas que chegaram para as lojas e as que já tiveram entrada.
// De onde vem cada número: src/repositories/notas-entrada.repository.js
(function () {
  const el = (id) => document.getElementById(id);
  const n = (v) => Number(v) || 0;
  const numero = (v) => n(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const moeda = (v) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  // O PROCFIT grava a data de entrada sem a hora (vem 00:00): aí mostra só o dia
  const dataHoraBR = (t) => {
    if (!t) return '—';
    const hora = String(t).slice(11, 16);
    return hora && hora !== '00:00' ? `${dataBR(t)} ${hora}` : dataBR(t);
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const chave = () => sessionStorage.getItem('apiKey') || '';
  const plural = (q, um, varios) => `${n(q).toLocaleString('pt-BR')} ${n(q) === 1 ? um : varios}`;
  let dados = null;

  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  function celula(valor, classe = '', pequena = '') {
    const td = criar('td', classe);
    if (valor instanceof Node) td.append(valor);
    else td.append(String(valor ?? '—'));
    if (pequena) td.append(criar('span', 'qtd', pequena));
    return td;
  }
  const status = (texto, erro) => { el('status').textContent = texto || ''; el('status').classList.toggle('erro', Boolean(erro)); };
  async function api(url) {
    const r = await fetch(url, { headers: { 'x-api-key': chave() } });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || 'Não foi possível carregar.');
    return corpo;
  }
  function vazio(tabela, colunas, texto) {
    const tr = criar('tr');
    const td = criar('td', 'vazio', texto);
    td.colSpan = colunas;
    tr.append(td);
    el(tabela).tBodies[0].append(tr);
  }

  function periodo(dias) {
    const fim = new Date();
    const inicio = new Date();
    if (dias === 'mes') inicio.setDate(1);
    else inicio.setDate(inicio.getDate() - Math.max(0, Number(dias) - 1));
    el('inicio').value = iso(inicio);
    el('fim').value = iso(fim);
  }

  async function carregar() {
    status('Carregando…');
    const url = new URL('/logistica/notas-entrada', location.origin);
    url.searchParams.set('inicio', el('inicio').value);
    url.searchParams.set('fim', el('fim').value);
    url.searchParams.set('situacao', el('filtro-situacao').value);
    if (el('filtro-empresa').value) url.searchParams.set('empresa', el('filtro-empresa').value);
    const busca = el('pesquisa-termo').value.trim();
    if (busca) url.searchParams.set('busca', busca);
    try {
      dados = await api(url);
      desenhar();
      status(dados.limite ? `Mostrando as ${dados.limite} mais recentes: diminua o período para ver todas.` : '');
      el('painel').hidden = false;
    } catch (err) {
      status(err.message, true);
    }
  }

  function desenhar() {
    if (!dados) return;
    const r = dados.resumo;
    el('resumo-titulo').textContent = { entrada: 'Notas com entrada no período', pendente: 'Notas aguardando entrada', todas: 'Notas no período' }[dados.situacao];
    el('resumo-total').textContent = n(r.notas).toLocaleString('pt-BR');
    el('resumo-tipos').textContent = `${plural(r.compras, 'compra', 'compras')} · ${plural(r.transferencias, 'transferência', 'transferências')} · ${plural(r.fornecedores, 'fornecedor', 'fornecedores')}`
      + `${dados.situacao === 'todas' ? ` · ${r.com_entrada} com entrada e ${r.aguardando} aguardando` : ''}${r.canceladas ? ` · ${r.canceladas} cancelada(s) pelo fornecedor` : ''}`;
    el('resumo-valor').textContent = moeda(r.valor);
    el('resumo-dias').textContent = r.media_dias_ate_entrada != null
      ? `Em média, ${numero(Math.round(r.media_dias_ate_entrada * 10) / 10)} dia(s) entre a emissão e a entrada` : '';

    const tipo = el('filtro-tipo').value;
    const lista = dados.notas.filter((x) => !tipo || (tipo === 'transferencia' ? x.transferencia : !x.transferencia));
    el('titulo-lista').textContent = `Notas (${lista.length})`;
    el('tabela-notas-entrada').tBodies[0].replaceChildren(...lista.map((x) => {
      const tr = criar('tr', x.cancelada ? 'linha-vencida' : '');
      const abrir = criar('button', 'link-tabela', `${x.nota}`);
      abrir.type = 'button';
      abrir.addEventListener('click', () => abrirFicha(x));
      const tipoNota = criar('span', `transf-sit ${x.transferencia ? 'transf-sit--transito' : 'transf-sit--sem'}`, x.transferencia ? 'Transferência' : 'Compra');
      const forn = criar('span');
      forn.append(x.fornecedor || `Fornecedor ${x.cod_fornecedor}`, ' ', tipoNota);
      let situacao;
      let sub;
      if (x.cancelada) { situacao = criar('span', 'transf-sit transf-sit--cancelada', 'Cancelada pelo fornecedor'); sub = ''; }
      else if (x.deu_entrada) { situacao = criar('span', 'transf-sit transf-sit--ok', 'Com entrada'); sub = x.lancada_por ? `lançada por ${x.lancada_por}` : ''; }
      else { situacao = criar('span', 'transf-sit transf-sit--transito', 'Aguardando entrada'); sub = x.dias_parada == null ? '' : n(x.dias_parada) === 0 ? 'chegou hoje' : `parada há ${plural(x.dias_parada, 'dia', 'dias')}`; }
      const entrada = x.deu_entrada
        ? celula(dataHoraBR(x.entrada_em), 'esquerda', `emitida ${dataBR(x.emissao)}${x.dias_ate_entrada != null ? ` · ${plural(x.dias_ate_entrada, 'dia', 'dias')} até a entrada` : ''}`)
        : celula('—', 'esquerda', `emitida ${dataBR(x.emissao)} · chegou ${dataHoraBR(x.chegou_em)}`);
      tr.append(
        celula(abrir, 'esquerda', `registro ${x.id}`),
        celula(forn, 'esquerda', x.natureza || ''),
        celula(x.loja || `Empresa ${x.empresa}`, 'esquerda'),
        entrada,
        celula(x.deu_entrada ? n(x.itens).toLocaleString('pt-BR') : '—'),
        celula(x.deu_entrada ? numero(x.quantidade_estoque) : '—'),
        celula(moeda(x.valor)),
        celula(situacao, 'esquerda', sub),
      );
      return tr;
    }));
    if (!lista.length) vazio('tabela-notas-entrada', 8, 'Nenhuma nota com esses filtros.');

    el('tabela-fornecedores-entrada').tBodies[0].replaceChildren(...dados.fornecedores.map((f) => {
      const tr = criar('tr', 'transf-rota');
      tr.title = 'Ver só as notas deste fornecedor';
      tr.append(
        celula(f.fornecedor || `Fornecedor ${f.cod_fornecedor}`, 'esquerda', f.transferencia ? 'transferência do grupo' : ''),
        celula(n(f.notas).toLocaleString('pt-BR')),
        celula(n(f.com_entrada).toLocaleString('pt-BR')),
        celula(moeda(f.valor)),
      );
      tr.addEventListener('click', () => { el('pesquisa-termo').value = f.fornecedor || ''; carregar(); });
      return tr;
    }));
    if (!dados.fornecedores.length) vazio('tabela-fornecedores-entrada', 4, 'Nenhum fornecedor no período.');
  }

  async function abrirFicha(x) {
    const ficha = el('ficha');
    el('ficha-titulo').textContent = `Nota ${x.nota} · ${x.fornecedor || `Fornecedor ${x.cod_fornecedor}`}`;
    el('ficha-resumo').textContent = `Registro ${x.id} · ${x.loja || `Empresa ${x.empresa}`} · emitida ${dataBR(x.emissao)}`
      + `${x.deu_entrada ? ` · entrada ${dataHoraBR(x.entrada_em)}` : ' · aguardando entrada'} · ${moeda(x.valor)}`;
    el('ficha-corpo').replaceChildren();
    el('ficha-status').textContent = 'Carregando…';
    if (!ficha.open) ficha.showModal();
    try {
      const d = await api(`/logistica/notas-entrada/${x.id}`);
      el('ficha-status').textContent = '';
      if (!d.itens.length) {
        el('ficha-corpo').append(criar('p', 'explica', x.deu_entrada
          ? 'Esta nota não tem produtos lançados.'
          : 'A nota ainda não teve entrada: os produtos só aparecem no PROCFIT depois que a logística finaliza a nota.'));
        return;
      }
      const tabela = criar('table', 'tabela');
      const cab = criar('thead');
      cab.innerHTML = '<tr><th class="esquerda">Produto</th><th>Quantidade</th><th>No estoque</th><th>Valor unitário</th><th>Total</th></tr>';
      const linhas = criar('tbody');
      for (const p of d.itens) {
        const tr = criar('tr');
        tr.append(
          celula(p.descricao || `Produto ${p.produto}`, 'esquerda', `código ${p.produto}${n(p.embalagem) > 1 ? ` · embalagem com ${numero(p.embalagem)}` : ''}`),
          celula(`${numero(p.quantidade)}${p.unidade ? ` ${p.unidade}` : ''}`),
          celula(numero(p.quantidade_estoque)),
          celula(moeda(p.valor_unitario)),
          celula(moeda(p.total)),
        );
        linhas.append(tr);
      }
      const total = d.itens.reduce((t, p) => t + n(p.total), 0);
      const rodape = criar('tfoot');
      const trT = criar('tr');
      trT.append(celula(`${plural(d.itens.length, 'produto', 'produtos')}`, 'esquerda'), celula(''), celula(''), celula(''), celula(moeda(total)));
      rodape.append(trT);
      tabela.append(cab, linhas, rodape);
      const rolagem = criar('div', 'tabela-rolagem');
      rolagem.append(tabela);
      el('ficha-corpo').append(rolagem);
    } catch (err) {
      el('ficha-status').textContent = err.message;
    }
  }

  // ---------- Eventos ----------
  el('atalhos').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-dias]');
    if (!b) return;
    for (const o of el('atalhos').querySelectorAll('button')) o.classList.toggle('atalho--ativo', o === b);
    periodo(b.dataset.dias);
    carregar();
  });
  el('filtros').addEventListener('submit', (ev) => { ev.preventDefault(); carregar(); });
  el('form-pesquisa').addEventListener('submit', (ev) => { ev.preventDefault(); carregar(); });
  el('filtro-situacao').addEventListener('change', carregar);
  el('filtro-tipo').addEventListener('change', desenhar);
  el('ficha-fechar').addEventListener('click', () => el('ficha').close());
  el('trocar-chave').addEventListener('click', () => { sessionStorage.removeItem('apiKey'); location.reload(); });

  (async function iniciar() {
    if (typeof modulos !== 'undefined') {
      modulos.setoresDaChave().then((s) => modulos.desenharMenu(s, 'logistica')).catch(() => {});
    }
    periodo(30);
    try {
      const empresas = await api('/logistica/empresas');
      for (const e of empresas.empresas || empresas) el('filtro-empresa').append(new Option(e.nome || `Empresa ${e.empresa}`, e.empresa));
    } catch (_) { /* segue sem os nomes */ }
    // Loja escolhida no menu da esquerda manda no filtro de loja da tela
    if (typeof modulos !== 'undefined' && modulos.lojaNoFiltro) modulos.lojaNoFiltro(el('filtro-empresa'));
    carregar();
  })();
})();
