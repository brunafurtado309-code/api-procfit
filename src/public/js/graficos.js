// Gráficos do painel (SVG puro, sem biblioteca externa).
// Seguem o DESIGN.md: só verdes, laranja para alerta, texto legível e sem caixas.
//
// Uso:
//   graficos.colunas(elemento, { rotulos, series: [{ nome, valores, cor }], formato, empilhado })
//   graficos.rosca(elemento, { itens: [{ nome, valor }], formato, centro })
// Cada barra/fatia tem uma dica (title) com o valor exato ao passar o mouse.
// Os gráficos se ajustam à largura do elemento (viewBox + preserveAspectRatio).

const graficos = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  // Cores do padrão (as mesmas variáveis do style.css)
  const CORES = ['var(--verde)', 'var(--verde-vivo)', 'var(--verde-claro)', 'var(--verde-escuro)',
    'var(--verde-medio)', '#A7D8BA', '#5E7D6A'];
  const ALERTA = 'var(--alerta)';

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const FORMATOS = {
    moeda: (v) => moeda.format(Number(v) || 0),
    // Eixo: R$ 1,2 mi / R$ 350 mil / R$ 800
    moedaCurta: (v) => {
      const n = Number(v) || 0;
      if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1).replace('.', ',')} mi`;
      if (Math.abs(n) >= 1e3) return `R$ ${Math.round(n / 1e3)} mil`;
      return `R$ ${Math.round(n)}`;
    },
    inteiro: (v) => (Number(v) || 0).toLocaleString('pt-BR'),
  };

  function criar(tag, atributos = {}, texto) {
    const no = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(atributos)) no.setAttribute(k, v);
    if (texto !== undefined) no.textContent = texto;
    return no;
  }

  // Um "bonito" máximo para o eixo (1, 2, 2.5, 5 × 10^n)
  function escala(maximo) {
    if (!(maximo > 0)) return 1;
    const potencia = 10 ** Math.floor(Math.log10(maximo));
    for (const passo of [1, 2, 2.5, 5, 10]) {
      if (passo * potencia >= maximo) return passo * potencia;
    }
    return 10 * potencia;
  }

  function legenda(series) {
    const lista = document.createElement('ul');
    lista.className = 'grafico-legenda';
    for (const s of series) {
      const item = document.createElement('li');
      const amostra = document.createElement('span');
      amostra.className = 'grafico-legenda__cor';
      amostra.style.background = s.cor;
      item.append(amostra, s.nome);
      lista.append(item);
    }
    return lista;
  }

  // Colunas por categoria (dia, semana, mês). Várias séries: lado a lado ou empilhadas.
  function colunas(alvo, opcoes) {
    const { rotulos, empilhado = false, altura = 260 } = opcoes;
    const formato = FORMATOS[opcoes.formato ?? 'moeda'];
    const formatoEixo = opcoes.formato === 'inteiro' ? FORMATOS.inteiro : FORMATOS.moedaCurta;
    const series = opcoes.series.map((s, i) => ({ ...s, cor: s.cor ?? CORES[i % CORES.length] }));
    // Desenha na largura real do espaço (texto sempre no mesmo tamanho). Se o espaço ainda
    // está escondido (largura 0), espera o próximo quadro para desenhar.
    const disponivel = alvo.clientWidth;
    if (!disponivel && (opcoes.tentativas ?? 0) < 20) {
      requestAnimationFrame(() => colunas(alvo, { ...opcoes, tentativas: (opcoes.tentativas ?? 0) + 1 }));
      return;
    }
    alvo.replaceChildren();
    if (!rotulos.length) {
      const vazio = document.createElement('p');
      vazio.className = 'explica';
      vazio.textContent = opcoes.vazio ?? 'Sem dados no período.';
      alvo.append(vazio);
      return;
    }

    const minimo = rotulos.length * (empilhado ? 30 : 16 * series.length + 14) + 90;
    const largura = Math.max(disponivel || 640, minimo);
    const margem = { topo: 16, direita: 12, baixo: 44, esquerda: 72 };
    const areaL = largura - margem.esquerda - margem.direita;
    const areaA = altura - margem.topo - margem.baixo;

    const totais = rotulos.map((_, i) => (empilhado
      ? series.reduce((t, s) => t + Math.max(0, Number(s.valores[i]) || 0), 0)
      : Math.max(...series.map((s) => Number(s.valores[i]) || 0))));
    const topo = escala(Math.max(...totais, 0));
    const y = (v) => margem.topo + areaA - (Math.max(0, v) / topo) * areaA;

    const svg = criar('svg', {
      viewBox: `0 0 ${largura} ${altura}`, width: largura, height: altura, class: 'grafico', role: 'img',
      'aria-label': opcoes.titulo ?? 'Gráfico de colunas',
    });

    // Linhas de grade e valores do eixo
    for (let k = 0; k <= 4; k += 1) {
      const valor = (topo / 4) * k;
      const yy = y(valor);
      svg.append(criar('line', { x1: margem.esquerda, x2: largura - margem.direita, y1: yy, y2: yy, class: 'grafico-grade' }));
      svg.append(criar('text', { x: margem.esquerda - 8, y: yy + 4, class: 'grafico-eixo', 'text-anchor': 'end' }, formatoEixo(valor)));
    }

    const faixa = areaL / rotulos.length;
    const larguraColuna = empilhado ? Math.min(40, faixa * 0.7) : Math.min(24, (faixa * 0.8) / series.length);
    // Mostra no máximo ~14 rótulos no eixo para não embolar
    const saltoRotulo = Math.max(1, Math.ceil(rotulos.length / 14));

    rotulos.forEach((rotulo, i) => {
      const x0 = margem.esquerda + faixa * i + faixa / 2;
      let acumulado = 0;
      series.forEach((s, j) => {
        const valor = Math.max(0, Number(s.valores[i]) || 0);
        const x = empilhado ? x0 - larguraColuna / 2 : x0 - (larguraColuna * series.length) / 2 + larguraColuna * j;
        const base = empilhado ? acumulado : 0;
        const yTopo = y(base + valor);
        const alturaBarra = y(base) - yTopo;
        acumulado += valor;
        if (alturaBarra <= 0) return;
        const barra = criar('rect', {
          x, y: yTopo, width: Math.max(1, larguraColuna - (empilhado ? 0 : 2)), height: alturaBarra,
          rx: 3, class: 'grafico-barra', style: `fill:${s.cor}`,
        });
        barra.append(criar('title', {}, `${rotulo} · ${s.nome}: ${formato(valor)}`));
        svg.append(barra);
      });
      if (i % saltoRotulo === 0) {
        svg.append(criar('text', { x: x0, y: altura - margem.baixo + 18, class: 'grafico-eixo', 'text-anchor': 'middle' }, rotulo));
      }
    });

    const rolagem = document.createElement('div');
    rolagem.className = 'grafico-rolagem';
    rolagem.append(svg);
    alvo.append(rolagem);
    if (series.length > 1) alvo.append(legenda(series));
  }

  // Rosca de composição (grupos de despesa, classes de crédito...). Fatias pequenas viram "Outros".
  function rosca(alvo, opcoes) {
    const formato = FORMATOS[opcoes.formato ?? 'moeda'];
    const maximoFatias = opcoes.maximoFatias ?? 6;
    let itens = opcoes.itens.filter((i) => Number(i.valor) > 0).sort((a, b) => b.valor - a.valor);
    if (itens.length > maximoFatias) {
      const resto = itens.slice(maximoFatias - 1).reduce((t, i) => t + Number(i.valor), 0);
      itens = [...itens.slice(0, maximoFatias - 1), { nome: 'Outros', valor: resto }];
    }
    itens = itens.map((item, i) => ({ ...item, cor: item.cor ?? CORES[i % CORES.length] }));
    alvo.replaceChildren();
    if (!itens.length) {
      const vazio = document.createElement('p');
      vazio.className = 'explica';
      vazio.textContent = opcoes.vazio ?? 'Sem dados no período.';
      alvo.append(vazio);
      return;
    }
    const total = itens.reduce((t, i) => t + Number(i.valor), 0);
    const tamanho = 220;
    const raio = 96;
    const espessura = 34;
    const svg = criar('svg', {
      viewBox: `0 0 ${tamanho} ${tamanho}`, class: 'grafico grafico--rosca', role: 'img',
      'aria-label': opcoes.titulo ?? 'Gráfico de composição',
    });
    const centro = tamanho / 2;
    const circunferencia = 2 * Math.PI * (raio - espessura / 2);
    let deslocamento = 0;
    for (const item of itens) {
      const fracao = Number(item.valor) / total;
      const circulo = criar('circle', {
        cx: centro, cy: centro, r: raio - espessura / 2, fill: 'none',
        style: `stroke:${item.cor}`, 'stroke-width': espessura,
        'stroke-dasharray': `${fracao * circunferencia} ${circunferencia}`,
        'stroke-dashoffset': -deslocamento * circunferencia,
        transform: `rotate(-90 ${centro} ${centro})`, class: 'grafico-fatia',
      });
      circulo.append(criar('title', {}, `${item.nome}: ${formato(item.valor)} (${Math.round(fracao * 100)}%)`));
      svg.append(circulo);
      deslocamento += fracao;
    }
    if (opcoes.centro !== false) {
      svg.append(criar('text', { x: centro, y: centro - 4, 'text-anchor': 'middle', class: 'grafico-centro' },
        opcoes.centro ?? FORMATOS.moedaCurta(total)));
      svg.append(criar('text', { x: centro, y: centro + 16, 'text-anchor': 'middle', class: 'grafico-eixo' },
        opcoes.rotuloCentro ?? 'total'));
    }

    const conteudo = document.createElement('div');
    conteudo.className = 'grafico-rosca';
    const lista = document.createElement('ul');
    lista.className = 'grafico-rosca__lista';
    for (const item of itens) {
      const li = document.createElement('li');
      const amostra = document.createElement('span');
      amostra.className = 'grafico-legenda__cor';
      amostra.style.background = item.cor;
      const nome = document.createElement('span');
      nome.className = 'grafico-rosca__nome';
      nome.textContent = item.nome;
      const valor = document.createElement('strong');
      valor.textContent = `${formato(item.valor)} · ${Math.round((Number(item.valor) / total) * 100)}%`;
      li.append(amostra, nome, valor);
      lista.append(li);
    }
    conteudo.append(svg, lista);
    alvo.append(conteudo);
  }

  return { colunas, rosca, CORES, ALERTA, FORMATOS };
})();
