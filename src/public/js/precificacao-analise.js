// Painel da Precificação — aba Análise: venda, margem, categorias, giro e as decisões de preço.
// Usa as ferramentas do precificacao.js (el, chamar, celula, plural, dinheiro, dias...),
// que é carregado antes deste arquivo, e os gráficos do graficos.js.
//
// Ordem da aba (do mais importante para o detalhe):
//   1. Venda do período, lucro, margem e dia que mais vende (comparado ao período anterior)
//   2. Decisões para tomar: cada linha abre os produtos e o que fazer com cada um
//   3. Venda no tempo: dia, semana, mês ou ano, e a média por dia da semana
//   4. Categorias: clicar numa categoria filtra a aba inteira
//   5. Mais vendidos e menos vendidos
//   6. Todos os produtos: curva ABC, margem, custo real, preço sugerido, giro, ordenação e pesquisa
// Margem = igual ao PROCFIT: (venda - imposto - custo) ÷ (venda - imposto). Margem real = com o custo real
// (bonificação descontada). Margem desejada: só quem tem "Edita preço" muda (a API diz em pode_editar).
// Clicar no nome de um produto (em qualquer lista da aba) abre a janela dele: venda por dia, semana e mês,
// com o pico e a maior queda marcados e as mudanças de preço que aconteceram perto.
// A API manda tudo de uma vez; trocar de decisão, gráfico, ordem ou página não chama a API de novo.
// Trocar período, categoria ou tipo chama (a API guarda a leitura do PROCFIT por 10 minutos).

const analiseTela = (() => {
  let porPagina = paginacao.lembrar('precificacao-analise', 20); // linhas por página (fica guardado no navegador)
  let dados = null;
  let lidoCom = null;         // filtros da última leitura (para saber se precisa ler de novo)
  let decisaoAtual = null;    // linha aberta em "Decisões para tomar"
  let agrupar = 'dia';        // gráfico: dia, semana, mes, ano
  let curvaAtual = 'todas';   // cartão da lista de produtos
  let pagina = 1;
  let porCodigo = new Map();

  const porcento = (v, casas = 1) => (v == null ? '–'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v * 100)}%`);
  const quantidade = (v, unidade) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v) || 0)}`
    + `${unidade ? ` ${unidade}` : ''}`;
  // Variação com sinal: +12,3% / −8,0%
  const comSinal = (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${porcento(Math.abs(v))}`);
  const span = (texto, classe) => {
    const s = document.createElement('span');
    s.textContent = texto;
    if (classe) s.className = classe;
    return s;
  };
  // Linha pequena embaixo do valor da célula (a classe .qtd já quebra a linha: não precisa de <br>)
  const linhaPequena = (td, texto, classe = 'qtd') => {
    if (!texto) return td;
    td.append(span(texto, classe));
    return td;
  };
  const produto = (codigo) => porCodigo.get(codigo);

  // ---------- 1. Destaque ----------

  function mostrarResumo() {
    const r = dados.resumo;
    el('analise-titulo-venda').textContent = dados.filtros.categoria
      ? `Venda de ${dados.filtros.categoria === '__sem' ? 'produtos sem categoria' : dados.filtros.categoria} nos últimos ${dados.dias} dias`
      : `Venda nos últimos ${dados.dias} dias`;
    el('analise-venda').textContent = dinheiro(r.venda);
    const comparado = r.var_venda == null
      ? 'Sem venda no período anterior para comparar.'
      : `${comSinal(r.var_venda)} em relação aos ${dados.dias} dias anteriores (${dinheiro(r.venda_anterior)}).`;
    el('analise-venda-explica').textContent = comparado;
    el('analise-venda-explica').classList.toggle('negativo', (r.var_venda ?? 0) < 0);

    el('analise-lucro').replaceChildren(dinheiro(r.lucro),
      span(`depois de ${dinheiro(r.imposto)} de imposto`
        + `${r.estimado ? ` · ${porcento(r.estimado, 0)} da venda com custo estimado (nota)` : ''}`));
    const margem = el('analise-margem');
    margem.replaceChildren(porcento(r.margem),
      span([r.margem_anterior == null ? null : `era ${porcento(r.margem_anterior)}`,
        r.margem_sobre_venda == null ? null : `${porcento(r.margem_sobre_venda)} sobre a venda`].filter(Boolean).join(' · ')));
    margem.classList.toggle('negativo', (r.margem ?? 0) < 0
      || (r.margem != null && r.margem_anterior != null && r.margem < r.margem_anterior));
    const real = el('analise-margem-real');
    real.replaceChildren(porcento(r.margem_real),
      span(`lucro de ${dinheiro(r.lucro_real)} · ${plural(r.com_bonificacao, 'produto bonificado', 'produtos bonificados')}`));
    real.classList.toggle('negativo', (r.margem_real ?? 0) < 0);
    el('analise-melhor-dia').replaceChildren(r.melhor_dia ? r.melhor_dia.dia : '–',
      span(r.melhor_dia ? `média de ${dinheiro(r.melhor_dia.media)} por ${r.melhor_dia.dia.toLowerCase()}` : ''));
  }

  // ---------- 2. Decisões ----------

  // Como cada decisão aparece: linha de resumo, explicação e colunas da lista
  const DECISOES = {
    abaixo_custo: {
      titulo: 'Preço não paga o custo',
      explica: 'Tirando o imposto do produto, o preço de varejo de hoje fica abaixo do custo (o real, quando tem): '
        + 'cada venda dá prejuízo.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (produto(d.codigo)?.venda ?? 0), 0),
      rotuloValor: 'vendidos',
      colunas: ['Preço varejo', 'Sem o imposto', 'Custo', 'Perde por unidade', 'Preço para empatar'],
      celulas: (d, p) => [
        celula(dinheiro(p.varejo)),
        linhaPequena(celula(dinheiro(p.varejo * (1 - p.aliquota))), `imposto ${porcento(p.aliquota)}`),
        linhaPequena(celula(dinheiro(p.custo_real ?? p.custo_medio)), p.custo_real ? `real · PROCFIT ${dinheiro(p.custo_medio)}` : 'do PROCFIT'),
        celula(dinheiro(d.prejuizo_unidade), 'negativo'),
        celula(dinheiro(d.preco_minimo)),
      ],
    },
    so_com_bonificacao: {
      titulo: 'Só dá lucro por causa da bonificação',
      explica: 'Pelo custo do PROCFIT o preço dá prejuízo; com as unidades grátis do fornecedor, dá lucro. '
        + 'Se a bonificação parar, o preço precisa subir.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (produto(d.codigo)?.venda ?? 0), 0),
      rotuloValor: 'vendidos',
      colunas: ['Preço varejo', 'Custo PROCFIT', 'Custo real', 'Margem', 'Preço sem bonificação'],
      celulas: (d, p) => [
        celula(dinheiro(p.varejo)),
        celula(dinheiro(p.custo_medio)),
        linhaPequena(celula(dinheiro(p.custo_real)),
          p.bonificacao ? `${Math.round(p.bonificacao.parcela * 100)} grátis a cada 100` : ''),
        linhaPequena(celula(porcento(p.margem_tabela_real)), `PROCFIT ${porcento(p.margem_tabela)}`, 'qtd negativo'),
        celula(dinheiro(d.preco_sem_bonificacao)),
      ],
    },
    perderam_margem: {
      titulo: 'Perderam margem',
      explica: (dd) => `A margem caiu ${porcento(dd.reguas.queda_margem, 0).replace('%', ' pontos')} ou mais `
        + 'em relação ao período anterior. Quase sempre é custo que subiu sem o preço acompanhar.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (d.lucro_perdido ?? 0), 0),
      rotuloValor: 'de lucro a menos',
      colunas: ['Margem no caixa', 'Custo por unidade', 'Preço praticado', 'Lucro a menos', 'Preço para voltar'],
      celulas: (d, p) => [
        linhaPequena(celula(porcento(d.margem_caixa), 'negativo'), `era ${porcento(d.margem_caixa_anterior)}`),
        linhaPequena(celula(dinheiro(p.custo_unitario)), `era ${dinheiro(p.custo_unitario_anterior)} · ${comSinal(d.var_custo)}`),
        linhaPequena(celula(dinheiro(p.preco_praticado)), `era ${dinheiro(p.preco_praticado_anterior)} · ${comSinal(d.var_preco)}`),
        celula(dinheiro(d.lucro_perdido), 'negativo'),
        celula(d.preco_sugerido ? dinheiro(d.preco_sugerido) : '–'),
      ],
    },
    abaixo_desejada: {
      titulo: 'Abaixo da margem desejada',
      explica: 'O preço de hoje não dá a margem desejada que a precificação definiu para o produto.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (d.valor ?? 0), 0),
      rotuloValor: 'a mais no período, no preço certo',
      colunas: ['Preço varejo', 'Margem hoje', 'Margem desejada', 'Preço sugerido'],
      celulas: (d, p) => [
        celula(dinheiro(p.varejo)),
        celula(porcento(p.margem_do_preco), 'negativo'),
        linhaPequena(celula(porcento(p.margem_desejada)), p.margem_desejada_por ? `por ${p.margem_desejada_por}` : ''),
        linhaPequena(celula(dinheiro(p.preco_sugerido)), `+${dinheiro(d.falta)}`),
      ],
    },
    subiu_vendeu_menos: {
      titulo: 'Subiu o preço e vende menos',
      explica: (dd) => `O preço de varejo subiu no período e a venda caiu ${porcento(dd.reguas.efeito_qtd, 0)} ou mais. `
        + `Compara a média por dia de até ${dd.reguas.janela_preco} dias antes e depois da mudança `
        + `(só depois de ${dd.reguas.dias_minimos_depois} dias com o preço novo).`,
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + Math.max(0, d.valor ?? 0), 0),
      rotuloValor: 'de venda a menos',
      colunas: ['Mudou em', 'Preço', 'Vende por dia', 'Lucro por dia'],
      celulas: (d, p) => celulasMudanca(d, p),
    },
    baixou_vendeu_mais: {
      titulo: 'Baixou o preço e vende mais',
      explica: (dd) => `O preço de varejo baixou no período e a venda subiu ${porcento(dd.reguas.efeito_qtd, 0)} ou mais. `
        + 'Olhe o lucro por dia: vender mais só vale se sobrar mais.',
      alerta: false,
      valor: (itens) => itens.reduce((t, d) => t + Math.max(0, d.valor ?? 0), 0),
      rotuloValor: 'de venda a mais',
      colunas: ['Mudou em', 'Preço', 'Vende por dia', 'Lucro por dia'],
      celulas: (d, p) => celulasMudanca(d, p),
    },
    parados: {
      titulo: 'Sem venda no período',
      explica: 'Produtos que vendiam antes, ou que têm estoque e preço, e não venderam nada no período.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (d.valor_estoque ?? 0), 0),
      rotuloValor: 'parados no estoque',
      colunas: ['Última venda', 'Estoque', 'Valor no estoque', 'Preço varejo'],
      celulas: (d, p) => [
        linhaPequena(celula(dataBR(p.ultima_venda)), p.dias_sem_venda != null ? `há ${plural(p.dias_sem_venda, 'dia', 'dias')}` : ''),
        celula(quantidade(p.saldo, p.unidade)),
        celula(d.valor_estoque ? dinheiro(d.valor_estoque) : '–'),
        celula(p.varejo ? dinheiro(p.varejo) : '–'),
      ],
    },
  };

  function celulasMudanca(d, p) {
    const lucroAntes = d.antes_por_dia.lucro;
    const lucroDepois = d.depois_por_dia.lucro;
    const caiu = lucroAntes != null && lucroDepois != null && lucroDepois < lucroAntes;
    return [
      linhaPequena(celula(dataBR(d.dia)), d.quem ? `por ${d.quem}` : ''),
      linhaPequena(celula(`${dinheiro(d.antes)} → ${dinheiro(d.depois)}`), comSinal(d.var_preco)),
      linhaPequena(celula(`${quantidade(d.antes_por_dia.qtd)} → ${quantidade(d.depois_por_dia.qtd, p.unidade)}`),
        `${comSinal(d.var_qtd)} · ${plural(d.janela, 'dia', 'dias')} antes e depois`),
      linhaPequena(celula(lucroAntes == null ? '–' : `${dinheiro(lucroAntes)} → ${dinheiro(lucroDepois)}`, caiu ? 'negativo' : ''),
        d.var_lucro == null ? '' : comSinal(d.var_lucro)),
    ];
  }

  function mostrarDecisoes() {
    const linhas = Object.entries(DECISOES)
      .map(([id, def]) => ({ id, def, itens: dados.decisoes[id] }))
      .filter((x) => x.itens.length);
    if (decisaoAtual && !dados.decisoes[decisaoAtual]?.length) decisaoAtual = null;

    const area = el('analise-decisoes');
    if (!linhas.length) {
      area.replaceChildren(span('Nenhuma decisão pendente no período. Preços e margens dentro do esperado.', 'atencao__vazio'));
    } else {
      area.replaceChildren(...linhas.map(({ id, def, itens }) => {
        const ativo = decisaoAtual === id;
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = `atencao__linha${def.alerta ? ' atencao__linha--alerta' : ''}${ativo ? ' atencao__linha--ativa' : ''}`;
        botao.setAttribute('aria-pressed', String(ativo));
        const texto = span(def.titulo, 'atencao__titulo');
        texto.append(span(typeof def.explica === 'function' ? def.explica(dados) : def.explica, 'atencao__explica'));
        const valor = span(dinheiro(def.valor(itens)), 'atencao__valor');
        valor.append(span(def.rotuloValor, 'atencao__explica'));
        botao.append(
          span('', 'atencao__marca'),
          texto,
          span(plural(itens.length, 'produto', 'produtos'), 'atencao__qtd'),
          valor,
          span(ativo ? 'Fechar' : 'Ver produtos →', 'atencao__ver'),
        );
        botao.addEventListener('click', () => {
          decisaoAtual = ativo ? null : id;
          mostrarDecisoes();
          if (decisaoAtual) el('analise-decisao-lista').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return botao;
      }));
    }
    mostrarListaDecisao();
  }

  function mostrarListaDecisao() {
    el('analise-decisao-lista').hidden = !decisaoAtual;
    if (!decisaoAtual) return;
    const def = DECISOES[decisaoAtual];
    const itens = dados.decisoes[decisaoAtual];
    el('analise-decisao-titulo').textContent = `${def.titulo} (${inteiro(itens.length)})`;
    el('analise-decisao-explica').textContent = `${typeof def.explica === 'function' ? def.explica(dados) : def.explica} `
      + `Total: ${dinheiro(def.valor(itens))} ${def.rotuloValor}. Os de maior impacto aparecem primeiro.`;

    const cabeca = document.createElement('tr');
    for (const [texto, esquerda] of [['Produto', true], ...def.colunas.map((c) => [c, false]), ['O que fazer', true]]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = texto;
      if (esquerda) th.className = 'esquerda';
      cabeca.append(th);
    }
    el('tabela-decisao').tHead.replaceChildren(cabeca);
    el('tabela-decisao').tBodies[0].replaceChildren(...itens.map((d) => {
      const p = produto(d.codigo);
      const tr = document.createElement('tr');
      if (def.alerta) tr.className = 'linha-vencida';
      tr.append(celulaProduto(p), ...def.celulas(d, p), celula(d.acao, 'esquerda analise-acao'));
      return tr;
    }));
  }

  // ---------- 3. Venda no tempo ----------

  const AGRUPAR = {
    dia: (dd) => `Venda e lucro de cada dia dos últimos ${dd.dias} dias.`,
    semana: (dd) => `Semanas de segunda a domingo, dentro dos últimos ${dd.dias} dias.`,
    mes: () => 'Mês a mês, desde 1º de janeiro do ano passado (o mês atual ainda está correndo).',
    ano: () => 'Ano a ano (o ano atual ainda está correndo).',
  };

  function mostrarTempo() {
    const pontos = dados.tempo[agrupar];
    for (const b of el('analise-agrupar').querySelectorAll('[data-agrupar]')) {
      b.classList.toggle('atalho--ativo', b.dataset.agrupar === agrupar);
    }
    el('analise-tempo-explica').textContent = `${AGRUPAR[agrupar](dados)} Lucro depois do imposto e do custo; `
      + 'na venda por nota o custo é estimado. Lucro real: com o custo real (bonificação descontada).';
    graficos.colunas(el('grafico-analise-tempo'), {
      titulo: 'Venda e lucro no tempo',
      rotulos: pontos.map((x) => x.rotulo),
      series: [
        { nome: 'Venda', valores: pontos.map((x) => x.venda), cor: 'var(--verde-claro)' },
        { nome: 'Lucro (PROCFIT)', valores: pontos.map((x) => x.lucro), cor: 'var(--verde)' },
        { nome: 'Lucro real', valores: pontos.map((x) => x.lucro_real), cor: 'var(--verde-vivo)' },
      ],
      vazio: 'Sem venda no período.',
    });

    const semana = dados.tempo.dia_semana;
    const maximo = Math.max(0, ...semana.map((d) => d.media));
    el('analise-dia-semana').replaceChildren(...semana.map((d) => {
      const linha = document.createElement('div');
      linha.className = `barra${d.media === maximo && maximo > 0 ? ' barra--previsao' : ''}`;
      const trilho = span('', 'barra-trilho');
      const cheia = span('', 'barra-preenchida');
      cheia.style.width = `${maximo ? Math.max(2, (d.media / maximo) * 100) : 0}%`;
      trilho.append(cheia);
      const valor = span(dinheiro(d.media), 'barra-valor');
      const nota = document.createElement('small');
      nota.textContent = `${plural(d.vezes, d.dia.toLowerCase(), `${d.dia.toLowerCase()}s`)} no período`;
      valor.append(nota);
      linha.append(span(d.dia, 'barra-rotulo'), trilho, valor);
      return linha;
    }));
  }

  // ---------- 4. Categorias ----------

  function mostrarCategorias() {
    const atual = dados.filtros.categoria;
    const linhas = dados.por_categoria.map((c) => {
      const valor = c.categoria ?? '__sem';
      const tr = document.createElement('tr');
      if (atual === valor) tr.className = 'linha-marcada';
      const nome = document.createElement('button');
      nome.type = 'button';
      nome.className = 'analise-categoria';
      nome.textContent = c.categoria ?? 'Sem categoria';
      nome.title = atual === valor ? 'Mostrar todas as categorias' : 'Ver só esta categoria';
      nome.addEventListener('click', () => escolherCategoria(atual === valor ? '' : valor));
      const tdNome = celula(nome, 'esquerda');
      if (!c.categoria) linhaPequena(tdNome, 'classifique na aba Produtos');
      const margem = celula(porcento(c.margem), (c.margem ?? 0) < 0
        || (c.margem != null && c.margem_anterior != null && c.margem < c.margem_anterior) ? 'negativo' : '');
      linhaPequena(margem, c.margem_anterior == null ? '' : `era ${porcento(c.margem_anterior)}`);
      const margemReal = celula(porcento(c.margem_real), (c.margem_real ?? 0) < 0 ? 'negativo' : '');
      tr.append(
        tdNome,
        celula(dinheiro(c.venda)),
        celula(porcento(c.participacao)),
        celula(comSinal(c.var_venda), (c.var_venda ?? 0) < 0 ? 'negativo' : ''),
        celula(dinheiro(c.lucro)),
        margem,
        margemReal,
        celula(`${inteiro(c.vendidos)} de ${inteiro(c.produtos)}`),
      );
      return tr;
    });
    if (!linhas.length) {
      const tr = document.createElement('tr');
      const vazio = celula('Nenhum produto vendido no período.', 'vazio');
      vazio.colSpan = 8;
      tr.append(vazio);
      linhas.push(tr);
    }
    el('tabela-categorias').tBodies[0].replaceChildren(...linhas);
  }

  // ---------- 5. Mais e menos vendidos ----------

  function barras(alvo, codigos, vazio) {
    const itens = codigos.map(produto).filter(Boolean);
    if (!itens.length) {
      el(alvo).replaceChildren(span(vazio, 'explica'));
      return;
    }
    const maximo = Math.max(0, ...itens.map((p) => p.venda));
    el(alvo).replaceChildren(...itens.map((p) => {
      const linha = document.createElement('button');
      linha.type = 'button';
      linha.className = 'barra barra--previsao';
      linha.title = 'Ver os picos e as quedas da venda deste produto';
      linha.addEventListener('click', () => abrirProduto(p.codigo));
      const rotulo = span(p.descricao ?? `Produto ${p.codigo}`, 'barra-rotulo');
      rotulo.title = `${rotulo.textContent} · código ${p.codigo}`;
      const trilho = span('', 'barra-trilho');
      const cheia = span('', 'barra-preenchida');
      cheia.style.width = `${maximo ? Math.max(2, (p.venda / maximo) * 100) : 0}%`;
      trilho.append(cheia);
      const valor = span(dinheiro(p.venda), 'barra-valor');
      const nota = document.createElement('small');
      nota.textContent = `${quantidade(p.qtd, p.unidade)} · margem ${porcento(p.margem ?? p.margem_tabela)}`
        + `${p.var_venda != null ? ` · ${comSinal(p.var_venda)}` : ''}`;
      valor.append(nota);
      linha.append(rotulo, trilho, valor);
      return linha;
    }));
  }

  // ---------- 6. Todos os produtos ----------

  const CURVAS = {
    todas: { titulo: 'Todos', filtro: () => true, nota: () => 'com venda ou estoque' },
    A: { titulo: 'Curva A', filtro: (p) => p.curva === 'A', nota: (dd) => `somam ${porcento(dd.reguas.curva_a, 0)} da venda: nunca pode faltar` },
    B: { titulo: 'Curva B', filtro: (p) => p.curva === 'B', nota: () => 'os próximos 15% da venda' },
    C: { titulo: 'Curva C', filtro: (p) => p.curva === 'C', nota: () => 'os últimos 5%: candidatos a sair' },
    sem_venda: { titulo: 'Sem venda', filtro: (p) => !p.curva, nota: () => 'nada vendido no período' },
  };

  const ORDENS = {
    venda: (a, b) => b.venda - a.venda,
    venda_menor: (a, b) => a.venda - b.venda,
    margem: (a, b) => (b.margem ?? b.margem_tabela ?? -9) - (a.margem ?? a.margem_tabela ?? -9),
    margem_menor: (a, b) => (a.margem ?? a.margem_tabela ?? 9) - (b.margem ?? b.margem_tabela ?? 9),
    cresceu: (a, b) => (b.var_venda ?? -9) - (a.var_venda ?? -9),
    caiu: (a, b) => (a.var_venda ?? 9) - (b.var_venda ?? 9),
    giro: (a, b) => (a.vende_a_cada ?? 9999) - (b.vende_a_cada ?? 9999),
    parado: (a, b) => (b.dias_sem_venda ?? -1) - (a.dias_sem_venda ?? -1),
    // Mais abaixo do preço sugerido primeiro (sem margem desejada vai para o fim)
    sugerido: (a, b) => (a.diferenca_preco ?? 9999) - (b.diferenca_preco ?? 9999),
    bonificacao: (a, b) => (b.bonificacao?.parcela ?? -1) - (a.bonificacao?.parcela ?? -1),
  };

  // Nome do produto que abre a janela dele
  function nomeClicavel(p) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'analise-produto-link';
    botao.textContent = p.descricao ?? `Produto ${p.codigo}`;
    botao.title = 'Ver os picos e as quedas da venda deste produto';
    botao.addEventListener('click', (evento) => {
      evento.stopPropagation();
      abrirProduto(p.codigo);
    });
    return botao;
  }

  function celulaProduto(p) {
    const td = p ? celula(nomeClicavel(p), 'esquerda') : celula('Produto', 'esquerda');
    if (!p) return td;
    const partes = [`código ${p.codigo}`, p.unidade, p.categoria, p.tipo === 'producao' ? 'produção própria' : null].filter(Boolean);
    td.append(span(` ${partes.join(' · ')}`, 'qtd'));
    return td;
  }

  // Preço sugerido: margem desejada (campo para quem edita, texto para os outros) e o preço que ela pede
  function celulaSugerido(p) {
    const td = celula(p.preco_sugerido ? dinheiro(p.preco_sugerido) : '–',
      p.diferenca_preco != null && p.diferenca_preco < 0 ? 'negativo' : '');
    const diferenca = p.preco_sugerido && p.diferenca_preco
      ? (p.diferenca_preco < 0 ? `falta ${dinheiro(-p.diferenca_preco)}` : `${dinheiro(p.diferenca_preco)} acima`)
      : null;
    // Uma linha: quanto o preço de hoje dá e a diferença para o sugerido
    linhaPequena(td, [p.margem_do_preco == null ? null : `hoje dá ${porcento(p.margem_do_preco)}`, diferenca]
      .filter(Boolean).join(' · '));

    const linha = document.createElement('label');
    linha.className = 'analise-desejada';
    linha.append(span('desejada '));
    if (dados.pode_editar) {
      const campo = document.createElement('input');
      campo.type = 'number';
      campo.min = '0';
      campo.max = String((dados.reguas.margem_desejada_maxima ?? 0.6) * 100);
      campo.step = '0.5';
      campo.inputMode = 'decimal';
      campo.placeholder = '–';
      campo.value = p.margem_desejada == null ? '' : String(Math.round(p.margem_desejada * 1000) / 10);
      campo.setAttribute('aria-label', `Margem desejada de ${p.descricao} (%)`);
      campo.title = p.margem_desejada_por ? `Definida por ${p.margem_desejada_por}` : 'Margem desejada sobre a venda (%)';
      campo.addEventListener('change', () => gravarMargem(p, campo));
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') campo.blur(); });
      linha.append(campo, span('%'));
    } else {
      linha.append(span(p.margem_desejada == null ? 'não definida' : porcento(p.margem_desejada)));
    }
    td.append(document.createElement('br'), linha);
    return td;
  }

  async function gravarMargem(p, campo) {
    const texto = campo.value.trim().replace(',', '.');
    const margem = texto === '' ? null : Number(texto) / 100;
    if (margem !== null && !Number.isFinite(margem)) return;
    if (margem === p.margem_desejada) return;
    campo.disabled = true;
    try {
      await chamar('/precificacao/margens', { method: 'PUT', body: JSON.stringify({ produtos: [p.codigo], margem }) });
      await carregar(`${p.descricao}: margem desejada ${margem === null ? 'tirada' : `de ${porcento(margem)} gravada`}`);
    } catch (erro) {
      mostrarStatus(erro.message, true);
      campo.disabled = false;
    }
  }

  function visiveis() {
    const termo = normalizar(el('pesquisa-termo').value.trim());
    return dados.produtos
      .filter((p) => CURVAS[curvaAtual].filtro(p)
        && (!termo || String(p.codigo) === termo || normalizar(p.descricao).includes(termo)
          || normalizar(p.categoria).includes(termo)))
      .sort(ORDENS[el('analise-ordem').value] ?? ORDENS.venda);
  }

  function mostrarCurvas() {
    el('analise-curvas').replaceChildren(...Object.entries(CURVAS).map(([id, c]) => {
      const itens = dados.produtos.filter(c.filtro);
      const venda = itens.reduce((t, p) => t + p.venda, 0);
      const ativo = curvaAtual === id;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
      botao.setAttribute('aria-pressed', String(ativo));
      const titulo = document.createElement('h3');
      titulo.textContent = c.titulo;
      const valor = document.createElement('p');
      valor.className = 'cartao-valor';
      valor.textContent = plural(itens.length, 'produto', 'produtos');
      const nota = document.createElement('p');
      nota.className = 'cartao-nota';
      nota.textContent = id === 'sem_venda' ? c.nota(dados) : `${dinheiro(venda)} · ${c.nota(dados)}`;
      botao.append(titulo, valor, nota);
      botao.addEventListener('click', () => {
        curvaAtual = id;
        pagina = 1;
        mostrarCurvas();
        mostrarProdutos();
      });
      return botao;
    }));
  }

  function mostrarProdutos() {
    const itens = visiveis();
    const paginas = Math.max(1, Math.ceil(itens.length / porPagina));
    pagina = Math.min(pagina, paginas);
    const primeiro = (pagina - 1) * porPagina;
    el('analise-produtos-titulo').textContent = `${CURVAS[curvaAtual].titulo === 'Todos' ? 'Produtos' : CURVAS[curvaAtual].titulo} (${inteiro(itens.length)})`;

    const linhas = itens.slice(primeiro, primeiro + porPagina).map((p) => {
      const tr = document.createElement('tr');
      const curva = celula(p.curva ?? '–');
      if (p.curva) curva.firstChild.replaceWith(span(p.curva, `analise-curva analise-curva--${p.curva.toLowerCase()}`));

      const vendido = linhaPequena(celula(p.venda ? dinheiro(p.venda) : '–'), p.qtd ? quantidade(p.qtd, p.unidade) : '');
      const comparado = linhaPequena(celula(comSinal(p.var_venda), (p.var_venda ?? 0) < 0 ? 'negativo' : ''),
        p.venda_anterior ? `era ${dinheiro(p.venda_anterior)}` : '');

      const caiuMargem = p.margem != null && p.margem_anterior != null && p.margem < p.margem_anterior;
      // Margem: o número e, embaixo, uma linha só (antes · real); o "estimado" fica na dica do mouse
      const margem = linhaPequena(
        celula(p.margem != null ? porcento(p.margem) : '–', p.margem != null && p.margem < 0 ? 'negativo' : ''),
        [p.margem_anterior != null ? `era ${porcento(p.margem_anterior)}` : null,
          p.custo_real && p.margem_real != null ? `real ${porcento(p.margem_real)}` : null].filter(Boolean).join(' · '),
        caiuMargem ? 'qtd negativo' : 'qtd',
      );
      if (p.estimado) margem.title = `${porcento(p.estimado, 0)} da venda veio por nota, com o custo estimado`;

      // Preço e custo: preço; custo (e o real); imposto e a última mudança de preço
      const preco = celula(p.varejo ? dinheiro(p.varejo) : '–', (p.margem_tabela_real ?? p.margem_tabela ?? 0) < 0 ? 'negativo' : '');
      linhaPequena(preco, [p.custo_medio ? `custo ${dinheiro(p.custo_medio)}` : null,
        p.custo_real ? `real ${dinheiro(p.custo_real)}` : null].filter(Boolean).join(' · '));
      const mudou = p.ultima_mudanca
        ? `${p.ultima_mudanca.depois > p.ultima_mudanca.antes ? 'subiu' : 'baixou'} ${dataBR(p.ultima_mudanca.quando).slice(0, 5)}`
        : null;
      linhaPequena(preco, [p.aliquota != null ? `imp. ${porcento(p.aliquota, 0)}` : null,
        p.bonificacao ? `${Math.round(p.bonificacao.parcela * 100)}% bonif.` : null, mudou].filter(Boolean).join(' · '));

      const giro = linhaPequena(celula(p.vende_a_cada == null ? '–'
        : p.vende_a_cada <= 1 ? 'todo dia' : `a cada ${decimal(p.vende_a_cada)} dias`, 'sem-quebra'),
      p.melhor_dia ? `mais na ${p.melhor_dia.toLowerCase()}` : '');

      const ultima = linhaPequena(celula(dataBR(p.ultima_venda)),
        p.dias_sem_venda ? `há ${plural(p.dias_sem_venda, 'dia', 'dias')}` : '',
        (p.dias_sem_venda ?? 0) > dados.dias ? 'qtd negativo' : 'qtd');

      tr.append(celulaProduto(p), curva, vendido, comparado, margem, preco, celulaSugerido(p), giro, ultima,
        celula(quantidade(p.saldo, p.unidade), p.saldo < 0 ? 'negativo' : ''));
      return tr;
    });
    if (!linhas.length) {
      const tr = document.createElement('tr');
      const vazio = celula('Nenhum produto nesta lista.', 'vazio');
      vazio.colSpan = 10;
      tr.append(vazio);
      linhas.push(tr);
    }
    el('tabela-analise-produtos').tBodies[0].replaceChildren(...linhas);

    paginacao.desenhar(el('analise-paginador'), {
      total: itens.length,
      pagina,
      porPagina,
      aoMudar: (escolha) => {
        pagina = escolha.pagina;
        if (escolha.porPagina !== porPagina) {
          porPagina = escolha.porPagina;
          paginacao.guardar('precificacao-analise', porPagina);
        }
        mostrarProdutos();
      },
    });
  }

  // ---------- Janela do produto: picos e quedas ----------

  let detalhe = null;       // o que a API mandou do produto aberto
  let agruparProduto = 'semana';
  const AGRUPAR_PRODUTO = { dia: 'Dia (90 dias)', semana: 'Semana', mes: 'Mês' };
  const NOME_PONTO = { dia: 'o dia', semana: 'a semana', mes: 'o mês' };

  function criar(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  // Monta a janela uma vez e reaproveita (mesmo padrão da janela do pedido)
  function janelaProduto() {
    let dialogo = document.getElementById('janela-produto-analise');
    if (dialogo) return dialogo;
    dialogo = criar('dialog', 'detalhe detalhe--produto-analise');
    dialogo.id = 'janela-produto-analise';
    dialogo.setAttribute('aria-labelledby', 'produto-analise-titulo');

    const topo = criar('header', 'detalhe__topo');
    const textos = criar('div');
    const titulo = criar('h2', null, 'Produto');
    titulo.id = 'produto-analise-titulo';
    const resumo = criar('p', 'detalhe__resumo');
    resumo.id = 'produto-analise-resumo';
    textos.append(titulo, resumo);
    const acoes = criar('div', 'detalhe__acoes');
    const fechar = criar('button', 'botao-secundario', 'Fechar');
    fechar.type = 'button';
    fechar.addEventListener('click', () => dialogo.close());
    acoes.append(fechar);
    topo.append(textos, acoes);

    const status = criar('p', 'status');
    status.id = 'produto-analise-status';
    status.setAttribute('role', 'status');
    const corpo = criar('div', 'detalhe__corpo produto-analise-corpo');
    corpo.id = 'produto-analise-corpo';
    dialogo.append(topo, status, corpo);
    // Clicar fora da janela (no fundo escuro) fecha
    dialogo.addEventListener('click', (evento) => { if (evento.target === dialogo) dialogo.close(); });
    document.body.append(dialogo);
    return dialogo;
  }

  async function abrirProduto(codigo) {
    const dialogo = janelaProduto();
    const p = produto(codigo);
    el('produto-analise-titulo').textContent = p?.descricao ?? `Produto ${codigo}`;
    el('produto-analise-resumo').textContent = `código ${codigo}`;
    el('produto-analise-corpo').replaceChildren();
    el('produto-analise-status').textContent = 'Lendo a venda do produto…';
    if (!dialogo.open) dialogo.showModal();
    try {
      detalhe = await chamar(`/precificacao/analise/produto/${codigo}`);
      el('produto-analise-status').textContent = '';
      mostrarProduto();
    } catch (erro) {
      el('produto-analise-status').textContent = erro.message;
    }
  }

  // Frase das mudanças de preço perto de um pico ou de uma queda
  function textoMudancas(lista) {
    if (!lista?.length) return 'Nenhuma mudança de preço perto dessa data.';
    return lista.map((m) => `o preço ${m.subiu ? 'subiu' : 'baixou'} de ${dinheiro(m.antes)} para ${dinheiro(m.depois)} `
      + `em ${dataBR(m.quando)}${m.quem ? ` (${m.quem})` : ''}`).join('; ') + '.';
  }

  function mostrarProduto() {
    const d = detalhe;
    const p = d.produto;
    const serie = d.series[agruparProduto];
    const corpo = el('produto-analise-corpo');

    el('produto-analise-resumo').textContent = [`código ${p.codigo}`, p.varejo ? `varejo ${dinheiro(p.varejo)}` : null,
      p.custo_medio ? `custo ${dinheiro(p.custo_medio)}` : null, p.custo_real ? `real ${dinheiro(p.custo_real)}` : null,
      `estoque ${quantidade(p.saldo, p.unidade)}`].filter(Boolean).join(' · ');

    // Indicadores: tendência, pico e queda
    const indicadores = criar('dl', 'indicadores produto-analise-numeros');
    const numero = (rotulo, valor, nota, alerta) => {
      const dd = criar('dd', alerta ? 'negativo' : '', valor);
      if (nota) dd.append(span(nota));
      indicadores.append(criar('dt', null, rotulo), dd);
    };
    const t = d.tendencia;
    numero('Últimas 4 semanas', dinheiro(t.ultimas),
      t.variacao == null ? 'sem as 4 semanas de antes para comparar' : `${comSinal(t.variacao)} contra as 4 de antes`,
      (t.variacao ?? 0) < -0.1);
    numero(`Pico (${AGRUPAR_PRODUTO[agruparProduto].toLowerCase()})`, serie.pico ? dinheiro(serie.pico.venda) : '–',
      serie.pico ? `${serie.pico.rotulo} · ${quantidade(serie.pico.qtd, p.unidade)}` : 'sem venda');
    numero('Maior queda', serie.queda ? comSinal(serie.queda.variacao) : '–',
      serie.queda ? `${serie.queda.rotulo}: ${dinheiro(serie.queda.venda)} (antes ${dinheiro(serie.queda.anterior)})` : 'nenhuma queda',
      Boolean(serie.queda));
    const melhor = [...d.dia_semana].sort((a, b) => b.media - a.media)[0];
    numero('Dia que mais vende', melhor?.media > 0 ? melhor.dia : '–',
      melhor?.media > 0 ? `média de ${dinheiro(melhor.media)} (90 dias)` : '');

    // Botões Dia | Semana | Mês
    const botoes = criar('div', 'atalhos');
    for (const [id, texto] of Object.entries(AGRUPAR_PRODUTO)) {
      const b = criar('button', `botao-secundario${id === agruparProduto ? ' atalho--ativo' : ''}`, texto);
      b.type = 'button';
      b.addEventListener('click', () => { agruparProduto = id; mostrarProduto(); });
      botoes.append(b);
    }

    // Gráfico: pico em verde-escuro, queda em laranja, o ponto que ainda está correndo mais claro
    const grafico = criar('div', 'produto-analise-grafico');
    const ultimo = serie.pontos.length - 1;
    const cores = serie.pontos.map((_, i) => {
      if (serie.pico && i === serie.pico.indice) return 'var(--verde-escuro)';
      if (serie.queda && i === serie.queda.indice) return graficos.ALERTA;
      if (i === ultimo) return 'var(--verde-suave)';
      return 'var(--verde-claro)';
    });

    // O que explica o pico e a queda (o número importante também em texto, como pede o DESIGN.md)
    const explica = criar('div', 'produto-analise-explica');
    const frase = (marca, titulo, texto) => {
      const linha = criar('p');
      linha.append(span('', `produto-analise-marca produto-analise-marca--${marca}`), criar('strong', null, `${titulo} `), texto);
      explica.append(linha);
    };
    if (serie.pico) {
      frase('pico', 'Pico:', `${NOME_PONTO[agruparProduto]} ${serie.pico.rotulo.replace('sem. ', 'de ')} vendeu `
        + `${dinheiro(serie.pico.venda)} (${quantidade(serie.pico.qtd, p.unidade)}). ${textoMudancas(serie.pico.mudancas)}`);
    }
    if (serie.queda) {
      frase('queda', 'Maior queda:', `${NOME_PONTO[agruparProduto]} ${serie.queda.rotulo.replace('sem. ', 'de ')} vendeu `
        + `${dinheiro(serie.queda.venda)}, ${comSinal(serie.queda.variacao)} contra o ponto anterior `
        + `(${dinheiro(serie.queda.anterior)}). ${textoMudancas(serie.queda.mudancas)}`);
    }
    frase('correndo', 'Último ponto:', `${NOME_PONTO[agruparProduto]} atual ainda está correndo (vai até hoje), `
      + 'por isso aparece mais claro e não conta como queda.');

    // Mudanças de preço do produto
    const tituloMudancas = criar('h3', 'subtitulo', `Mudanças do preço de varejo (${inteiro(d.mudancas.length)})`);
    let mudancas;
    if (d.mudancas.length) {
      mudancas = criar('div', 'tabela-rolagem');
      const tabela = criar('table', 'tabela');
      const cabeca = criar('tr');
      for (const [texto, esquerda] of [['Quando', true], ['Antes', false], ['Depois', false], ['Mudança', false], ['Quem', true]]) {
        const th = criar('th', esquerda ? 'esquerda' : '', texto);
        th.scope = 'col';
        cabeca.append(th);
      }
      tabela.createTHead().append(cabeca);
      const corpoTabela = tabela.createTBody();
      for (const m of d.mudancas) {
        const tr = criar('tr');
        const v = m.antes > 0 ? (m.depois - m.antes) / m.antes : null;
        tr.append(celula(dataBR(m.quando), 'esquerda'), celula(dinheiro(m.antes)), celula(dinheiro(m.depois)),
          celula(comSinal(v), (v ?? 0) > 0 ? 'negativo' : ''),
          linhaPequena(celula(m.quem ?? '–', 'esquerda'), m.fora ? 'direto no banco, fora do PROCFIT' : ''));
        corpoTabela.append(tr);
      }
      mudancas.append(tabela);
    } else {
      mudancas = criar('p', 'explica', 'O preço de varejo não mudou desde que o PROCFIT começou a guardar o histórico (mai/2026).');
    }

    corpo.replaceChildren(indicadores, botoes, grafico, explica, tituloMudancas, mudancas);
    graficos.colunas(grafico, {
      titulo: `Venda de ${p.descricao}`,
      rotulos: serie.pontos.map((x) => x.rotulo),
      series: [
        { nome: 'Venda', valores: serie.pontos.map((x) => x.venda), cor: 'var(--verde-claro)', cores },
        { nome: 'Lucro (PROCFIT)', valores: serie.pontos.map((x) => x.lucro), cor: 'var(--verde)' },
      ],
      vazio: 'Sem venda neste período.',
    });
  }

  // ---------- Ler, mostrar e ligar ----------

  function preencherCategorias() {
    const atual = dados.filtros.categoria ?? '';
    el('analise-categoria').replaceChildren(new Option('Todas', ''), new Option('Sem categoria', '__sem'),
      ...dados.categorias.map((c) => new Option(c, c)));
    el('analise-categoria').value = atual;
  }

  function mostrar() {
    if (!dados) return;
    mostrarResumo();
    mostrarDecisoes();
    mostrarTempo();
    mostrarCategorias();
    barras('analise-mais-vendidos', dados.mais_vendidos, 'Nenhum produto vendido no período.');
    barras('analise-menos-vendidos', dados.menos_vendidos, 'Nenhum produto vendido no período.');
    mostrarCurvas();
    mostrarProdutos();
  }

  const filtrosAtuais = () => `${dias}|${el('analise-categoria').value}|${el('analise-tipo').value}`;

  async function carregar(mensagem, atualizar = false) {
    mostrarStatus('Lendo as vendas no PROCFIT…');
    try {
      const parametros = new URLSearchParams({ dias });
      if (el('analise-categoria').value) parametros.set('categoria', el('analise-categoria').value);
      if (el('analise-tipo').value) parametros.set('tipo', el('analise-tipo').value);
      if (atualizar) parametros.set('atualizar', '1');
      dados = await chamar(`/precificacao/analise?${parametros}`);
      lidoCom = filtrosAtuais();
      porCodigo = new Map(dados.produtos.map((p) => [p.codigo, p]));
      preencherCategorias();
      el('aba-analise').hidden = false;
      mostrar();
      const lido = new Date(dados.lido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      mostrarStatus(`${mensagem ? `${mensagem} · ` : ''}últimos ${dados.dias} dias (até ${dataBR(dados.hoje)}) · `
        + `dados do PROCFIT lidos às ${lido}`);
    } catch (erro) {
      mostrarStatus(erro.message, true);
    }
  }

  function escolherCategoria(valor) {
    el('analise-categoria').value = valor;
    pagina = 1;
    carregar();
  }

  function ligar() {
    el('analise-categoria').addEventListener('change', () => escolherCategoria(el('analise-categoria').value));
    el('analise-tipo').addEventListener('change', () => { pagina = 1; carregar(); });
    el('analise-agrupar').addEventListener('click', (evento) => {
      const botao = evento.target.closest('[data-agrupar]');
      if (!botao || !dados) return;
      agrupar = botao.dataset.agrupar;
      mostrarTempo();
    });
    el('analise-ordem').addEventListener('change', () => { pagina = 1; mostrarProdutos(); });
  }

  // Precisa ler de novo quando nunca leu ou quando período, categoria ou tipo mudou
  const desatualizado = () => !dados || lidoCom !== filtrosAtuais();

  return {
    carregar, mostrar, ligar, desatualizado,
    pesquisou: () => { if (dados) { pagina = 1; mostrarProdutos(); } },
  };
})();
