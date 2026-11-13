// Logística > Transferências: o que foi de uma loja para outra, as notas geradas e o recebimento.
// De onde vem cada número: src/repositories/transferencias.repository.js
(function () {
  const el = (id) => document.getElementById(id);
  const n = (v) => Number(v) || 0;
  const numero = (v) => n(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const moeda = (v) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const dataHoraBR = (t) => (t ? `${dataBR(t)} ${String(t).slice(11, 16)}` : '—');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const chave = () => sessionStorage.getItem('apiKey') || '';
  const SITUACAO = {
    recebida: ['Recebida', 'transf-sit--ok'],
    em_transito: ['Em trânsito', 'transf-sit--transito'],
    sem_nota: ['Sem nota', 'transf-sit--sem'],
    cancelada: ['Cancelada', 'transf-sit--cancelada'],
  };
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
  const rota = (o, on, d, dn) => `${on || `Empresa ${o}`} → ${dn || `Empresa ${d}`}`;

  async function api(url) {
    const r = await fetch(url, { headers: { 'x-api-key': chave() } });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || 'Não foi possível carregar.');
    return corpo;
  }

  // ---------- Período ----------
  function periodo(dias) {
    const fim = new Date();
    const inicio = new Date();
    if (dias === 'mes') inicio.setDate(1);
    else inicio.setDate(inicio.getDate() - Math.max(0, Number(dias) - 1));
    el('inicio').value = iso(inicio);
    el('fim').value = iso(fim);
  }

  // ---------- Carregar ----------
  async function carregar() {
    status('Carregando…');
    const url = new URL('/logistica/transferencias', location.origin);
    url.searchParams.set('inicio', el('inicio').value);
    url.searchParams.set('fim', el('fim').value);
    if (el('filtro-origem').value) url.searchParams.set('origem', el('filtro-origem').value);
    if (el('filtro-destino').value) url.searchParams.set('destino', el('filtro-destino').value);
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
    el('resumo-total').textContent = r.transferencias.toLocaleString('pt-BR');
    el('resumo-situacoes').textContent = `${r.recebidas} recebidas · ${r.em_transito} em trânsito · ${r.sem_nota} sem nota · ${r.canceladas} canceladas`;
    el('resumo-quantidade').textContent = numero(r.quantidade);
    el('resumo-notas').textContent = `${r.notas.toLocaleString('pt-BR')} ${r.notas === 1 ? 'nota gerada' : 'notas geradas'} · sem as canceladas`;

    // Rotas
    el('tabela-rotas').tBodies[0].replaceChildren(...dados.rotas.map((x) => {
      const tr = criar('tr', 'transf-rota');
      tr.title = 'Ver só esta rota';
      tr.append(
        celula(rota(x.origem, x.origem_nome, x.destino, x.destino_nome), 'esquerda'),
        celula(n(x.transferencias).toLocaleString('pt-BR')),
        celula(n(x.itens).toLocaleString('pt-BR')),
        celula(numero(x.quantidade)),
      );
      tr.addEventListener('click', () => {
        el('filtro-origem').value = String(x.origem);
        el('filtro-destino').value = String(x.destino);
        carregar();
      });
      return tr;
    }));
    if (!dados.rotas.length) vazio('tabela-rotas', 4, 'Nenhuma transferência no período.');

    // Lista
    const sit = el('filtro-situacao').value;
    const lista = dados.transferencias.filter((t) => !sit || t.situacao === sit);
    el('titulo-lista').textContent = `Transferências (${lista.length})`;
    el('tabela-transferencias').tBodies[0].replaceChildren(...lista.map((t) => {
      const tr = criar('tr', t.situacao === 'cancelada' ? 'transf-cancelada' : '');
      const abrir = criar('button', 'link-tabela', `Nº ${t.id}`);
      abrir.type = 'button';
      abrir.addEventListener('click', () => abrirFicha(t));
      const [rotulo, classe] = SITUACAO[t.situacao] || [t.situacao, ''];
      const situacao = criar('span', `transf-sit ${classe}`, rotulo);
      let sitDetalhe = '';
      if (t.situacao === 'recebida') sitDetalhe = `em ${dataHoraBR(t.recebida_em)}${t.recebida_por ? ` por ${t.recebida_por}` : ''}`;
      else if (t.exige_aprovacao === 'S' && t.situacao === 'sem_nota') sitDetalhe = 'exige aprovação';
      const nota = t.notas
        ? celula(`nota ${t.notas}`, 'esquerda', `registro ${t.registros}${n(t.notas_canceladas) ? ` · ${t.notas_canceladas} cancelada(s)` : ''}${n(t.valor_notas) ? ` · ${moeda(t.valor_notas)}` : ''}`)
        : celula('—', 'esquerda', 'nenhuma nota');
      tr.append(
        celula(abrir, 'esquerda', `${dataHoraBR(t.feita_em)}${t.feita_por ? ` · ${t.feita_por}` : ''}`),
        celula(rota(t.origem, t.origem_nome, t.destino, t.destino_nome), 'esquerda', `centro ${t.centro_origem} → ${t.centro_destino}`),
        celula(t.motivo || '—', 'esquerda', t.observacao || ''),
        celula(n(t.itens).toLocaleString('pt-BR')),
        celula(numero(t.quantidade)),
        nota,
        celula(situacao, 'esquerda', sitDetalhe),
      );
      return tr;
    }));
    if (!lista.length) vazio('tabela-transferencias', 7, 'Nenhuma transferência com esses filtros.');

    // Produtos
    const nomes = new Map();
    for (const t of dados.transferencias) { nomes.set(t.origem, t.origem_nome); nomes.set(t.destino, t.destino_nome); }
    el('tabela-produtos').tBodies[0].replaceChildren(...dados.produtos.map((p) => {
      const tr = criar('tr');
      tr.append(
        celula(p.descricao || `Produto ${p.produto}`, 'esquerda', `código ${p.produto}`),
        celula(rota(p.origem, nomes.get(p.origem), p.destino, nomes.get(p.destino)), 'esquerda'),
        celula(`${numero(p.quantidade)}${p.unidade ? ` ${p.unidade}` : ''}`),
        celula(n(p.transferencias).toLocaleString('pt-BR')),
      );
      return tr;
    }));
    if (!dados.produtos.length) vazio('tabela-produtos', 4, 'Nenhum produto transferido no período.');
  }

  function vazio(tabela, colunas, texto) {
    const tr = criar('tr');
    const td = criar('td', 'vazio', texto);
    td.colSpan = colunas;
    tr.append(td);
    el(tabela).tBodies[0].append(tr);
  }

  // ---------- Ficha de uma transferência ----------
  async function abrirFicha(t) {
    const ficha = el('ficha');
    el('ficha-titulo').textContent = `Transferência nº ${t.id}`;
    el('ficha-resumo').textContent = `${rota(t.origem, t.origem_nome, t.destino, t.destino_nome)} · ${dataHoraBR(t.feita_em)}`
      + `${t.feita_por ? ` · ${t.feita_por}` : ''} · ${(SITUACAO[t.situacao] || [t.situacao])[0]}`;
    el('ficha-corpo').replaceChildren();
    el('ficha-status').textContent = 'Carregando…';
    if (!ficha.open) ficha.showModal();
    try {
      const d = await api(`/logistica/transferencias/${t.id}`);
      el('ficha-status').textContent = '';
      const corpo = el('ficha-corpo');

      // Produtos: enviado x recebido
      const tabela = criar('table', 'tabela');
      const cab = criar('thead');
      cab.innerHTML = '<tr><th class="esquerda">Produto</th><th>Enviado</th><th>Recebido</th><th>Conferido</th><th>Diferença</th></tr>';
      const linhas = criar('tbody');
      for (const p of d.produtos) {
        const tr = criar('tr', p.diferenca ? 'linha-vencida' : '');
        const un = (u) => (u ? ` ${u}` : '');
        tr.append(
          celula(p.descricao || `Produto ${p.produto}`, 'esquerda', `código ${p.produto}${n(p.fator) > 1 ? ` · embalagem com ${numero(p.fator)}` : ''}`),
          celula(`${numero(p.enviada)}${un(p.unidade)}`),
          celula(p.recebida == null ? '—' : `${numero(p.recebida)}${un(p.unidade_recebida)}`),
          celula(p.confirmada == null ? '—' : numero(p.confirmada)),
          celula(p.diferenca == null ? (p.recebida == null ? 'a receber' : 'unidades diferentes') : p.diferenca === 0 ? 'ok' : numero(p.diferenca),
            p.diferenca ? 'negativo' : ''),
        );
        linhas.append(tr);
      }
      tabela.append(cab, linhas);
      const rolagem = criar('div', 'tabela-rolagem');
      rolagem.append(tabela);
      corpo.append(criar('h3', 'subtitulo', `Produtos (${d.produtos.length})`), rolagem);

      // Notas e recebimentos
      corpo.append(criar('h3', 'subtitulo', 'Nota gerada'));
      if (!d.notas.length) corpo.append(criar('p', 'explica', 'Esta transferência ainda não gerou nota.'));
      for (const nf of d.notas) {
        corpo.append(criar('p', `transf-linha${nf.cancelada ? ' negativo' : ''}`,
          `Nota ${nf.nota} · registro ${nf.registro} · emitida em ${dataBR(nf.dia)} · ${moeda(nf.valor)}${nf.cancelada ? ` · CANCELADA em ${dataHoraBR(nf.cancelada_em)}` : ''}`));
      }
      corpo.append(criar('h3', 'subtitulo', 'Recebimento no destino'));
      if (!d.recebimentos.length) corpo.append(criar('p', 'explica', 'Ainda não foi recebida na loja de destino.'));
      for (const rc of d.recebimentos) {
        corpo.append(criar('p', 'transf-linha',
          `Recebimento ${rc.recebimento} · ${dataHoraBR(rc.recebido_em)}${rc.recebido_por ? ` · por ${rc.recebido_por}` : ''}${rc.nota ? ` · nota ${rc.nota}` : ''}`));
      }
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
  el('filtro-situacao').addEventListener('change', desenhar);
  el('ficha-fechar').addEventListener('click', () => el('ficha').close());
  el('trocar-chave').addEventListener('click', () => { sessionStorage.removeItem('apiKey'); location.reload(); });

  (async function iniciar() {
    if (typeof modulos !== 'undefined') {
      modulos.setoresDaChave().then((s) => modulos.desenharMenu(s, 'logistica')).catch(() => {});
    }
    periodo(30);
    try {
      const empresas = await api('/logistica/empresas');
      for (const e of empresas.empresas || empresas) {
        const nome = e.nome || `Empresa ${e.empresa}`;
        el('filtro-origem').append(new Option(nome, e.empresa));
        el('filtro-destino').append(new Option(nome, e.empresa));
      }
    } catch (_) { /* segue sem os nomes */ }
    carregar();
  })();
})();
