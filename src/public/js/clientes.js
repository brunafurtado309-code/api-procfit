// Clientes e crédito (contas a receber). Mesma chave de acesso do financeiro.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const compacto = (valor) => {
  const v = Number(valor) || 0;
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(2).replace('.', ',')} mi`;
  if (Math.abs(v) >= 1e4) return `R$ ${(v / 1e3).toFixed(1).replace('.', ',')} mil`;
  return dinheiro(v);
};

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

const CLASSES = {
  A: { titulo: 'A · paga em dia', curto: 'A', classe: 'situacao--faturada' },
  B: { titulo: 'B · atrasa pouco', curto: 'B', classe: 'situacao--cancelada' },
  C: { titulo: 'C · atrasa bastante', curto: 'C', classe: 'situacao--devolucao' },
  D: { titulo: 'D · vencido +60 dias', curto: 'D', classe: 'situacao--sem' },
  N: { titulo: 'Sem histórico', curto: 'Novo', classe: 'situacao--cancelada' },
};

// ===== Estado =====
let clientes = [];
let filtroClasse = null;     // 'A' | 'B' | 'C' | 'D' | 'N' | null
let soRisco = false;         // em atraso e ainda comprando
let ordem = { coluna: 'aberto', direcao: 'desc' };

// ===== API =====
async function buscar(rota, parametros = {}) {
  const url = new URL(`/financeiro/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.href = 'financeiro.html';
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Esta chave não tem acesso ao financeiro.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

function span(texto, classe) {
  const s = document.createElement('span');
  s.textContent = texto;
  if (classe) s.className = classe;
  return s;
}

function td(conteudo, classe) {
  const celula = document.createElement('td');
  if (classe) celula.className = classe;
  if (conteudo instanceof Node) celula.append(conteudo);
  else celula.textContent = conteudo ?? '—';
  return celula;
}

function comAuxiliar(texto, auxiliar, classe, classeAuxiliar = 'qtd') {
  const celula = td(texto, classe);
  if (auxiliar) celula.append(span(auxiliar, classeAuxiliar));
  return celula;
}

// ===== Carregar =====
async function carregar() {
  estado.salvar('clientes', { busca: el('pesquisa-termo').value.trim(), classe: filtroClasse, risco: soRisco });
  mostrarStatus('Carregando os clientes…');
  try {
    const dados = await buscar('clientes-credito', { busca: el('pesquisa-termo').value.trim() || null });
    clientes = dados.clientes;
    mostrarResumo(dados.resumo);
    mostrarCartoes(dados.resumo);
    mostrarLista();
    el('painel').hidden = false;
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarResumo(r) {
  el('total-aberto').textContent = dinheiro(r.aberto);
  el('total-explica').textContent = `${plural(r.clientes, 'cliente', 'clientes')} · `
    + `${compacto(r.vendido_12m)} vendidos a prazo nos últimos 12 meses`;
  el('ind-vencido').replaceChildren(compacto(r.vencido), span(`${plural(r.com_vencido, 'cliente', 'clientes')} com vencido`));
  el('ind-em-dia').replaceChildren(pct(r.pct_em_dia), span('dos títulos pagos em 12 meses'));
  el('ind-concentracao').replaceChildren(pct(r.concentracao_20), span('do total em aberto'));
  el('ind-risco').replaceChildren(inteiro(r.atrasados_comprando), span('atraso +30 dias e comprou no mês'));
  el('ind-vencido').classList.toggle('negativo', r.vencido > 0.01);
  // Rosca: em aberto por classe (A verde forte ... D laranja)
  const coresClasse = { A: 'var(--verde)', B: 'var(--verde-vivo)', C: '#E3A26F', D: 'var(--alerta)', N: 'var(--verde-claro)' };
  graficos.rosca(el('grafico-classes'), {
    titulo: 'Em aberto por classe de crédito',
    itens: ['A', 'B', 'C', 'D', 'N'].map((k) => ({
      nome: `${CLASSES[k].titulo} (${inteiro(r.por_classe[k].clientes)})`, valor: r.por_classe[k].aberto, cor: coresClasse[k],
    })),
    rotuloCentro: 'em aberto',
    maximoFatias: 5,
    ordenar: false,
  });
  el('ind-risco').classList.toggle('negativo', r.atrasados_comprando > 0);
}

function mostrarCartoes(r) {
  const itens = [
    ...['A', 'B', 'C', 'D', 'N'].map((k) => ({
      id: k, titulo: CLASSES[k].titulo, valor: dinheiro(r.por_classe[k].aberto),
      nota: `${plural(r.por_classe[k].clientes, 'cliente', 'clientes')} · em aberto`, alerta: k === 'D',
    })),
  ];
  el('cartoes').replaceChildren(...itens.map((c) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    const ativo = filtroClasse === c.id;
    botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const titulo = document.createElement('h3');
    titulo.textContent = c.titulo;
    const valor = document.createElement('p');
    valor.className = `cartao-valor${c.alerta && r.por_classe.D.aberto > 0.01 ? ' negativo' : ''}`;
    valor.textContent = c.valor;
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = c.nota;
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      filtroClasse = ativo ? null : c.id;
      mostrarCartoes(r);
      mostrarLista();
    });
    return botao;
  }));
  // O indicador de risco também filtra
  el('ind-risco').onclick = () => {
    soRisco = !soRisco;
    mostrarLista();
  };
  el('ind-risco').style.cursor = 'pointer';
  el('ind-risco').title = 'Clique para ver só esses clientes';
}

function mostrarMarcadores() {
  const itens = [];
  if (filtroClasse) itens.push({ texto: `Classe: ${CLASSES[filtroClasse].titulo}`, remover: () => { filtroClasse = null; } });
  if (soRisco) itens.push({ texto: 'Em atraso e ainda comprando', remover: () => { soRisco = false; } });
  const area = el('marcadores');
  area.hidden = itens.length === 0;
  area.replaceChildren(...itens.map((item) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'marcador';
    botao.append(item.texto, span('×'));
    botao.addEventListener('click', () => {
      item.remover();
      carregar();
    });
    return botao;
  }));
}

// ===== Lista (ordenável clicando no nome da coluna) =====
const COLUNAS = [
  { titulo: 'Cliente', chave: 'cliente', esquerda: true },
  { titulo: 'Classe', chave: 'classe', esquerda: true },
  { titulo: 'Em aberto', chave: 'aberto' },
  { titulo: 'Vencido', chave: 'vencido' },
  { titulo: 'Vendido 12 meses', chave: 'vendido_12m' },
  { titulo: 'Pago em dia', chave: 'pct_em_dia' },
  { titulo: 'Atraso médio', chave: 'atraso_medio_pagamento' },
  { titulo: 'Última compra', chave: 'ultima_compra', esquerda: true },
];

function visiveis() {
  return clientes
    .filter((c) => (filtroClasse ? c.classe === filtroClasse : true))
    .filter((c) => (soRisco ? c.atrasado_comprando : true));
}

function ordenados(lista) {
  const { coluna, direcao } = ordem;
  const fator = direcao === 'asc' ? 1 : -1;
  return [...lista].sort((a, b) => {
    const x = a[coluna];
    const y = b[coluna];
    if (typeof x === 'number' || typeof y === 'number' || x === null || y === null) {
      return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    }
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
}

function cabecalho() {
  const linha = document.createElement('tr');
  for (const coluna of COLUNAS) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (coluna.esquerda) th.className = 'esquerda';
    const ativa = ordem.coluna === coluna.chave;
    const crescente = ordem.direcao === 'asc';
    if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
    const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
    seta.setAttribute('aria-hidden', 'true');
    botao.append(coluna.titulo, seta);
    botao.addEventListener('click', () => {
      ordem = { coluna: coluna.chave, direcao: ativa && crescente ? 'desc' : (ativa ? 'asc' : 'desc') };
      mostrarLista();
    });
    th.append(botao);
    linha.append(th);
  }
  return linha;
}

// Nome do cliente clicável: abre a ficha dele (títulos, pedidos e recebimentos)
function celulaCliente(c) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'link-pedido';
  botao.textContent = c.cliente ?? `Cliente ${c.cod_cliente}`;
  botao.title = 'Ver a ficha do cliente: títulos, pedidos e recebimentos';
  botao.addEventListener('click', () => {
    window.location.href = `financeiro.html#cliente-${c.cod_cliente}`;
  });
  const celula = td(botao, 'esquerda');
  celula.append(span(`código ${c.cod_cliente}${c.atrasado_comprando ? ' · em atraso e comprando' : ''}`,
    c.atrasado_comprando ? 'qtd negativo' : 'qtd'));
  return celula;
}

function mostrarLista() {
  estado.salvar('clientes', { busca: el('pesquisa-termo').value.trim(), classe: filtroClasse, risco: soRisco });
  mostrarMarcadores();
  const lista = ordenados(visiveis());
  const tabela = el('tabela-clientes-credito');
  tabela.tHead.replaceChildren(cabecalho());
  el('titulo-lista').textContent = `Clientes (${inteiro(lista.length)})`;

  const corpo = tabela.tBodies[0];
  if (!lista.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum cliente com esses filtros.', 'vazio');
    vazio.colSpan = COLUNAS.length;
    linha.append(vazio);
    corpo.replaceChildren(linha);
  } else {
    corpo.replaceChildren(...lista.map((c) => {
      const linha = document.createElement('tr');
      if (Number(c.maior_atraso) > 0) linha.className = 'linha-vencida';
      const info = CLASSES[c.classe];
      const etiqueta = span(info.curto, `situacao ${info.classe}`);
      const atrasoMedio = c.atraso_medio_pagamento === null ? null : Math.round(Number(c.atraso_medio_pagamento));
      linha.append(
        celulaCliente(c),
        td(etiqueta, 'esquerda'),
        comAuxiliar(dinheiro(c.aberto), Number(c.titulos_abertos) ? plural(c.titulos_abertos, 'título', 'títulos') : null),
        Number(c.vencido) > 0.009
          ? comAuxiliar(dinheiro(c.vencido), `${plural(c.maior_atraso, 'dia', 'dias')} de atraso`, 'negativo', 'qtd negativo')
          : td('—'),
        td(dinheiro(c.vendido_12m)),
        comAuxiliar(pct(c.pct_em_dia), Number(c.pagos_12m) ? `de ${plural(c.pagos_12m, 'título', 'títulos')}` : 'sem pagamentos'),
        td(atrasoMedio === null ? '—' : plural(atrasoMedio, 'dia', 'dias')),
        comAuxiliar(dataBR(c.ultima_compra), c.ultimo_pagamento ? `pagou em ${dataBR(c.ultimo_pagamento)}` : null,
          'esquerda sem-quebra'),
      );
      return linha;
    }));
  }

  const soma = (campo) => lista.reduce((t, c) => t + (Number(c[campo]) || 0), 0);
  const rotulo = td(`Total (${plural(lista.length, 'cliente', 'clientes')})`, 'esquerda');
  rotulo.colSpan = 2;
  const rodape = document.createElement('tr');
  rodape.append(rotulo, td(dinheiro(soma('aberto'))), td(dinheiro(soma('vencido'))), td(dinheiro(soma('vendido_12m'))),
    td(''), td(''), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Excel =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/clientes-credito/excel', window.location.origin);
    const termo = el('pesquisa-termo').value.trim();
    if (termo) url.searchParams.set('busca', termo);
    if (filtroClasse) url.searchParams.set('classe', filtroClasse);
    if (soRisco) url.searchParams.set('risco', 'atrasado_comprando');
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const cabecalhoArquivo = resposta.headers.get('Content-Disposition') || '';
    const nome = (cabecalhoArquivo.match(/filename="([^"]+)"/) || [])[1] || 'clientes-e-credito.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    window.location.href = 'financeiro.html';
    return;
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'financeiro');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.href = 'financeiro.html';
      return;
    }
  }
  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    window.location.href = 'financeiro.html';
  });
  el('form-pesquisa').addEventListener('submit', (evento) => {
    evento.preventDefault();
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    carregar();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    carregar();
  });
  // Volta como estava (pesquisa e classe escolhida)
  const guardado = estado.aplicarCampos('clientes', { busca: 'pesquisa-termo' });
  if (guardado.classe) filtroClasse = guardado.classe;
  if (guardado.risco) soRisco = true;
  el('limpar-pesquisa').hidden = !el('pesquisa-termo').value.trim();

  el('baixar-excel').addEventListener('click', baixarExcel);
  carregar();
});
