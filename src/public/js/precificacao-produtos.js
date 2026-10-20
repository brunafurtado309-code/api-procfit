// Painel da Precificação — aba Produtos: tipo e categoria de cada produto.
// Usa as ferramentas do precificacao.js (el, chamar, celula, seletor, plural, dinheiro...),
// que é carregado antes deste arquivo.
//
// Tipo: revenda, produção própria, insumo de produção ou uso interno. A API sugere pelo cadastro e
// pelo comportamento no PROCFIT; vale até alguém confirmar. Categoria: nome livre (ex.: Descartáveis),
// criado na hora de digitar; a lista de sugestões mostra as que já existem.
// Produto confirmado que mudou depois (descrição, ou passou a vender) ganha um aviso "revisar":
// a classificação NÃO muda sozinha, quem confirma decide.

const produtosTela = (() => {
  const POR_PAGINA = 50;
  let lista = null;
  let diasCarregados = null;
  let cartao = 'pendentes';
  let pagina = 1;
  const marcados = new Set();

  const CARTOES = {
    pendentes: {
      titulo: 'Tipo não confirmado',
      filtro: (p) => !p.tipo,
      nota: (n) => (n ? 'seguem a sugestão até alguém confirmar' : 'todos confirmados'),
      alerta: (n) => n > 0,
    },
    revisar: {
      titulo: 'Para revisar',
      filtro: (p) => Boolean(p.revisar),
      nota: (n) => (n ? 'mudaram depois de confirmados' : 'nada para revisar'),
      alerta: (n) => n > 0,
    },
    sem_categoria: {
      titulo: 'Sem categoria',
      filtro: (p) => !p.categoria && (p.tipo ?? p.sugestao) !== 'uso_interno',
      nota: () => 'fora os de uso interno',
      alerta: () => false,
    },
    confirmados: {
      titulo: 'Tipo confirmado',
      filtro: (p) => Boolean(p.tipo),
      nota: () => 'decididos por alguém',
      alerta: () => false,
    },
  };

  const textoSugestao = (p) => (p.sugestao
    ? `${lista.tipos[p.sugestao]} (sugerido)`
    : 'Sem sugestão');

  // Lista com o cartão, os seletores de tipo e categoria e a pesquisa
  function visiveis() {
    const termo = normalizar(el('pesquisa-termo').value.trim());
    const tipo = el('produtos-tipo').value;
    const categoria = el('produtos-categoria').value;
    return lista.produtos.filter((p) => CARTOES[cartao].filtro(p)
      && (!tipo || (p.tipo ?? p.sugestao) === tipo)
      && (!categoria || (categoria === '__sem' ? !p.categoria : p.categoria === categoria))
      && (!termo || String(p.codigo) === termo || normalizar(p.descricao).includes(termo)
        || normalizar(p.categoria).includes(termo)));
  }

  function mostrarCartoes() {
    el('produtos-situacoes').replaceChildren(...Object.entries(CARTOES).map(([id, c]) => {
      const n = lista.produtos.filter(c.filtro).length;
      const ativo = cartao === id;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
      botao.setAttribute('aria-pressed', String(ativo));
      const titulo = document.createElement('h3');
      titulo.textContent = c.titulo;
      const valor = document.createElement('p');
      valor.className = `cartao-valor${c.alerta(n) ? ' negativo' : ''}`;
      valor.textContent = plural(n, 'produto', 'produtos');
      const nota = document.createElement('p');
      nota.className = 'cartao-nota';
      nota.textContent = c.nota(n);
      botao.append(titulo, valor, nota);
      botao.addEventListener('click', () => {
        cartao = id;
        pagina = 1;
        mostrar();
      });
      return botao;
    }));
  }

  // Opções dos seletores (tipos e categorias), mantendo o que estava escolhido
  function preencherOpcoes() {
    const tipoAtual = el('produtos-tipo').value;
    el('produtos-tipo').replaceChildren(new Option('Todos', ''),
      ...Object.entries(lista.tipos).map(([v, t]) => new Option(t, v)));
    el('produtos-tipo').value = tipoAtual;

    const categoriaAtual = el('produtos-categoria').value;
    el('produtos-categoria').replaceChildren(new Option('Todas', ''), new Option('Sem categoria', '__sem'),
      ...lista.categorias.map((c) => new Option(c, c)));
    el('produtos-categoria').value = lista.categorias.includes(categoriaAtual) || categoriaAtual === '__sem'
      ? categoriaAtual : '';

    el('lista-categorias').replaceChildren(...lista.categorias.map((c) => new Option(c)));

    if (el('produtos-lote-tipo').options.length === 0) {
      el('produtos-lote-tipo').append(new Option('Tipo (manter)', ''),
        ...Object.entries(lista.tipos).map(([v, t]) => new Option(t, v)));
    }
  }

  // Grava tipo e/ou categoria de um ou vários produtos e recarrega a lista
  async function gravar(codigos, campos, mensagem) {
    mostrarStatus('Gravando…');
    await chamar('/precificacao/produtos', {
      method: 'PUT',
      body: JSON.stringify({ produtos: codigos, ...campos }),
    });
    for (const c of codigos) marcados.delete(c);
    await carregar(mensagem);
  }

  function celulaProduto(p) {
    const td = celula(p.descricao ?? `Produto ${p.codigo}`, 'esquerda');
    const info = document.createElement('span');
    info.className = 'qtd';
    const marcas = [p.industrializado && 'industrializado no PROCFIT', p.insumo && 'insumo no PROCFIT'].filter(Boolean);
    info.textContent = ` código ${p.codigo}${p.unidade ? ` · ${p.unidade}` : ''}${marcas.length ? ` · ${marcas.join(' · ')}` : ''}`;
    td.append(info);
    return td;
  }

  function celulaTipo(p) {
    const td = celula(seletor(lista.tipos, p.tipo, textoSugestao(p), !p.tipo,
      (tipo) => gravar([p.codigo], { tipo }, `${p.descricao}: tipo gravado.`)), 'esquerda');
    if (!p.tipo && p.sugestao_motivo) {
      const motivo = document.createElement('span');
      motivo.className = 'qtd';
      motivo.textContent = p.sugestao_motivo;
      td.append(document.createElement('br'), motivo);
    }
    if (p.revisar) {
      const aviso = document.createElement('span');
      aviso.className = 'aviso-revisar';
      aviso.textContent = `Revisar: ${p.revisar}.`;
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'botao-secundario';
      ok.textContent = 'Está certo';
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        try {
          await gravar([p.codigo], { tipo: p.tipo, revisado: true }, `${p.descricao}: revisado.`);
        } catch (erro) {
          mostrarStatus(erro.message, true);
          ok.disabled = false;
        }
      });
      aviso.append(ok);
      td.append(aviso);
    }
    return td;
  }

  // Categoria: digita ou escolhe da lista; grava ao sair do campo (ou Enter)
  function celulaCategoria(p) {
    const input = document.createElement('input');
    input.className = 'campo-categoria';
    input.setAttribute('list', 'lista-categorias');
    input.maxLength = 60;
    input.placeholder = 'Sem categoria';
    input.value = p.categoria ?? '';
    input.setAttribute('aria-label', `Categoria de ${p.descricao}`);
    input.addEventListener('change', async () => {
      const nova = input.value.trim();
      if (nova === (p.categoria ?? '')) return;
      input.classList.add('campo-categoria--salvando');
      input.disabled = true;
      try {
        await gravar([p.codigo], { categoria: nova || null }, `${p.descricao}: categoria gravada.`);
      } catch (erro) {
        mostrarStatus(erro.message, true);
        input.disabled = false;
        input.classList.remove('campo-categoria--salvando');
      }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return celula(input, 'esquerda');
  }

  function mostrarLote(itens) {
    el('produtos-lote').hidden = marcados.size === 0;
    el('produtos-lote-texto').textContent = `${plural(marcados.size, 'produto marcado', 'produtos marcados')}:`;
    const todos = itens.length > 0 && itens.every((p) => marcados.has(p.codigo));
    el('produtos-marcar-todos').checked = todos;
    el('produtos-marcar-todos').indeterminate = !todos && itens.some((p) => marcados.has(p.codigo));
  }

  function mostrarTabela() {
    const itens = visiveis();
    // Quem saiu da lista (filtro, cartão ou pesquisa) deixa de ficar marcado sem ninguém ver
    const codigos = new Set(itens.map((p) => p.codigo));
    for (const c of [...marcados]) if (!codigos.has(c)) marcados.delete(c);

    const paginas = Math.max(1, Math.ceil(itens.length / POR_PAGINA));
    pagina = Math.min(pagina, paginas);
    const primeiro = (pagina - 1) * POR_PAGINA;
    const daPagina = itens.slice(primeiro, primeiro + POR_PAGINA);

    el('produtos-titulo').textContent = `${CARTOES[cartao].titulo} (${inteiro(itens.length)})`;

    const linhas = daPagina.map((p) => {
      const tr = document.createElement('tr');
      if (marcados.has(p.codigo)) tr.className = 'linha-marcada';
      const marcar = document.createElement('input');
      marcar.type = 'checkbox';
      marcar.checked = marcados.has(p.codigo);
      marcar.setAttribute('aria-label', `Marcar ${p.descricao}`);
      marcar.addEventListener('change', () => {
        if (marcar.checked) marcados.add(p.codigo);
        else marcados.delete(p.codigo);
        tr.classList.toggle('linha-marcada', marcar.checked);
        mostrarLote(itens);
      });

      const vendido = celula(p.vendido_valor ? dinheiro(p.vendido_valor) : '–');
      if (p.vendido_qtd) {
        const qtd = document.createElement('span');
        qtd.className = 'qtd';
        qtd.textContent = ` · ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(p.vendido_qtd)}`
          + `${p.unidade ? ` ${p.unidade}` : ''}`;
        vendido.append(qtd);
      }

      tr.append(
        celula(marcar, 'coluna-marcar'),
        celulaProduto(p),
        vendido,
        celula(dataBR(p.ultima_compra)),
        celula(p.varejo ? dinheiro(p.varejo) : '–'),
        celulaTipo(p),
        celulaCategoria(p),
        celula(p.tipo ? `${p.alterado_por ?? '–'} · ${dataBR(String(p.alterado_em).slice(0, 10))}` : '–', 'esquerda'),
      );
      return tr;
    });

    if (!linhas.length) {
      const tr = document.createElement('tr');
      const vazio = celula('Nenhum produto nesta lista.', 'vazio');
      vazio.colSpan = 8;
      tr.append(vazio);
      linhas.push(tr);
    }
    el('tabela-produtos').tBodies[0].replaceChildren(...linhas);

    el('produtos-paginacao').hidden = paginas <= 1;
    el('produtos-pagina').textContent = itens.length
      ? `Produtos ${inteiro(primeiro + 1)} a ${inteiro(Math.min(primeiro + POR_PAGINA, itens.length))}`
        + ` de ${inteiro(itens.length)} · página ${pagina} de ${paginas}`
      : '';
    el('produtos-anterior').disabled = pagina <= 1;
    el('produtos-proxima').disabled = pagina >= paginas;
    mostrarLote(itens);
  }

  function mostrar() {
    if (!lista) return;
    mostrarCartoes();
    mostrarTabela();
  }

  async function carregar(mensagem) {
    mostrarStatus('Lendo os produtos no PROCFIT…');
    try {
      lista = await chamar(`/precificacao/produtos?dias=${dias}`);
      diasCarregados = dias;
      preencherOpcoes();
      mostrar();
      el('bloco-produtos').hidden = false;
      const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      mostrarStatus(`${mensagem ? `${mensagem} · ` : ''}vendas dos últimos ${dias} dias · atualizado às ${hora}`);
    } catch (erro) {
      mostrarStatus(erro.message, true);
    }
  }

  async function aplicarLote() {
    const tipo = el('produtos-lote-tipo').value;
    const categoria = el('produtos-lote-categoria').value.trim();
    if (!marcados.size || (!tipo && !categoria)) {
      mostrarStatus('Escolha o tipo e/ou digite a categoria para aplicar.', true);
      return;
    }
    const total = marcados.size;
    const partes = [tipo && `tipo "${lista.tipos[tipo]}"`, categoria && `categoria "${categoria}"`].filter(Boolean);
    if (!window.confirm(`Aplicar ${partes.join(' e ')} a ${plural(total, 'produto', 'produtos')}?`)) return;
    el('produtos-lote-aplicar').disabled = true;
    try {
      await gravar([...marcados], { ...(tipo ? { tipo } : {}), ...(categoria ? { categoria } : {}) },
        `${plural(total, 'produto atualizado', 'produtos atualizados')}.`);
      el('produtos-lote-tipo').value = '';
      el('produtos-lote-categoria').value = '';
    } catch (erro) {
      mostrarStatus(erro.message, true);
    } finally {
      el('produtos-lote-aplicar').disabled = false;
    }
  }

  // Liga os controles da aba (uma vez, quando a tela abre)
  function ligar() {
    for (const id of ['produtos-tipo', 'produtos-categoria']) {
      el(id).addEventListener('change', () => { pagina = 1; mostrar(); });
    }
    el('produtos-marcar-todos').addEventListener('change', () => {
      for (const p of visiveis()) {
        if (el('produtos-marcar-todos').checked) marcados.add(p.codigo);
        else marcados.delete(p.codigo);
      }
      mostrarTabela();
    });
    el('produtos-lote-aplicar').addEventListener('click', aplicarLote);
    el('produtos-lote-limpar').addEventListener('click', () => { marcados.clear(); mostrarTabela(); });
    const irPara = (nova) => {
      pagina = nova;
      mostrarTabela();
      el('produtos-titulo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    el('produtos-anterior').addEventListener('click', () => irPara(pagina - 1));
    el('produtos-proxima').addEventListener('click', () => irPara(pagina + 1));
  }

  // Precisa ler de novo quando nunca leu ou quando o período mudou desde a última leitura
  const desatualizado = () => !lista || diasCarregados !== dias;

  return { carregar, mostrar, ligar, desatualizado, pesquisou: () => { pagina = 1; mostrar(); } };
})();
