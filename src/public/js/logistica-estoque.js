// Logística > Estoque por empresa (nov/2026).
// Uma chamada (/logistica/estoque) traz os produtos com o saldo em cada empresa e na rede;
// a troca entre "Por empresa" e "Rede toda", o filtro de alerta e a paginação são feitos aqui na tela.
(function () {
  const el = (id) => document.getElementById(id);
  const n = (v) => Number(v) || 0;
  const qtd = (v) => (v === null || v === undefined ? '—' : n(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const dias = (v) => (v === null || v === undefined ? '—' : `${n(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`);
  const chave = () => sessionStorage.getItem('apiKey') || '';

  const ALERTAS = {
    negativo:   { titulo: 'Saldo negativo', nota: 'alguma empresa vende mais do que entrou' },
    transferir: { titulo: 'Transferir antes de comprar', nota: 'uma empresa precisa e outra tem sobra' },
    baixo:      { titulo: 'Cobertura baixa', nota: 'a rede tem estoque para poucos dias' },
    parado:     { titulo: 'Parado', nota: 'sobra sem venda ou cobertura muito alta' },
  };

  let dados = null;
  let visao = 'empresa';
  let alerta = null;
  let pagina = 1;
  let porPagina = 20;

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
  const status = (texto, erro = false) => {
    el('status').textContent = texto || '';
    el('status').classList.toggle('status--erro', erro);
  };

  async function api(caminho, params = {}) {
    const url = new URL(caminho, location.origin);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    if (typeof modulos !== 'undefined') modulos.marcarLoja(url); // loja do menu
    const r = await fetch(url, { headers: { 'x-api-key': chave() } });
    if (r.status === 401) { sessionStorage.removeItem('apiKey'); location.href = 'financeiro.html'; throw new Error('Chave inválida'); }
    if (r.status === 403) throw new Error('Esta chave não tem acesso à logística.');
    return r;
  }

  // ---------- Carregar ----------
  async function carregar() {
    status('Carregando o estoque…');
    try {
      const r = await api('/logistica/estoque', { busca: el('pesquisa-termo').value.trim() });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.erro || 'Não foi possível carregar o estoque.');
      dados = corpo;
      pagina = 1;
      desenhar();
      el('painel').hidden = false;
      const loja = await modulos.nomeDaLoja?.();
      status(`${loja ? `${loja} · ` : 'Todas as empresas · '}atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (erro) {
      status(erro.message, true);
    }
  }

  function desenhar() {
    const { regras } = dados;
    el('etiqueta-dias').textContent = `saldo hoje · venda dos últimos ${dados.dias} dias`;
    el('regras').textContent = `Cobertura = saldo ÷ venda por dia. Baixa: menos de ${regras.cobertura_baixa} dias; `
      + `parado: mais de ${regras.cobertura_alta} dias ou sem venda. A transferência sugerida deixa quem precisa com `
      + `~${regras.cobertura_alvo} dias de venda e não tira de quem fica com menos de 30 dias. Clique num cartão para filtrar.`;
    desenharCartoes();
    desenharLista();
  }

  function desenharCartoes() {
    const r = dados.resumo;
    const itens = [{ id: null, titulo: 'Todos os produtos', valor: r.produtos, nota: 'com saldo ou venda' },
      ...Object.entries(ALERTAS).map(([id, a]) => ({ id, titulo: a.titulo, valor: r[id], nota: a.nota, alerta: true }))];
    el('cartoes').replaceChildren(...itens.map((c) => {
      const b = criar('button', `cartao${alerta === c.id ? ' cartao--ativo' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(alerta === c.id));
      const v = criar('p', `cartao-valor${c.alerta && c.valor > 0 ? ' negativo' : ''}`, n(c.valor).toLocaleString('pt-BR'));
      b.append(criar('h3', null, c.titulo), v, criar('p', 'cartao-nota', c.nota));
      b.addEventListener('click', () => { alerta = alerta === c.id ? null : c.id; pagina = 1; desenhar(); });
      return b;
    }));
  }

  function produtosVisiveis() {
    return alerta ? dados.produtos.filter((p) => p.alertas.includes(alerta)) : dados.produtos;
  }

  function nomeProduto(p) {
    const div = criar('div');
    div.append(criar('strong', null, p.descricao || `Produto ${p.produto}`));
    const marcas = p.alertas.map((a) => ALERTAS[a]?.titulo).filter(Boolean).join(' · ');
    div.append(criar('span', 'qtd', `${p.produto}${marcas ? ` · ${marcas}` : ''}`));
    return div;
  }

  const transferenciasTexto = (p) => p.transferencias.map((t) => `${qtd(t.quantidade)} de ${t.de_nome} → ${t.para_nome}`).join(' · ');

  function desenharLista() {
    const lista = produtosVisiveis();
    const inicio = (pagina - 1) * porPagina;
    const pagina_ = lista.slice(inicio, inicio + porPagina);
    el('titulo-lista').textContent = `Produtos${alerta ? ` · ${ALERTAS[alerta].titulo.toLowerCase()}` : ''} (${lista.length.toLocaleString('pt-BR')})`;
    paginacao.desenhar(el('paginador'), {
      total: lista.length, pagina, porPagina,
      aoMudar: (p) => { pagina = p.pagina; porPagina = p.porPagina; paginacao.guardar('estoque-empresas', porPagina); desenharLista(); },
    });

    const cab = criar('tr');
    const th = (texto, classe = '') => { const t = criar('th', classe, texto); t.scope = 'col'; return t; };
    if (visao === 'empresa') {
      el('explica-lista').textContent = 'Uma coluna por empresa: saldo de hoje e, embaixo, a venda por dia e a cobertura. '
        + 'Em laranja, saldo negativo. A última coluna é o total da rede.';
      cab.append(th('Produto', 'esquerda'), ...dados.empresas.map((e) => th(e.nome)), th('Rede', 'coluna-saldo'), th('Transferir', 'esquerda'));
    } else {
      el('explica-lista').textContent = 'Uma linha por produto com o total de todas as empresas. "Falta na rede" é o que '
        + 'falta mesmo depois das transferências (comprar ou, se for produção, lançar a entrada).';
      cab.append(th('Produto', 'esquerda'), th('Saldo da rede'), th(`Vendido ${dados.dias} dias`), th('Venda por dia'),
        th('Cobertura'), th('Empresas negativas'), th('Transferir', 'esquerda'), th('Falta na rede'));
    }
    el('tabela').tHead.replaceChildren(cab);

    const linhas = pagina_.map((p) => {
      const tr = criar('tr');
      if (p.alertas.includes('negativo')) tr.className = 'linha-vencida';
      if (visao === 'empresa') {
        tr.append(celula(nomeProduto(p), 'esquerda'));
        for (const e of dados.empresas) {
          const m = p.empresas[String(e.empresa)];
          if (!m) { tr.append(celula('—')); continue; }
          tr.append(celula(qtd(m.saldo), m.saldo < 0 ? 'negativo' : '',
            m.venda_dia > 0 ? `${qtd(m.venda_dia)}/dia · ${dias(m.cobertura)}` : 'sem venda'));
        }
        tr.append(
          celula(qtd(p.rede.saldo), `coluna-saldo${p.rede.saldo < 0 ? ' negativo' : ''}`,
            p.rede.venda_dia > 0 ? `${qtd(p.rede.venda_dia)}/dia · ${dias(p.rede.cobertura)}` : 'sem venda'),
          celula(transferenciasTexto(p) || '—', 'esquerda'),
        );
      } else {
        tr.append(
          celula(nomeProduto(p), 'esquerda'),
          celula(qtd(p.rede.saldo), p.rede.saldo < 0 ? 'negativo' : ''),
          celula(qtd(p.rede.vendido)),
          celula(qtd(p.rede.venda_dia)),
          celula(dias(p.rede.cobertura)),
          celula(p.empresas_negativas.length ? String(p.empresas_negativas.length) : '—', p.empresas_negativas.length ? 'negativo' : ''),
          celula(transferenciasTexto(p) || '—', 'esquerda'),
          celula(p.comprar_sugerido > 0 ? qtd(p.comprar_sugerido) : '—', p.comprar_sugerido > 0 ? 'negativo' : ''),
        );
      }
      return tr;
    });
    if (!linhas.length) {
      const tr = criar('tr');
      const td = celula('Nenhum produto com esses filtros.', 'vazio');
      td.colSpan = 20;
      tr.append(td);
      linhas.push(tr);
    }
    el('tabela').tBodies[0].replaceChildren(...linhas);
  }

  async function baixarExcel() {
    const botao = el('baixar-excel');
    botao.disabled = true;
    status('Gerando o Excel…');
    try {
      const r = await api('/logistica/estoque/excel', { busca: el('pesquisa-termo').value.trim(), alerta });
      if (!r.ok) { const c = await r.json().catch(() => ({})); throw new Error(c.erro || 'Não foi possível gerar a planilha.'); }
      const nome = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'estoque-por-empresa.xlsx';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await r.blob());
      link.download = nome;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      status(`Excel baixado: ${nome}`);
    } catch (erro) {
      status(erro.message, true);
    } finally {
      botao.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!chave()) { location.href = 'financeiro.html'; return; }
    try {
      modulos.desenharMenu(await modulos.setoresDaChave(), 'logistica');
      modulos.aoMudarLoja(() => carregar()); // trocar a loja no menu atualiza sem recarregar a página
    } catch (erro) {
      if (erro.chaveInvalida) { sessionStorage.removeItem('apiKey'); location.href = 'financeiro.html'; return; }
    }
    porPagina = paginacao.lembrar('estoque-empresas', 20);
    el('trocar-chave').addEventListener('click', () => { sessionStorage.removeItem('apiKey'); location.href = 'financeiro.html'; });
    el('form-pesquisa').addEventListener('submit', (ev) => {
      ev.preventDefault();
      el('limpar-pesquisa').hidden = !el('pesquisa-termo').value.trim();
      carregar();
    });
    el('limpar-pesquisa').addEventListener('click', () => {
      el('pesquisa-termo').value = '';
      el('limpar-pesquisa').hidden = true;
      carregar();
    });
    el('visoes').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-visao]');
      if (!b) return;
      visao = b.dataset.visao;
      for (const x of el('visoes').querySelectorAll('[data-visao]')) x.classList.toggle('atalho--ativo', x === b);
      if (dados) desenharLista();
    });
    el('baixar-excel').addEventListener('click', baixarExcel);
    carregar();
  });
})();
