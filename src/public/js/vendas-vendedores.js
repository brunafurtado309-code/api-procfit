// Vendas > Vendedores: controle do gestor por vendedor.
// Faturado em nota, pedidos em orçamento, pedidos cancelados, notas de devolução canceladas e
// notas que parecem duplicadas. Os dados vêm de /vendas/controle-vendedores
// (src/services/vendas-vendedores.service.js), numa consulta leve. Cada bloco é desenhado
// separado: se um der problema, os outros aparecem.
// Usa o que o app.js já tem: buscar, moeda, inteiro, el, contar, dataBR, abrirFatVendedor, cargaAtual.

const vendasVendedores = (() => {
  // Linhas por vez nas listas (botão "Mostrar mais"): menos no celular, onde cada linha vira um cartão
  const POR_VEZ = window.matchMedia('(max-width: 720px)').matches ? 15 : 50;
  let dados = null;
  const mostrando = { orcamentos: POR_VEZ, cancelados: POR_VEZ };

  const dinheiro = (v) => moeda.format(Number(v) || 0);
  const nomeVendedor = (x) => x.vendedor || (x.cod_vendedor != null ? `Vendedor ${x.cod_vendedor}` : 'Sem vendedor');
  const nomeCliente = (x) => x.cliente || (x.cod_cliente != null ? `Cliente ${x.cod_cliente}` : '—');

  function td(conteudo, classe, auxiliar) {
    const c = document.createElement('td');
    if (classe) c.className = classe;
    if (conteudo instanceof Node) c.append(conteudo);
    else c.textContent = conteudo ?? '—';
    if (auxiliar) {
      const s = document.createElement('span');
      s.className = 'qtd';
      s.textContent = auxiliar;
      c.append(s);
    }
    return c;
  }

  function cabecalho(tabela, titulos) {
    const tr = document.createElement('tr');
    for (const [texto, esquerda] of titulos) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = texto;
      if (esquerda) th.className = 'esquerda';
      tr.append(th);
    }
    tabela.tHead.replaceChildren(tr);
  }

  // No celular as linhas viram cartões: cada célula ganha o nome da coluna
  function rotular(tabela) {
    const nomes = [...tabela.tHead.rows[0].cells].map((th) => th.textContent.trim());
    const linhas = [...tabela.tBodies[0].rows, ...(tabela.tFoot ? tabela.tFoot.rows : [])];
    for (const linha of linhas) {
      let coluna = 0;
      for (const celula of linha.cells) {
        if (nomes[coluna]) celula.dataset.rotulo = nomes[coluna];
        coluna += celula.colSpan || 1;
      }
    }
  }

  function vazio(tabela, texto, colunas) {
    const tr = document.createElement('tr');
    const c = td(texto, 'vazio');
    c.colSpan = colunas;
    tr.append(c);
    tabela.tBodies[0].replaceChildren(tr);
    tabela.tFoot?.replaceChildren();
  }

  function parte(nome, desenhar) {
    try {
      desenhar();
    } catch (erro) {
      console.error(`Vendas > Vendedores: falha ao montar "${nome}"`, erro);
    }
  }

  function linkPedido(numero) {
    return typeof pedidoJanela !== 'undefined' && numero != null ? pedidoJanela.link(numero) : (numero ?? '—');
  }

  // ---------- Faturamento por vendedor ----------
  function mostrarVendedores() {
    const tabela = el('cv-tabela-vendedores');
    cabecalho(tabela, [['Vendedor', true], ['Faturado em nota'], ['Devolvido'], ['Líquido'],
      ['Em orçamento'], ['Cancelados'], ['Atenção', true]]);
    const lista = dados.vendedores.filter((v) => Number(v.notas) || Number(v.orcamentos) || Number(v.cancelados));
    if (!lista.length) {
      vazio(tabela, 'Nenhuma nota nem pedido no período.', 7);
      return;
    }
    tabela.tBodies[0].replaceChildren(...lista.map((v) => {
      const tr = document.createElement('tr');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'link-pedido';
      botao.textContent = nomeVendedor(v);
      botao.title = 'Ver os pedidos deste vendedor';
      botao.addEventListener('click', () => abrirFatVendedor(v));
      const avisos = [];
      if (Number(v.duplicadas)) avisos.push(contar(v.duplicadas, 'nota duplicada?', 'notas duplicadas?'));
      if (Number(v.devolucoes_canceladas)) avisos.push(contar(v.devolucoes_canceladas, 'devolução cancelada', 'devoluções canceladas'));
      const devolvido = Number(v.devolvido) || 0;
      tr.append(
        td(botao, 'esquerda cel-titulo'),
        td(Number(v.notas) ? dinheiro(v.valor) : '—', null, Number(v.notas) ? contar(v.notas, 'nota', 'notas') : null),
        td(devolvido > 0.009 ? dinheiro(devolvido) : '—', devolvido > 0.009 ? 'negativo' : null,
          Number(v.notas_devolvidas) ? contar(v.notas_devolvidas, 'nota', 'notas') : null),
        td(Number(v.notas) ? dinheiro(v.liquido) : '—', 'coluna-final'),
        td(Number(v.orcamentos) ? dinheiro(v.valor_orcamentos) : '—', null,
          Number(v.orcamentos) ? contar(v.orcamentos, 'pedido', 'pedidos') : null),
        td(Number(v.cancelados) ? dinheiro(v.valor_cancelados) : '—', Number(v.cancelados) ? 'negativo' : null,
          Number(v.cancelados) ? contar(v.cancelados, 'pedido', 'pedidos') : null),
        td(avisos.length ? avisos.join(' · ') : '', `esquerda cel-largo${avisos.length ? ' cv-atencao' : ''}`),
      );
      return tr;
    }));
    const soma = (campo) => lista.reduce((t, v) => t + (Number(v[campo]) || 0), 0);
    const total = document.createElement('tr');
    total.append(
      td(`Total (${contar(lista.length, 'vendedor', 'vendedores')})`, 'esquerda cel-titulo'),
      td(dinheiro(soma('valor')), null, contar(soma('notas'), 'nota', 'notas')),
      td(dinheiro(soma('devolvido'))),
      td(dinheiro(soma('liquido'))),
      td(dinheiro(soma('valor_orcamentos')), null, contar(soma('orcamentos'), 'pedido', 'pedidos')),
      td(dinheiro(soma('valor_cancelados')), null, contar(soma('cancelados'), 'pedido', 'pedidos')),
      td(''),
    );
    tabela.tFoot.replaceChildren(total);
    rotular(tabela);
  }

  // ---------- Listas de pedidos (orçamento e cancelados) ----------
  function mostrarPedidos(tipo) {
    const ehOrcamento = tipo === 'orcamentos';
    const tabela = el(ehOrcamento ? 'cv-tabela-orcamentos' : 'cv-tabela-cancelados');
    const lista = dados[tipo];
    const total = ehOrcamento ? dados.totalOrcamentos : dados.totalCancelados;
    el(ehOrcamento ? 'titulo-cv-orcamentos' : 'titulo-cv-cancelados').textContent =
      `${ehOrcamento ? 'Pedidos em orçamento' : 'Pedidos cancelados'} (${inteiro.format(total)})`;
    cabecalho(tabela, ehOrcamento
      ? [['Pedido', true], ['Dia', true], ['Cliente', true], ['Vendedor', true], ['Situação', true], ['Parado há'], ['Valor']]
      : [['Pedido', true], ['Dia do pedido', true], ['Cliente', true], ['Vendedor', true], ['Cancelado em', true], ['Valor']]);
    const botaoMais = el(ehOrcamento ? 'cv-mais-orcamentos' : 'cv-mais-cancelados');
    if (!lista.length) {
      vazio(tabela, ehOrcamento ? 'Nenhum pedido em orçamento no período.' : 'Nenhum pedido cancelado no período.', 7);
      botaoMais.hidden = true;
      return;
    }
    const visiveis = lista.slice(0, mostrando[tipo]);
    tabela.tBodies[0].replaceChildren(...visiveis.map((p) => {
      const tr = document.createElement('tr');
      tr.append(
        td(linkPedido(p.pedido), 'esquerda sem-quebra cel-titulo'),
        td(dataBR(p.dia), 'esquerda sem-quebra'),
        td(nomeCliente(p), 'esquerda cel-largo'),
        td(nomeVendedor(p), 'esquerda cel-largo'),
      );
      if (ehOrcamento) {
        const dias = Number(p.dias) || 0;
        tr.append(
          td(p.situacao === 'aprovacao' ? 'Pendente de aprovação' : 'Orçamento', 'esquerda'),
          td(dias === 0 ? 'hoje' : contar(dias, 'dia', 'dias'), dias > 7 ? 'negativo' : null),
          td(dinheiro(p.valor), 'coluna-final'),
        );
      } else {
        tr.append(
          td(p.cancelado_em ? `${dataBR(p.cancelado_em.slice(0, 10))} ${p.cancelado_em.slice(11, 16)}` : 'status Cancelado', 'esquerda sem-quebra'),
          td(dinheiro(p.valor), 'negativo'),
        );
      }
      return tr;
    }));
    const soma = lista.reduce((t, p) => t + (Number(p.valor) || 0), 0);
    const rodape = document.createElement('tr');
    const rotulo = td(`Total${total > lista.length ? ` dos ${inteiro.format(lista.length)} maiores` : ''}`, 'esquerda cel-titulo');
    rotulo.colSpan = ehOrcamento ? 6 : 5;
    rodape.append(rotulo, td(dinheiro(soma)));
    tabela.tFoot.replaceChildren(rodape);
    rotular(tabela);
    const restam = lista.length - visiveis.length;
    botaoMais.hidden = restam <= 0;
    botaoMais.textContent = `Mostrar mais ${Math.min(POR_VEZ, restam)} (faltam ${inteiro.format(restam)})`;
  }

  // ---------- Devoluções canceladas ----------
  function mostrarDevolucoesCanceladas() {
    const tabela = el('cv-tabela-devcanceladas');
    const lista = dados.devolucoesCanceladas;
    el('titulo-cv-devcanceladas').textContent = `Notas de devolução canceladas (${inteiro.format(lista.length)})`;
    cabecalho(tabela, [['NF de devolução', true], ['Devolução em', true], ['Cancelada em', true],
      ['Nota original', true], ['Cliente', true], ['Vendedor', true], ['Valor']]);
    if (!lista.length) {
      vazio(tabela, 'Nenhuma devolução cancelada no período.', 7);
      return;
    }
    tabela.tBodies[0].replaceChildren(...lista.map((d) => {
      const tr = document.createElement('tr');
      tr.append(
        td(`NF ${d.nota_devolucao ?? '—'}`, 'esquerda sem-quebra cel-titulo'),
        td(dataBR(d.devolucao_dia), 'esquerda sem-quebra'),
        td(d.cancelado_em ? `${dataBR(d.cancelado_em.slice(0, 10))} ${d.cancelado_em.slice(11, 16)}` : '—', 'esquerda sem-quebra',
          d.com_protocolo ? null : 'sem protocolo da SEFAZ'),
        td(d.nota_origem != null ? `NF ${d.nota_origem}` : '—', 'esquerda sem-quebra'),
        td(nomeCliente(d), 'esquerda cel-largo'),
        td(nomeVendedor(d), 'esquerda cel-largo'),
        td(dinheiro(d.valor)),
      );
      return tr;
    }));
    rotular(tabela);
  }

  // ---------- Notas duplicadas ----------
  function mostrarDuplicadas() {
    const secao = el('cv-duplicadas');
    const notas = dados.duplicadas;
    secao.hidden = !notas.length;
    if (!notas.length) return;
    const grupos = new Map();
    for (const n of notas) {
      const k = `${n.motivo}|${n.grupo}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(n);
    }
    el('titulo-cv-duplicadas').textContent = `Notas que parecem duplicadas (${contar(grupos.size, 'caso', 'casos')})`;
    const tabela = el('cv-tabela-duplicadas');
    cabecalho(tabela, [['Notas', true], ['Dia', true], ['Cliente', true], ['Vendedor', true], ['Motivo', true], ['Valor de cada'], ['Valor somado']]);
    tabela.tBodies[0].replaceChildren(...[...grupos.values()].map((g) => {
      const n = g[0];
      const numeros = document.createElement('span');
      g.forEach((x, i) => {
        if (i) numeros.append(', ');
        const nf = document.createElement('span');
        nf.textContent = `NF ${x.nota}`;
        if (!x.conta_como_venda) {
          nf.className = 'cv-fora';
          nf.title = 'O PROCFIT não conta esta nota como venda (não está como venda na VENDAS_ANALITICAS)';
        }
        numeros.append(nf);
      });
      const vendedores = [...new Set(g.map(nomeVendedor))].join(', ');
      const tr = document.createElement('tr');
      tr.append(
        td(numeros, 'esquerda cel-titulo'),
        td(dataBR(n.dia), 'esquerda sem-quebra'),
        td(nomeCliente(n), 'esquerda cel-largo'),
        td(vendedores, 'esquerda cel-largo'),
        td(n.motivo === 'pedido' ? `Mesmo pedido (${n.pedido})` : 'Mesmo cliente, dia e valor', 'esquerda'),
        td(dinheiro(n.valor)),
        td(dinheiro(g.reduce((t, x) => t + (Number(x.valor) || 0), 0)), 'negativo'),
      );
      return tr;
    }));
    rotular(tabela);
  }

  function desenhar() {
    el('cv-aviso-notas').hidden = !dados.erros?.notas;
    el('cv-aviso-notas').textContent = dados.erros?.notas ? `Faturado em nota: ${dados.erros.notas}` : '';
    el('cv-aviso-pedidos').hidden = !dados.erros?.pedidos;
    el('cv-aviso-pedidos').textContent = dados.erros?.pedidos ? `Orçamentos e cancelados: ${dados.erros.pedidos}` : '';
    parte('duplicadas', mostrarDuplicadas);
    parte('vendedores', mostrarVendedores);
    parte('orcamentos', () => mostrarPedidos('orcamentos'));
    parte('cancelados', () => mostrarPedidos('cancelados'));
    parte('devolucoes canceladas', mostrarDevolucoesCanceladas);
  }

  async function carregar(filtros, minhaCarga) {
    const status = el('cv-status');
    status.classList.remove('status--erro');
    status.textContent = 'Carregando o controle por vendedor…';
    try {
      const resposta = await buscar('controle-vendedores', filtros);
      if (minhaCarga !== cargaAtual) return;
      dados = resposta;
      mostrando.orcamentos = POR_VEZ;
      mostrando.cancelados = POR_VEZ;
      desenhar();
      status.textContent = '';
    } catch (erro) {
      if (minhaCarga !== cargaAtual || erro instanceof ChaveInvalida) return;
      status.textContent = erro.message;
      status.classList.add('status--erro');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const tipo of ['orcamentos', 'cancelados']) {
      el(`cv-mais-${tipo}`).addEventListener('click', () => {
        mostrando[tipo] += POR_VEZ;
        parte(tipo, () => mostrarPedidos(tipo));
      });
    }
  });

  return { carregar };
})();
