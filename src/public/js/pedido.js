// Janela do pedido: abre ao clicar em qualquer nº de pedido, nas telas de vendas e financeiro.
//
// Uso nas telas:
//   pedidoJanela.configurar({ setor: 'financeiro' })   // de qual setor a chave vem
//   celula.append(pedidoJanela.link(4313))             // nº clicável
//   pedidoJanela.link(4313, 'pedido')                  // com rótulo: "pedido 4313"
//
// A janela é criada aqui mesmo (não precisa de HTML na página), para ficar igual nas duas telas.

const pedidoJanela = (() => {
  let setor = 'vendas';

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const quantidade = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  const dataHoraBR = (texto) => {
    if (!texto) return '—';
    const [data, hora] = String(texto).split(' ');
    return `${data.split('-').reverse().join('/')}${hora ? ` às ${hora}` : ''}`;
  };
  const criar = (tag, classe, texto) => {
    const elemento = document.createElement(tag);
    if (classe) elemento.className = classe;
    if (texto !== undefined && texto !== null) elemento.textContent = texto;
    return elemento;
  };

  function configurar(opcoes = {}) {
    if (opcoes.setor) setor = opcoes.setor;
  }

  // Monta a janela uma única vez e reaproveita
  function janela() {
    let dialogo = document.getElementById('janela-pedido');
    if (dialogo) return dialogo;

    dialogo = criar('dialog', 'detalhe detalhe--pedido');
    dialogo.id = 'janela-pedido';
    dialogo.setAttribute('aria-labelledby', 'pedido-titulo');

    const topo = criar('header', 'detalhe__topo');
    const textos = criar('div');
    const titulo = criar('h2', null, 'Pedido');
    titulo.id = 'pedido-titulo';
    const resumo = criar('p', 'detalhe__resumo');
    resumo.id = 'pedido-resumo';
    textos.append(titulo, resumo);
    const acoes = criar('div', 'detalhe__acoes');
    const fechar = criar('button', 'botao-secundario', 'Fechar');
    fechar.type = 'button';
    fechar.addEventListener('click', () => dialogo.close());
    acoes.append(fechar);
    topo.append(textos, acoes);

    const status = criar('p', 'status');
    status.id = 'pedido-status';
    status.setAttribute('role', 'status');
    const corpo = criar('div', 'detalhe__corpo pedido-corpo');
    corpo.id = 'pedido-corpo';

    dialogo.append(topo, status, corpo);
    document.body.append(dialogo);
    return dialogo;
  }

  // Nº do pedido clicável. Sem número, devolve um traço.
  function link(numero, rotulo = '') {
    if (numero === null || numero === undefined || numero === '' || Number(numero) === 0) {
      return document.createTextNode(rotulo ? '' : '—');
    }
    const botao = criar('button', 'link-pedido', rotulo ? `${rotulo} ${numero}` : String(numero));
    botao.type = 'button';
    botao.title = 'Ver os produtos do pedido';
    botao.addEventListener('click', (evento) => {
      evento.stopPropagation(); // não dispara o clique da linha/cartão onde o link está
      abrir(numero);
    });
    return botao;
  }

  async function abrir(numero) {
    const dialogo = janela();
    document.getElementById('pedido-titulo').textContent = `Pedido ${numero}`;
    document.getElementById('pedido-resumo').textContent = '';
    const status = document.getElementById('pedido-status');
    const corpo = document.getElementById('pedido-corpo');
    status.textContent = 'Carregando o pedido…';
    status.classList.remove('status--erro');
    corpo.replaceChildren();
    if (!dialogo.open) dialogo.showModal();

    try {
      const resposta = await fetch(`/${setor}/pedidos/${encodeURIComponent(numero)}`, {
        headers: { 'x-api-key': sessionStorage.getItem('apiKey') ?? '' },
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível abrir o pedido.');
      status.textContent = '';
      desenhar(dados);
    } catch (erro) {
      status.textContent = erro.message;
      status.classList.add('status--erro');
    }
  }

  function desenhar({ pedido: p, produtos, notas, cupons }) {
    const cliente = [p.codigo_cliente, p.cliente].filter(Boolean).join(' · ');
    document.getElementById('pedido-resumo').textContent =
      p.fantasia && p.fantasia !== p.cliente ? `${cliente} (${p.fantasia})` : cliente;

    // Dados do pedido em linha, sem caixas
    const dados = criar('dl', 'pedido-dados');
    const item = (rotulo, valor) => {
      const bloco = criar('div');
      bloco.append(criar('dt', null, rotulo), criar('dd', null, valor || '—'));
      dados.append(bloco);
    };
    item('Data', dataHoraBR(p.data_hora));
    item('Vendedor', [p.codigo_vendedor, p.vendedor].filter(Boolean).join(' · '));
    item('Tabela de preço', p.tabela_preco);
    item('Situação', p.cancelado ? 'Cancelado' : (p.status || 'Em aberto'));
    item('Nota fiscal', notas.length ? notas.map((n) => `NF ${n}`).join(', ') : 'nenhuma');
    item('Cupom', cupons.length
      ? cupons.map((c) => `${c.cupom} (caixa ${c.caixa})`).join(', ')
      : 'nenhum');
    item('Empresa', p.empresa != null ? String(p.empresa) : null);
    if (p.cnpj_cpf) item('CNPJ/CPF', p.cnpj_cpf);

    const partes = [dados];
    if (p.observacao && p.observacao.trim()) {
      partes.push(criar('p', 'pedido-obs', `Observação: ${p.observacao.trim()}`));
    }

    // Produtos
    partes.push(criar('h3', null, `Produtos (${produtos.length})`));
    const rolagem = criar('div', 'tabela-rolagem');
    const tabela = criar('table', 'tabela tabela--pedido');
    const cabecalho = criar('tr');
    for (const [titulo, esquerda] of [['Código', true], ['Descrição', true], ['Qtd.'], ['Preço'],
      ['Bruto'], ['Desconto'], ['Total']]) {
      const th = criar('th', esquerda ? 'esquerda' : null, titulo);
      th.scope = 'col';
      cabecalho.append(th);
    }
    tabela.append(criar('thead'));
    tabela.tHead.append(cabecalho);

    const corpoTabela = criar('tbody');
    if (produtos.length === 0) {
      const linha = criar('tr');
      const td = criar('td', 'vazio', 'Nenhum produto neste pedido.');
      td.colSpan = 7;
      linha.append(td);
      corpoTabela.append(linha);
    }
    for (const produto of produtos) {
      const linha = criar('tr');
      const desconto = Number(produto.desconto) || 0;
      linha.append(
        criar('td', 'esquerda coluna-codigo', produto.produto),
        criar('td', 'esquerda', produto.descricao ?? '—'),
        criar('td', null, quantidade.format(produto.quantidade ?? 0)),
        criar('td', null, moeda.format(produto.preco ?? 0)),
        criar('td', null, moeda.format(produto.bruto ?? 0)),
        criar('td', desconto > 0 ? 'desconto-destaque' : null, desconto > 0 ? moeda.format(desconto) : '—'),
        criar('td', null, moeda.format(produto.total ?? 0)),
      );
      corpoTabela.append(linha);
    }
    tabela.append(corpoTabela);

    // Rodapé: totais do pedido (PEDIDOS_PREVENDAS_TOTAIS); sem eles, soma dos produtos
    const somar = (campo) => produtos.reduce((s, x) => s + (Number(x[campo]) || 0), 0);
    const rodape = criar('tfoot');
    const linhaTotal = criar('tr');
    const rotuloTotal = criar('td', 'esquerda', 'Total do pedido');
    rotuloTotal.colSpan = 4;
    linhaTotal.append(
      rotuloTotal,
      criar('td', null, moeda.format(p.bruto ?? somar('bruto'))),
      criar('td', null, moeda.format(p.desconto ?? somar('desconto'))),
      criar('td', null, moeda.format(p.total ?? somar('total'))),
    );
    rodape.append(linhaTotal);
    tabela.append(rodape);
    rolagem.append(tabela);
    partes.push(rolagem);

    document.getElementById('pedido-corpo').replaceChildren(...partes);
  }

  return { configurar, link, abrir };
})();
