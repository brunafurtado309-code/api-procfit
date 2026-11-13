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
// "Ver picos e precificação" na tabela de categorias abre a mesma janela para a categoria inteira, com os
// produtos que fizeram o pico e os que derrubaram a queda, e a precificação de cada produto dela.
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
    const nomeLoja = dados.filtros.loja == null ? '' : ` · ${dados.lojas.find((l) => l.codigo === dados.filtros.loja)?.nome ?? ''}`;
    el('analise-titulo-venda').textContent = (dados.filtros.categoria
      ? `Venda de ${dados.filtros.categoria === '__sem' ? 'produtos sem categoria' : dados.filtros.categoria} nos últimos ${dados.dias} dias`
      : `Venda nos últimos ${dados.dias} dias`) + nomeLoja;
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
    const c = r.canais;
    margem.replaceChildren(porcento(r.margem),
      span([r.margem_anterior == null ? null : `era ${porcento(r.margem_anterior)}`,
        r.margem_sobre_venda == null ? null : `${porcento(r.margem_sobre_venda)} sobre a venda`].filter(Boolean).join(' · ')),
      // Por canal: no balcão o custo é o de cada venda; no atacado (nota) o custo é estimado com o de hoje
      span(`balcão ${porcento(c?.balcao?.margem)} · atacado ${porcento(c?.atacado?.margem)} (estimada)`));
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
      // "O que fazer" curto: os números já estão nas colunas (o texto inteiro fica ao passar o mouse)
      curta: (d) => `Subir para ${dinheiro(d.preco_minimo)} ou mais. Confira antes se o custo está certo.`,
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
      curta: (d) => `Se a bonificação parar, subir para ${dinheiro(d.preco_sem_bonificacao)}.`,
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
      explica: (dd) => `O preço de varejo subiu no período e a venda caiu ${porcento(dd.reguas.efeito_qtd, 0)} ou mais, `
        + 'já descontado o que a categoria variou nas mesmas datas. Compara semanas inteiras '
        + `(até ${dd.reguas.janela_preco} dias) antes e depois da mudança, com ao menos ${dd.reguas.unidades_minimas} unidades.`,
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + Math.max(0, d.valor ?? 0), 0),
      rotuloValor: 'de venda a menos',
      colunas: ['Mudou em', 'Preço', 'Vende por dia', 'Lucro por dia'],
      celulas: (d, p) => celulasMudanca(d, p),
    },
    baixou_vendeu_mais: {
      titulo: 'Baixou o preço e vende mais',
      explica: (dd) => `O preço de varejo baixou no período e a venda subiu ${porcento(dd.reguas.efeito_qtd, 0)} ou mais, `
        + 'já descontada a categoria. Olhe o lucro por dia: vender mais só vale se sobrar mais.',
      alerta: false,
      valor: (itens) => itens.reduce((t, d) => t + Math.max(0, d.valor ?? 0), 0),
      rotuloValor: 'de venda a mais',
      colunas: ['Mudou em', 'Preço', 'Vende por dia', 'Lucro por dia'],
      celulas: (d, p) => celulasMudanca(d, p),
    },
    estoque_alto: {
      titulo: 'Estoque alto para o giro',
      explica: (dd) => `O estoque de hoje dá para mais de ${dd.reguas.cobertura_alta} dias de venda: dinheiro parado. `
        + `O valor é o que passa de uns ${dd.reguas.cobertura_boa} dias, no custo.`,
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (d.excesso ?? 0), 0),
      rotuloValor: 'a mais no estoque',
      colunas: ['Estoque', 'Dá para', 'No custo', 'GMROI'],
      celulas: (d, p) => [
        celula(quantidade(p.saldo, p.unidade)),
        celula(`${inteiro(p.cobertura)} dias`, 'negativo'),
        celula(dinheiro(p.estoque_custo)),
        celula(p.gmroi == null ? '–' : decimal(p.gmroi)),
      ],
    },
    embalagem: {
      titulo: 'Embalagem maior mais cara por kg',
      explica: 'A embalagem maior do mesmo produto sai mais cara por kg (ou litro) que a menor: o cliente compra '
        + 'a pequena ou vai ao concorrente. O nome e o tamanho vêm da descrição do produto.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (produto(d.codigo)?.venda ?? 0), 0),
      rotuloValor: 'vendidos da maior',
      colunas: ['Preço', 'Por kg/L', 'A menor', 'Preço máximo'],
      celulas: (d, p) => {
        const menor = produto(d.menor);
        return [
          celula(dinheiro(p.varejo)),
          celula(`${dinheiro(d.por_medida)}/${d.medida}`, 'negativo'),
          linhaPequena(celula(`${dinheiro(d.por_medida_menor)}/${d.medida}`), menor?.descricao ?? ''),
          celula(dinheiro(d.preco_maximo)),
        ];
      },
    },
    parados: {
      titulo: 'Sem venda no período',
      explica: 'Produtos que vendiam antes, ou que têm estoque e preço, e não venderam nada no período.',
      alerta: true,
      valor: (itens) => itens.reduce((t, d) => t + (d.valor_estoque ?? d.valor ?? 0), 0),
      // Sem estoque conferido, o valor é o que o produto vendia no ano antes do período (não o estoque parado)
      get rotuloValor() { return dados?.reguas?.estoque_conferido ? 'parados no estoque' : 'vendidos no ano antes do período'; },
      colunas: ['Última venda', 'Estoque (sistema)', 'Vendia antes', 'Preço varejo'],
      celulas: (d, p) => [
        linhaPequena(celula(dataBR(p.ultima_venda)), p.dias_sem_venda != null ? `há ${plural(p.dias_sem_venda, 'dia', 'dias')}` : ''),
        celula(quantidade(p.saldo, p.unidade)),
        celula(d.valor_estoque ? dinheiro(d.valor_estoque) : (d.valor ? dinheiro(d.valor) : '–')),
        celula(p.varejo ? dinheiro(p.varejo) : '–'),
      ],
    },
  };

  // "−47,2% (categoria −5,0%) · elasticidade −2,4 · 28 dias de cada lado"
  function textoEfeito(v) {
    return [
      `${comSinal(v.var_qtd)}${v.var_categoria != null ? ` (categoria ${comSinal(v.var_categoria)})` : ''}`,
      v.elasticidade != null ? `elasticidade ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v.elasticidade)}` : null,
      `${plural(v.janela, 'dia', 'dias')} de cada lado`,
    ].filter(Boolean).join(' · ');
  }

  function celulasMudanca(d, p) {
    const lucroAntes = d.antes_por_dia.lucro;
    const lucroDepois = d.depois_por_dia.lucro;
    const caiu = lucroAntes != null && lucroDepois != null && lucroDepois < lucroAntes;
    return [
      linhaPequena(celula(dataBR(d.dia)), d.quem ? `por ${d.quem}` : ''),
      linhaPequena(celula(`${dinheiro(d.antes)} → ${dinheiro(d.depois)}`), comSinal(d.var_preco)),
      linhaPequena(celula(`${quantidade(d.antes_por_dia.qtd)} → ${quantidade(d.depois_por_dia.qtd, p.unidade)}`),
        textoEfeito(d)),
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
      // Texto curto (quando a decisão tem) ou o texto inteiro em até 2 linhas; o completo fica no "title"
      const acao = celula('', 'esquerda analise-acao');
      const texto = document.createElement('div');
      if (!def.curta) texto.className = 'analise-acao__resumo';
      texto.textContent = def.curta ? def.curta(d, p) : d.acao;
      acao.append(texto);
      acao.title = d.acao;
      tr.append(celulaProduto(p), ...def.celulas(d, p), acao);
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
      const ver = document.createElement('button');
      ver.type = 'button';
      ver.className = 'analise-categoria';
      ver.textContent = 'Picos e precificação →';
      ver.addEventListener('click', () => abrirCategoria(valor));
      tr.append(
        tdNome,
        celula(dinheiro(c.venda)),
        celula(porcento(c.participacao)),
        celula(comSinal(c.var_venda), (c.var_venda ?? 0) < 0 ? 'negativo' : ''),
        celula(dinheiro(c.lucro)),
        margem,
        margemReal,
        celula(`${inteiro(c.vendidos)} de ${inteiro(c.produtos)}`),
        celula(ver),
      );
      return tr;
    });
    if (!linhas.length) {
      const tr = document.createElement('tr');
      const vazio = celula('Nenhum produto vendido no período.', 'vazio');
      vazio.colSpan = 9;
      tr.append(vazio);
      linhas.push(tr);
    }
    el('tabela-categorias').tBodies[0].replaceChildren(...linhas);
  }

  // ---------- 4b. Lojas ----------

  function mostrarLojas() {
    const atual = dados.filtros.loja == null ? null : String(dados.filtros.loja);
    const linhas = dados.por_loja.map((l) => {
      const valor = String(l.codigo);
      const tr = document.createElement('tr');
      if (atual === valor) tr.className = 'linha-marcada';
      const nome = document.createElement('button');
      nome.type = 'button';
      nome.className = 'analise-categoria';
      nome.textContent = l.nome;
      nome.title = atual === valor ? 'Mostrar todas as lojas' : 'Ver só esta loja';
      nome.addEventListener('click', () => {
        pagina = 1;
        modulos.escolherLoja(atual === valor ? '' : valor); // muda a loja do painel todo
      });
      tr.append(
        celula(nome, 'esquerda'),
        celula(dinheiro(l.venda)),
        celula(porcento(l.participacao)),
        celula(comSinal(l.var_venda), (l.var_venda ?? 0) < 0 ? 'negativo' : ''),
        celula(dinheiro(l.lucro)),
        celula(porcento(l.margem), (l.margem ?? 0) < 0 ? 'negativo' : ''),
        celula(inteiro(l.vendidos)),
      );
      return tr;
    });
    if (!linhas.length) {
      const tr = document.createElement('tr');
      const vazio = celula('Nenhuma loja com venda no período.', 'vazio');
      vazio.colSpan = 7;
      tr.append(vazio);
      linhas.push(tr);
    }
    el('tabela-lojas').tBodies[0].replaceChildren(...linhas);
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

  // Papel de cada produto (matriz giro x margem): o que fazer com o preço de cada um
  const PAPEIS = {
    estrela: { titulo: 'Estrela', explica: 'Gira muito e tem margem. Proteger: nunca faltar e mexer no preço com cuidado.' },
    puxador: { titulo: 'Puxador de venda', explica: 'Gira muito com pouca margem. Traz o cliente: preço competitivo de propósito, ganhar no resto da compra.' },
    oportunidade: { titulo: 'Oportunidade', explica: 'Margem boa e pouco giro. Dar visibilidade: exposição, oferecer junto, campanha.' },
    peso_morto: { titulo: 'Peso morto', explica: 'Nem gira nem tem margem. Rever preço e custo, ou tirar de linha.' },
  };
  let papelAtual = null;

  function mostrarMatriz() {
    const r = dados.resumo;
    el('analise-matriz-explica').textContent = r.mediana_margem == null ? 'Sem produtos vendidos no período.'
      : `Giro alto = curva A ou B. Margem alta = ${porcento(r.mediana_margem)} ou mais (a mediana dos vendidos; `
        + 'margem real, quando tem). Clique num quadrante para ver os produtos dele na lista.';
    // Ordem de leitura da matriz: em cima o giro alto (estrela | puxador), embaixo o baixo (oportunidade | peso morto)
    el('analise-matriz').replaceChildren(...['estrela', 'puxador', 'oportunidade', 'peso_morto'].map((id) => {
      const def = PAPEIS[id];
      const info = r.papeis?.[id] ?? { produtos: 0, venda: 0 };
      const ativo = papelAtual === id;
      const botao = criar('button', `cartao analise-papel analise-papel--${id}${ativo ? ' cartao--ativo' : ''}`);
      botao.type = 'button';
      botao.setAttribute('aria-pressed', String(ativo));
      botao.append(criar('h3', null, def.titulo), criar('p', 'cartao-valor', plural(info.produtos, 'produto', 'produtos')),
        criar('p', 'cartao-nota', `${dinheiro(info.venda)} · ${def.explica}`));
      botao.addEventListener('click', () => {
        papelAtual = ativo ? null : id;
        pagina = 1;
        mostrarMatriz();
        mostrarProdutos();
        if (papelAtual) el('analise-produtos-titulo').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return botao;
    }));
  }

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
    gmroi: (a, b) => (b.gmroi ?? -999) - (a.gmroi ?? -999),
    cobertura: (a, b) => (b.cobertura ?? -1) - (a.cobertura ?? -1),
    // Mudança de preço mais recente primeiro (sem mudança vai para o fim)
    mudou: (a, b) => String(b.mudancas_recentes?.[0]?.quando ?? '').localeCompare(String(a.mudancas_recentes?.[0]?.quando ?? '')),
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

  // Etiqueta da tabela de preço (Varejo / Atacado), a mesma da Logística
  const etiquetaTabela = (m) => span(m.nome_tabela ?? 'Varejo',
    `tabela-preco ${m.tabela === 4 ? 'tabela-preco--atacado' : 'tabela-preco--varejo'}`);

  // Variações de preço do produto: as últimas mudanças (varejo e atacado), uma por linha.
  // "ver todas" abre a janela do produto, com a análise de cada uma.
  function celulaVariacoes(p) {
    const td = celula('', 'esquerda analise-variacoes');
    if (!p.mudancas_recentes?.length) {
      td.textContent = '–';
      return td;
    }
    for (const m of p.mudancas_recentes) {
      const linha = criar('div', 'analise-variacao');
      const valores = span(` ${dinheiro(m.antes)} → ${dinheiro(m.depois)} `);
      const pct = span(comSinal(m.var_preco), m.depois > m.antes ? 'negativo' : 'analise-variacao__baixou');
      // "23/10/2026 09:12" -> "23/10/26"
      const data = dataBR(m.quando);
      linha.append(span(`${data.slice(0, 6)}${data.slice(8, 10)}`, 'analise-variacao__data'), ' ', etiquetaTabela(m), valores, pct);
      if (m.quem) linha.append(span(` · ${String(m.quem).split(' ')[0]}`, 'analise-variacao__quem'));
      td.append(linha);
    }
    if (p.mudancas_total > p.mudancas_recentes.length) {
      const todas = criar('button', 'analise-produto-link analise-variacao__todas', `ver as ${inteiro(p.mudancas_total)} mudanças`);
      todas.type = 'button';
      todas.addEventListener('click', () => abrirProduto(p.codigo));
      td.append(todas);
    }
    return td;
  }

  // Preço sugerido: margem desejada (campo para quem edita, texto para os outros) e o preço que ela pede
  function celulaSugerido(p, origem = dados) {
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
    if (origem.pode_editar) {
      const campo = document.createElement('input');
      campo.type = 'number';
      campo.min = '0';
      campo.max = String((origem.reguas.margem_desejada_maxima ?? 0.6) * 100);
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
    td.append(linha); // a linha é um bloco (flex): já desce sozinha, sem <br>
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
      const texto = `${p.descricao}: margem desejada ${margem === null ? 'tirada' : `de ${porcento(margem)} gravada`}`;
      const janela = document.getElementById('janela-produto-analise');
      if (janela?.open && modo === 'categoria') await abrirCategoria(categoriaAberta, `${texto}.`);
      await carregar(texto);
    } catch (erro) {
      mostrarStatus(erro.message, true);
      campo.disabled = false;
    }
  }

  function visiveis() {
    const termo = normalizar(el('pesquisa-termo').value.trim());
    return dados.produtos
      .filter((p) => CURVAS[curvaAtual].filtro(p) && (!papelAtual || p.papel === papelAtual)
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
    el('analise-produtos-titulo').textContent = `${CURVAS[curvaAtual].titulo === 'Todos' ? 'Produtos' : CURVAS[curvaAtual].titulo}`
      + `${papelAtual ? ` · ${PAPEIS[papelAtual].titulo}` : ''} (${inteiro(itens.length)})`;

    const linhas = itens.slice(primeiro, primeiro + porPagina).map((p) => {
      const tr = document.createElement('tr');
      const curva = celula(p.curva ?? '–');
      if (p.curva) curva.firstChild.replaceWith(span(p.curva, `analise-curva analise-curva--${p.curva.toLowerCase()}`));
      if (p.papel) linhaPequena(curva, PAPEIS[p.papel].titulo.toLowerCase());

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
      linhaPequena(preco, [p.aliquota != null ? `imp. ${porcento(p.aliquota, 0)}` : null,
        p.bonificacao ? `${Math.round(p.bonificacao.parcela * 100)}% bonif.` : null].filter(Boolean).join(' · '));

      const giro = linhaPequena(celula(p.vende_a_cada == null ? '–'
        : p.vende_a_cada <= 1 ? 'todo dia' : `a cada ${decimal(p.vende_a_cada)} dias`, 'sem-quebra'),
      p.melhor_dia ? `mais na ${p.melhor_dia.toLowerCase()}` : '');
      // Cobertura e GMROI dependem do saldo: só aparecem com o estoque conferido
      if (dados.reguas.estoque_conferido) {
        linhaPequena(giro, [p.cobertura != null ? `estoque p/ ${inteiro(p.cobertura)} dias` : null,
          p.gmroi != null ? `GMROI ${decimal(p.gmroi)}` : null].filter(Boolean).join(' · '),
        p.cobertura != null && p.cobertura > (dados.reguas.cobertura_alta ?? 90) ? 'qtd negativo' : 'qtd');
      }
      if (dados.reguas.estoque_conferido && p.gmroi != null) giro.title = 'GMROI: lucro bruto do ano ÷ estoque de hoje no custo. Acima de 1, o estoque se paga no ano.';

      const ultima = linhaPequena(celula(dataBR(p.ultima_venda)),
        p.dias_sem_venda ? `há ${plural(p.dias_sem_venda, 'dia', 'dias')}` : '',
        (p.dias_sem_venda ?? 0) > dados.dias ? 'qtd negativo' : 'qtd');

      tr.append(celulaProduto(p), curva, vendido, comparado, margem, preco, celulaVariacoes(p), celulaSugerido(p), giro, ultima,
        celula(quantidade(p.saldo, p.unidade), p.saldo < 0 ? 'negativo' : ''));
      return tr;
    });
    if (!linhas.length) {
      const tr = document.createElement('tr');
      const vazio = celula('Nenhum produto nesta lista.', 'vazio');
      vazio.colSpan = 11;
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

  let detalhe = null;       // o que a API mandou do produto (ou da categoria) aberto
  let modo = 'produto';     // produto ou categoria
  let categoriaAberta = null;
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
    modo = 'produto';
    const dialogo = janelaProduto();
    const p = produto(codigo);
    el('produto-analise-titulo').textContent = p?.descricao ?? `Produto ${codigo}`;
    el('produto-analise-resumo').textContent = `código ${codigo}`;
    el('produto-analise-corpo').replaceChildren();
    el('produto-analise-status').textContent = 'Lendo a venda do produto…';
    if (!dialogo.open) dialogo.showModal();
    try {
      const loja = lojaDoPainel();
      detalhe = await chamar(`/precificacao/analise/produto/${codigo}${loja ? `?loja=${encodeURIComponent(loja)}` : ''}`);
      el('produto-analise-status').textContent = '';
      mostrarProduto();
    } catch (erro) {
      el('produto-analise-status').textContent = erro.message;
    }
  }

  // Tabela das variações de preço: antes e depois de cada mudança, e o resultado
  function tabelaVariacoes(d, ehCategoria) {
    if (!d.variacoes.length) {
      return criar('p', 'explica', 'O preço de varejo não mudou desde que o PROCFIT começou a guardar o histórico (mai/2026).');
    }
    const rolagem = criar('div', 'tabela-rolagem produto-analise-tabela');
    const tabela = criar('table', 'tabela');
    const cabeca = criar('tr');
    const colunas = [['Quando', true], ...(ehCategoria ? [['Produto', true]] : []), ['Preço', false],
      ['Vende por dia', false], ['Venda por dia', false], ['Lucro por dia', false], ['Resultado', true]];
    for (const [texto, esquerda] of colunas) {
      const th = criar('th', esquerda ? 'esquerda' : '', texto);
      th.scope = 'col';
      cabeca.append(th);
    }
    tabela.createTHead().append(cabeca);
    const corpoTabela = tabela.createTBody();
    for (const v of d.variacoes) {
      const tr = criar('tr');
      if (!v.cedo && !v.bom) tr.className = 'linha-vencida';
      const quando = celula(dataBR(v.quando), 'esquerda sem-quebra');
      quando.append(' ', etiquetaTabela(v));
      linhaPequena(quando, [v.quem, v.fora ? 'direto no banco' : null].filter(Boolean).join(' · '));
      const preco = linhaPequena(celula(`${dinheiro(v.antes)} → ${dinheiro(v.depois)}`, 'sem-quebra'),
        comSinal(v.var_preco), v.subiu ? 'qtd negativo' : 'qtd');
      let colunasNumeros;
      if (v.cedo) {
        const vazio = celula('–');
        vazio.colSpan = 3;
        colunasNumeros = [vazio];
      } else {
        const lucroA = v.antes_por_dia.lucro_real ?? v.antes_por_dia.lucro;
        const lucroB = v.depois_por_dia.lucro_real ?? v.depois_por_dia.lucro;
        colunasNumeros = [
          linhaPequena(celula(`${quantidade(v.antes_por_dia.qtd)} → ${quantidade(v.depois_por_dia.qtd)}`, 'sem-quebra'),
            textoEfeito(v), (v.var_qtd ?? 0) < 0 ? 'qtd negativo' : 'qtd'),
          linhaPequena(celula(`${dinheiro(v.antes_por_dia.venda)} → ${dinheiro(v.depois_por_dia.venda)}`, 'sem-quebra'),
            comSinal(v.var_venda), (v.var_venda ?? 0) < 0 ? 'qtd negativo' : 'qtd'),
          linhaPequena(celula(lucroA == null ? '–' : `${dinheiro(lucroA)} → ${dinheiro(lucroB)}`, 'sem-quebra'),
            v.lucro_real ? 'com o custo real' : 'custo do PROCFIT', lucroB != null && lucroA != null && lucroB < lucroA ? 'qtd negativo' : 'qtd'),
        ];
      }
      tr.append(quando,
        ...(ehCategoria ? [celula(nomeClicavel({ codigo: v.produto, descricao: v.descricao }), 'esquerda')] : []),
        preco, ...colunasNumeros, celula(v.resultado, `esquerda analise-acao${v.cedo ? '' : v.bom ? '' : ' negativo'}`));
      corpoTabela.append(tr);
    }
    tabela.append(corpoTabela);
    rolagem.append(tabela);
    return rolagem;
  }

  // Tabela das alterações de venda: cada ponto da série (o mais novo em cima) contra o anterior
  function tabelaAlteracoes(serie, ehCategoria, p) {
    const rolagem = criar('div', 'tabela-rolagem produto-analise-tabela');
    const tabela = criar('table', 'tabela');
    const cabeca = criar('tr');
    const colunas = [['Quando', true], ['Venda', false], ['vs anterior', false],
      ...(ehCategoria ? [] : [['Quantidade', false], ['Preço médio', false]]), ['Lucro real', false], ['Preço', true]];
    for (const [texto, esquerda] of colunas) {
      const th = criar('th', esquerda ? 'esquerda' : '', texto);
      th.scope = 'col';
      cabeca.append(th);
    }
    tabela.createTHead().append(cabeca);
    const corpoTabela = tabela.createTBody();
    const pontos = serie.pontos;
    for (let i = pontos.length - 1; i >= 0; i -= 1) {
      const x = pontos[i];
      const antes = pontos[i - 1];
      const varVenda = antes && antes.venda > 0 ? (x.venda - antes.venda) / antes.venda : null;
      const tr = criar('tr');
      if (serie.queda && i === serie.queda.indice) tr.className = 'linha-vencida';
      if (serie.pico && i === serie.pico.indice) tr.className = 'linha-marcada';
      const mudou = [x.subiu ? `▲ subiu${x.subiu > 1 ? ` ${x.subiu}×` : ''}` : null,
        x.baixou ? `▼ baixou${x.baixou > 1 ? ` ${x.baixou}×` : ''}` : null].filter(Boolean).join(' · ');
      const marca = i === serie.pico?.indice ? 'pico' : i === serie.queda?.indice ? 'maior queda' : i === pontos.length - 1 ? 'correndo' : '';
      tr.append(
        linhaPequena(celula(x.rotulo.replace('sem. ', 'semana de '), 'esquerda sem-quebra'), marca),
        celula(dinheiro(x.venda)),
        celula(varVenda == null ? '–' : comSinal(varVenda), (varVenda ?? 0) < 0 ? 'negativo' : ''),
        ...(ehCategoria ? [] : [celula(quantidade(x.qtd, p.unidade)), celula(x.preco_medio ? dinheiro(x.preco_medio) : '–')]),
        celula(x.lucro_real == null ? '–' : dinheiro(x.lucro_real), (x.lucro_real ?? 0) < 0 ? 'negativo' : ''),
        celula(mudou || '–', `esquerda${x.subiu ? ' negativo' : ''}`),
      );
      corpoTabela.append(tr);
    }
    tabela.append(corpoTabela);
    rolagem.append(tabela);
    return rolagem;
  }

  // Categoria: valor do filtro ("Descartáveis" ou "__sem" para os sem categoria)
  async function abrirCategoria(valor, mensagem) {
    modo = 'categoria';
    categoriaAberta = valor;
    const dialogo = janelaProduto();
    el('produto-analise-titulo').textContent = valor === '__sem' ? 'Produtos sem categoria' : `Categoria ${valor}`;
    el('produto-analise-resumo').textContent = `últimos ${dias} dias`;
    if (!mensagem) el('produto-analise-corpo').replaceChildren();
    el('produto-analise-status').textContent = mensagem ?? 'Lendo a venda da categoria…';
    if (!dialogo.open) dialogo.showModal();
    try {
      const parametros = new URLSearchParams({ nome: valor, dias });
      if (el('analise-tipo').value) parametros.set('tipo', el('analise-tipo').value);
      if (lojaDoPainel()) parametros.set('loja', lojaDoPainel());
      detalhe = await chamar(`/precificacao/analise/categoria?${parametros}`);
      el('produto-analise-status').textContent = mensagem && mensagem.endsWith('…') ? '' : (mensagem ?? '');
      mostrarProduto();
    } catch (erro) {
      el('produto-analise-status').textContent = erro.message;
    }
  }

  // Frase das mudanças de preço perto de um pico ou de uma queda (na categoria, com o nome do produto)
  function textoMudancas(lista) {
    if (!lista?.length) return 'Nenhuma mudança de preço perto dessa data.';
    const mostrar = lista.slice(0, 4);
    return mostrar.map((m) => `${m.descricao ? `${m.descricao}: ` : ''}o preço de ${(m.nome_tabela ?? 'varejo').toLowerCase()} ${m.subiu ? 'subiu' : 'baixou'} `
      + `de ${dinheiro(m.antes)} para ${dinheiro(m.depois)} em ${dataBR(m.quando)}${m.quem ? ` (${m.quem})` : ''}`).join('; ')
      + `${lista.length > mostrar.length ? `; e mais ${lista.length - mostrar.length}` : ''}.`;
  }

  // Lista curta dos produtos que fizeram o pico ou derrubaram a queda (só na categoria)
  function listaDestaques(titulo, itens, texto, classe) {
    const bloco = criar('div', 'produto-analise-destaque');
    bloco.append(criar('h4', null, titulo));
    const ul = criar('ul');
    for (const item of itens) {
      const li = criar('li');
      li.append(nomeClicavel(item), span(` ${texto(item)}`, classe));
      ul.append(li);
    }
    bloco.append(ul);
    return bloco;
  }

  // Precificação da categoria: números, aplicar margem a todos e a tabela de produtos
  function precificacaoCategoria(d) {
    const pr = d.precificacao;
    const area = criar('div', 'produto-analise-precificacao');
    area.append(criar('h3', 'subtitulo', 'Precificação da categoria'));

    const numeros = criar('dl', 'indicadores');
    const numero = (rotulo, valor, nota, alerta) => {
      const dd = criar('dd', alerta ? 'negativo' : '', valor);
      if (nota) dd.append(span(nota));
      numeros.append(criar('dt', null, rotulo), dd);
    };
    const c = d.categoria;
    numero('Margem (PROCFIT)', porcento(c.margem), c.margem_anterior == null ? '' : `era ${porcento(c.margem_anterior)}`,
      (c.margem ?? 0) < 0);
    numero('Margem real', porcento(c.margem_real), `${plural(c.com_bonificacao, 'produto bonificado', 'produtos bonificados')}`,
      (c.margem_real ?? 0) < 0);
    numero('Com margem desejada', `${inteiro(pr.com_margem_desejada)} de ${inteiro(pr.produtos)}`,
      pr.margem_unica != null ? `todos com ${porcento(pr.margem_unica)}` : 'definida por produto');
    numero('Abaixo da desejada', inteiro(pr.abaixo_da_desejada),
      pr.preco_nao_paga_custo ? `${plural(pr.preco_nao_paga_custo, 'preço não paga', 'preços não pagam')} o custo` : '',
      pr.abaixo_da_desejada > 0 || pr.preco_nao_paga_custo > 0);
    area.append(numeros);

    // Aplicar a mesma margem desejada a todos os produtos da categoria (só quem edita preço)
    if (d.pode_editar && d.produtos.length) {
      const lote = criar('div', 'lote produto-analise-lote');
      const campo = criar('input');
      campo.type = 'number';
      campo.min = '0';
      campo.max = String((d.reguas.margem_desejada_maxima ?? 0.6) * 100);
      campo.step = '0.5';
      campo.placeholder = '%';
      campo.setAttribute('aria-label', 'Margem desejada para todos os produtos da categoria (%)');
      if (pr.margem_unica != null) campo.value = String(Math.round(pr.margem_unica * 1000) / 10);
      const aplicar = criar('button', null, `Aplicar aos ${inteiro(d.produtos.length)} produtos`);
      aplicar.type = 'button';
      aplicar.addEventListener('click', async () => {
        const texto = campo.value.trim().replace(',', '.');
        if (texto === '') return;
        const margem = Number(texto) / 100;
        if (!Number.isFinite(margem)) return;
        if (!window.confirm(`Margem desejada de ${porcento(margem)} para os ${inteiro(d.produtos.length)} produtos desta categoria? `
          + 'A margem que cada um tinha é substituída (fica no histórico).')) return;
        aplicar.disabled = true;
        try {
          const codigos = d.produtos.map((p) => p.codigo);
          for (let i = 0; i < codigos.length; i += 500) {
            await chamar('/precificacao/margens', { method: 'PUT', body: JSON.stringify({ produtos: codigos.slice(i, i + 500), margem }) });
          }
          await abrirCategoria(categoriaAberta, `Margem desejada de ${porcento(margem)} gravada em ${plural(codigos.length, 'produto', 'produtos')}.`);
          carregar(); // a aba de trás também muda (preço sugerido e decisões)
        } catch (erro) {
          el('produto-analise-status').textContent = erro.message;
          aplicar.disabled = false;
        }
      });
      lote.append(span('Margem desejada para todos:'), campo, span('%'), aplicar);
      area.append(lote);
    }

    // Produtos da categoria, do que mais vende para o que menos vende
    const rolagem = criar('div', 'tabela-rolagem');
    const tabela = criar('table', 'tabela');
    const cabeca = criar('tr');
    for (const [texto, esquerda] of [['Produto', true], ['Curva', false], ['Vendido', false], ['Margem', false],
      ['Preço e custo', false], ['Preço sugerido', false]]) {
      const th = criar('th', esquerda ? 'esquerda' : '', texto);
      th.scope = 'col';
      cabeca.append(th);
    }
    tabela.createTHead().append(cabeca);
    const corpoTabela = tabela.createTBody();
    for (const p of d.produtos) {
      const tr = criar('tr');
      const margem = linhaPequena(celula(porcento(p.margem), (p.margem ?? 0) < 0 ? 'negativo' : ''),
        [p.margem_anterior != null ? `era ${porcento(p.margem_anterior)}` : null,
          p.custo_real && p.margem_real != null ? `real ${porcento(p.margem_real)}` : null].filter(Boolean).join(' · '));
      const preco = linhaPequena(celula(p.varejo ? dinheiro(p.varejo) : '–'),
        [p.custo_medio ? `custo ${dinheiro(p.custo_medio)}` : null, p.custo_real ? `real ${dinheiro(p.custo_real)}` : null]
          .filter(Boolean).join(' · '));
      const curva = celula(p.curva ?? '–');
      if (p.curva) curva.firstChild.replaceWith(span(p.curva, `analise-curva analise-curva--${p.curva.toLowerCase()}`));
      tr.append(celula(nomeClicavel(p), 'esquerda'), curva,
        linhaPequena(celula(p.venda ? dinheiro(p.venda) : '–'), p.var_venda != null ? comSinal(p.var_venda) : ''),
        margem, preco, celulaSugerido(p, { pode_editar: d.pode_editar, reguas: d.reguas }));
      corpoTabela.append(tr);
    }
    tabela.append(corpoTabela);
    rolagem.append(tabela);
    area.append(rolagem);
    return area;
  }

  function mostrarProduto() {
    const d = detalhe;
    const ehCategoria = modo === 'categoria';
    // Na categoria não existe "um produto": unidade e quantidade não se somam (KG + UN), então não aparecem
    const p = ehCategoria ? { descricao: el('produto-analise-titulo').textContent } : d.produto;
    const qtdTexto = (ponto) => (ehCategoria ? '' : ` (${quantidade(ponto.qtd, p.unidade)})`);
    const serie = d.series[agruparProduto];
    const corpo = el('produto-analise-corpo');

    el('produto-analise-resumo').textContent = ehCategoria
      ? `${plural(d.produtos.length, 'produto', 'produtos')} · venda de ${dinheiro(d.categoria.venda)} nos últimos ${d.dias} dias`
      : [`código ${p.codigo}`, p.varejo ? `varejo ${dinheiro(p.varejo)}` : null,
        p.custo_medio ? `custo ${dinheiro(p.custo_medio)}` : null, p.custo_real ? `real ${dinheiro(p.custo_real)}` : null,
        `estoque no sistema ${quantidade(p.saldo, p.unidade)}`].filter(Boolean).join(' · ');

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
      serie.pico ? `${serie.pico.rotulo}${ehCategoria ? '' : ` · ${quantidade(serie.pico.qtd, p.unidade)}`}` : 'sem venda');
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
        + `${dinheiro(serie.pico.venda)}${qtdTexto(serie.pico)}. ${textoMudancas(serie.pico.mudancas)}`);
    }
    if (serie.queda) {
      frase('queda', 'Maior queda:', `${NOME_PONTO[agruparProduto]} ${serie.queda.rotulo.replace('sem. ', 'de ')} vendeu `
        + `${dinheiro(serie.queda.venda)}, ${comSinal(serie.queda.variacao)} contra o ponto anterior `
        + `(${dinheiro(serie.queda.anterior)}). ${textoMudancas(serie.queda.mudancas)}`);
    }
    frase('correndo', 'Último ponto:', `${NOME_PONTO[agruparProduto]} atual ainda está correndo (vai até hoje), `
      + 'por isso aparece mais claro e não conta como queda.');

    // Categoria: quem fez o pico e quem derrubou a queda (clicar abre o produto)
    const destaques = criar('div', 'produto-analise-destaques');
    if (ehCategoria && serie.pico?.produtos?.length) {
      destaques.append(listaDestaques('Quem fez o pico', serie.pico.produtos, (x) => dinheiro(x.venda), 'qtd'));
    }
    if (ehCategoria && serie.queda?.produtos?.length) {
      destaques.append(listaDestaques('Quem derrubou a queda', serie.queda.produtos,
        (x) => `${dinheiro(x.antes)} → ${dinheiro(x.depois)} (−${dinheiro(x.perdeu)})`, 'qtd negativo'));
    }

    const tituloVariacoes = criar('h3', 'subtitulo', `Variações de preço (${inteiro(d.variacoes.length)})`);
    const variacoes = tabelaVariacoes(d, ehCategoria);
    const tituloVendas = criar('h3', 'subtitulo', `Alterações de venda (${AGRUPAR_PRODUTO[agruparProduto].toLowerCase()})`);
    const vendas = tabelaAlteracoes(serie, ehCategoria, p);

    corpo.replaceChildren(indicadores, botoes, grafico, explica, destaques,
      ...(ehCategoria ? [precificacaoCategoria(d)] : []), tituloVariacoes, variacoes, tituloVendas, vendas);
    graficos.colunas(grafico, {
      titulo: `Venda de ${p.descricao}`,
      // ▲ ▼ no rótulo: o preço subiu ou baixou dentro daquele ponto
      rotulos: serie.pontos.map((x) => `${x.rotulo}${x.subiu ? ' ▲' : ''}${x.baixou ? ' ▼' : ''}`),
      series: [
        { nome: 'Venda', valores: serie.pontos.map((x) => x.venda), cor: 'var(--verde-claro)', cores },
        // Lucro real (com a bonificação); sem custo real, é o do PROCFIT. Lucro negativo não aparece como barra.
        { nome: 'Lucro real', valores: serie.pontos.map((x) => x.lucro_real), cor: 'var(--verde-vivo)' },
      ],
      vazio: 'Sem venda neste período.',
    });
    // O gráfico pode ser mais largo que a janela: abre rolado para o fim (o mais recente)
    requestAnimationFrame(() => {
      const rolagem = grafico.querySelector('.grafico-rolagem');
      if (rolagem) rolagem.scrollLeft = rolagem.scrollWidth;
    });
  }

  // ---------- Ler, mostrar e ligar ----------

  // Lojas que já venderam (hoje uma; as novas entram sozinhas)
  function preencherLojas() {
    const atual = dados.filtros.loja == null ? '' : String(dados.filtros.loja);
    el('analise-loja').replaceChildren(new Option('Todas as lojas', ''),
      ...dados.lojas.map((l) => new Option(l.nome, String(l.codigo))));
    el('analise-loja').value = atual;
  }

  // Loja do painel (menu da esquerda / tela inicial): vale para todas as telas
  const lojaDoPainel = () => modulos.lojaAtual();

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
    mostrarLojas();
    barras('analise-mais-vendidos', dados.mais_vendidos, 'Nenhum produto vendido no período.');
    barras('analise-menos-vendidos', dados.menos_vendidos, 'Nenhum produto vendido no período.');
    mostrarMatriz();
    mostrarCurvas();
    mostrarProdutos();
  }

  const filtrosAtuais = () => `${dias}|${lojaDoPainel()}|${el('analise-categoria').value}|${el('analise-tipo').value}`;

  async function carregar(mensagem, atualizar = false) {
    mostrarStatus('Lendo as vendas no PROCFIT…');
    try {
      const parametros = new URLSearchParams({ dias });
      if (lojaDoPainel()) parametros.set('loja', lojaDoPainel());
      if (el('analise-categoria').value) parametros.set('categoria', el('analise-categoria').value);
      if (el('analise-tipo').value) parametros.set('tipo', el('analise-tipo').value);
      if (atualizar) parametros.set('atualizar', '1');
      dados = await chamar(`/precificacao/analise?${parametros}`);
      lidoCom = filtrosAtuais();
      porCodigo = new Map(dados.produtos.map((p) => [p.codigo, p]));
      preencherCategorias();
      preencherLojas();
      // Sem estoque conferido, as ordens que dependem do saldo saem da lista
      for (const valor of ['gmroi', 'cobertura']) {
        const opcao = el('analise-ordem').querySelector(`option[value="${valor}"]`);
        if (opcao) opcao.hidden = !dados.reguas.estoque_conferido;
      }
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
    // O seletor da aba e o do menu são a mesma escolha
    el('analise-loja').addEventListener('change', () => { pagina = 1; modulos.escolherLoja(el('analise-loja').value); });
    modulos.aoMudarLoja(() => {
      pagina = 1;
      if (!el('aba-analise').hidden) carregar(); // nas outras abas, lê de novo ao voltar (desatualizado)
    });
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
