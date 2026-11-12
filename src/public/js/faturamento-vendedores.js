// Faturamento > Faturados por vendedor: as notas fiscais de venda de cada vendedor no período.
// A regra (de onde vem cada número) está em src/repositories/faturamento-vendedores.repository.js.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const porcento = (parte, total) => (total ? `${((parte / total) * 100).toFixed(1).replace('.', ',')}%` : '—');
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

// ===== Estado =====
let vendedores = [];
let notas = [];
let ordem = { coluna: 'dia', direcao: 'desc' };
let pagina = 1;
let porPagina = paginacao.lembrar('faturamento-vendedores', 20);

const TEMPO_LIMITE_MS = 60000;

async function buscar(rota, parametros = {}) {
  const url = new URL(`/faturamento/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta;
  try {
    resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' }, signal: controle.signal });
  } catch (erro) {
    if (erro.name === 'AbortError') {
      throw new Error(`A API não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos. Tente um período menor.`);
    }
    throw new Error('Não foi possível falar com a API. Confira se ela está rodando.');
  } finally {
    clearTimeout(limite);
  }
  if (resposta.status === 401) {
    chave.apagar();
    window.location.reload();
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Seu acesso não inclui "Faturamento: faturados por vendedor". Peça para liberar na tela de Usuários.');
  return resposta;
}

async function buscarJson(rota, parametros) {
  const resposta = await buscar(rota, parametros);
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

const filtrosAtuais = () => ({
  inicio: el('inicio').value || null,
  fim: el('fim').value || null,
  busca: el('pesquisa-termo').value.trim() || null,
  vendedor: el('filtro-vendedor').value || null,
  empresa: (typeof modulos !== 'undefined' ? modulos.lojaAtual() : '') || null,
});

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

function cabecalho(tabela, colunas, ordenar) {
  const linha = document.createElement('tr');
  for (const [texto, campo, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (esquerda) th.className = 'esquerda';
    if (!campo || !ordenar) {
      th.textContent = texto;
    } else {
      const ativa = ordem.coluna === campo;
      const crescente = ordem.direcao === 'asc';
      if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
      const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
      seta.setAttribute('aria-hidden', 'true');
      botao.append(texto, seta);
      botao.addEventListener('click', () => ordenar(campo, ativa && crescente ? 'desc' : 'asc'));
      th.append(botao);
    }
    linha.append(th);
  }
  tabela.tHead.replaceChildren(linha);
}

function periodoPronto(nome) {
  const hoje = new Date();
  if (nome === 'mes') {
    return { inicio: formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: formatarData(hoje) };
  }
  const dias = Number(nome);
  return {
    inicio: formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - Math.max(0, dias - 1))),
    fim: formatarData(hoje),
  };
}

function marcarAtalho() {
  let marcado = false;
  for (const botao of el('atalhos').querySelectorAll('[data-dias]')) {
    const periodo = periodoPronto(botao.dataset.dias);
    const igual = !marcado && periodo.inicio === el('inicio').value && periodo.fim === el('fim').value;
    botao.classList.toggle('atalho--ativo', igual);
    botao.setAttribute('aria-pressed', String(igual));
    if (igual) marcado = true;
  }
}

// ===== Carregar =====
async function carregar() {
  estado.salvar('faturamento-vendedores', filtrosAtuais());
  mostrarStatus('Carregando as notas…');
  const inicioCarga = Date.now();
  try {
    const dados = await buscarJson('notas-vendedor', filtrosAtuais());
    vendedores = dados.vendedores;
    notas = dados.notas;
    pagina = 1;
    preencherSeletor();
    mostrarResumo();
    mostrarVendedores();
    mostrarNotas();
    const passou = dados.totalNotas > notas.length;
    el('aviso-limite').hidden = !passou;
    el('aviso-limite').textContent = passou
      ? `A lista mostra as ${inteiro(notas.length)} notas mais recentes de ${inteiro(dados.totalNotas)}. `
        + 'Escolha um vendedor ou um período menor para ver todas. O resumo por vendedor soma todas.'
      : '';
    el('painel').hidden = false;
    const segundos = ((Date.now() - inicioCarga) / 1000).toFixed(1).replace('.', ',');
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      + ` · carregou em ${segundos} s`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

// O seletor de vendedor sai do próprio resumo (todos os vendedores com nota no período)
function preencherSeletor() {
  const escolhido = el('filtro-vendedor').value;
  el('filtro-vendedor').replaceChildren(
    new Option('Todos', ''),
    ...vendedores.map((v) => new Option(
      `${v.vendedor ?? `Vendedor ${v.cod_vendedor}`} (${inteiro(v.notas)})`, String(v.cod_vendedor),
    )),
  );
  // Vendedor escolhido que não teve nota neste período: continua na lista, com zero
  if (escolhido && !vendedores.some((v) => String(v.cod_vendedor) === escolhido)) {
    el('filtro-vendedor').append(new Option(`Vendedor ${escolhido} (0)`, escolhido));
  }
  el('filtro-vendedor').value = escolhido;
}

const somar = (lista, campo) => lista.reduce((t, item) => t + (Number(item[campo]) || 0), 0);

// 1. Total do período (todos os vendedores)
function mostrarResumo() {
  const valor = somar(vendedores, 'valor');
  const devolvido = somar(vendedores, 'devolvido');
  const qtd = somar(vendedores, 'notas');
  el('total-faturado').textContent = dinheiro(valor);
  el('total-explica').textContent = [
    plural(qtd, 'nota', 'notas'),
    plural(vendedores.length, 'vendedor', 'vendedores'),
    qtd ? `ticket médio ${dinheiro(valor / qtd)}` : null,
    devolvido > 0.009 ? `${dinheiro(devolvido)} devolvido · líquido ${dinheiro(valor - devolvido)}` : null,
  ].filter(Boolean).join(' · ');
}

// 2. Notas por vendedor
function mostrarVendedores() {
  const total = somar(vendedores, 'valor');
  const escolhido = el('filtro-vendedor').value;
  el('titulo-vendedores').textContent = `Notas por vendedor (${plural(vendedores.length, 'vendedor', 'vendedores')})`;
  const tabela = el('tabela-vendedores');
  cabecalho(tabela, [['Vendedor', null, true], ['Notas'], ['Clientes'], ['Valor das notas'], ['% do total'],
    ['Ticket médio'], ['Devolvido'], ['Líquido'], ['', null, true]]);

  if (!vendedores.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhuma nota faturada no período.', 'vazio');
    vazio.colSpan = 9;
    linha.append(vazio);
    tabela.tBodies[0].replaceChildren(linha);
    tabela.tFoot.replaceChildren();
    return;
  }

  tabela.tBodies[0].replaceChildren(...vendedores.map((v) => {
    const ativo = escolhido === String(v.cod_vendedor);
    const devolvido = Number(v.devolvido) || 0;
    const linha = document.createElement('tr');
    linha.className = `linha-dia${ativo ? ' linha-dia--aberta' : ''}`;
    linha.title = ativo ? 'Voltar para as notas de todos' : 'Ver as notas deste vendedor';
    linha.append(
      comAuxiliar(v.vendedor ?? `Vendedor ${v.cod_vendedor}`, `código ${v.cod_vendedor}`, 'esquerda'),
      comAuxiliar(inteiro(v.notas), Number(v.notas_devolvidas)
        ? plural(v.notas_devolvidas, 'com devolução', 'com devolução') : null, null, 'qtd negativo'),
      td(inteiro(v.clientes)),
      td(dinheiro(v.valor)),
      td(porcento(Number(v.valor) || 0, total)),
      td(Number(v.notas) ? dinheiro(Number(v.valor) / Number(v.notas)) : '—'),
      td(devolvido > 0.009 ? dinheiro(devolvido) : '—', devolvido > 0.009 ? 'negativo' : null),
      td(dinheiro(v.liquido), 'coluna-final'),
      td(span(ativo ? 'Mostrar todos' : 'Ver notas →', 'atencao__ver'), 'esquerda sem-quebra'),
    );
    linha.addEventListener('click', () => {
      el('filtro-vendedor').value = ativo ? '' : String(v.cod_vendedor);
      carregar().then(() => {
        if (!ativo) el('titulo-notas').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return linha;
  }));

  const rodape = document.createElement('tr');
  const qtd = somar(vendedores, 'notas');
  const devolvido = somar(vendedores, 'devolvido');
  rodape.append(
    td('Total', 'esquerda'),
    td(inteiro(qtd)),
    td(''),
    td(dinheiro(total)),
    td('100%'),
    td(qtd ? dinheiro(total / qtd) : '—'),
    td(devolvido > 0.009 ? dinheiro(devolvido) : '—'),
    td(dinheiro(total - devolvido)),
    td(''),
  );
  tabela.tFoot.replaceChildren(rodape);
}

// ===== 3. Lista de notas =====
function mostrarMarcadores() {
  const itens = [];
  const vendedor = el('filtro-vendedor');
  if (vendedor.value) {
    itens.push({
      texto: `Vendedor: ${vendedor.selectedOptions[0]?.textContent.replace(/ \(\d[\d.]*\)$/, '') ?? vendedor.value}`,
      remover: () => { vendedor.value = ''; },
    });
  }
  const termo = el('pesquisa-termo').value.trim();
  if (termo) {
    itens.push({
      texto: `Pesquisa: ${termo}`,
      remover: () => { el('pesquisa-termo').value = ''; el('limpar-pesquisa').hidden = true; },
    });
  }
  const area = el('marcadores');
  area.hidden = itens.length === 0;
  area.replaceChildren(...itens.map((item) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'marcador';
    botao.append(item.texto, span('×'));
    botao.addEventListener('click', () => { item.remover(); carregar(); });
    return botao;
  }));
}

function mostrarNotas() {
  mostrarMarcadores();
  const fator = ordem.direcao === 'asc' ? 1 : -1;
  const itens = [...notas].sort((a, b) => {
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  const vendedor = el('filtro-vendedor').value;
  el('titulo-notas').textContent = vendedor
    ? `Notas de ${vendedores.find((v) => String(v.cod_vendedor) === vendedor)?.vendedor ?? `vendedor ${vendedor}`}`
      + ` (${inteiro(itens.length)})`
    : `Notas (${inteiro(itens.length)})`;

  const tabela = el('tabela-notas');
  cabecalho(tabela, [['Nota', 'nota', true], ['Data', 'dia', true], ['Pedido', 'pedido', true],
    ['Cliente', 'cliente', true], ['Vendedor', 'vendedor', true], ['Valor da nota', 'valor'],
    ['Devolvido', 'devolvido'], ['Líquido', 'liquido']], (coluna, direcao) => {
    ordem = { coluna, direcao };
    pagina = 1;
    mostrarNotas();
  });

  const linhas = [];
  if (!itens.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhuma nota com esses filtros.', 'vazio');
    vazio.colSpan = 8;
    linha.append(vazio);
    linhas.push(linha);
  }
  pagina = paginacao.desenhar(el('notas-paginador'), {
    total: itens.length,
    pagina,
    porPagina,
    aoMudar: (escolha) => {
      pagina = escolha.pagina;
      if (escolha.porPagina !== porPagina) {
        porPagina = escolha.porPagina;
        paginacao.guardar('faturamento-vendedores', porPagina);
      }
      mostrarNotas();
      el('titulo-notas').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
  const primeiro = (pagina - 1) * porPagina;
  for (const n of itens.slice(primeiro, primeiro + porPagina)) {
    const devolvido = Number(n.devolvido) || 0;
    const linha = document.createElement('tr');
    // Detalhes (empresa, desconto, NF de devolução) ficam no "passar o mouse" e no Excel,
    // para a linha caber na tela
    const celulaNota = td(`NF ${n.nota}`, 'esquerda sem-quebra');
    celulaNota.title = `Empresa ${n.empresa}`;
    const celulaValor = td(dinheiro(n.valor), 'sem-quebra');
    if (Number(n.desconto) > 0.009) celulaValor.title = `Desconto de ${dinheiro(n.desconto)}`;
    const celulaDevolvido = n.tem_devolucao
      ? td(devolvido > 0.009 ? dinheiro(devolvido) : 'sem valor', 'negativo sem-quebra')
      : td('—');
    if (n.tem_devolucao) celulaDevolvido.title = `NF de devolução ${n.nota_devolucao ?? '—'} em ${dataBR(n.devolucao_dia)}`;
    linha.append(
      celulaNota,
      td(dataBR(n.dia), 'esquerda sem-quebra'),
      td(pedidoJanela.link(n.pedido), 'esquerda sem-quebra'),
      td(n.cliente ?? `Cliente ${n.cod_cliente}`, 'esquerda'),
      td(n.vendedor ?? `Vendedor ${n.cod_vendedor}`, 'esquerda'),
      celulaValor,
      celulaDevolvido,
      td(dinheiro(n.liquido), 'coluna-final sem-quebra'),
    );
    linhas.push(linha);
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const rodape = document.createElement('tr');
  const rotulo = td(`Total (${plural(itens.length, 'nota', 'notas')})`, 'esquerda');
  rotulo.colSpan = 5;
  rodape.append(rotulo, td(dinheiro(somar(itens, 'valor'))), td(dinheiro(somar(itens, 'devolvido'))),
    td(dinheiro(somar(itens, 'liquido'))));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Excel: aba "Por vendedor" + aba "Notas" =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const resposta = await buscar('notas-vendedor/excel', filtrosAtuais());
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'notas_por_vendedor.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    mostrarStatus(`Excel: ${erro.message}`, true);
  } finally {
    botao.disabled = false;
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    const informada = window.prompt('Informe a chave de acesso do faturamento:');
    if (!informada) {
      mostrarStatus('É preciso informar a chave de acesso para ver esta tela.', true);
      return;
    }
    chave.guardar(informada.trim());
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'faturamento');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.reload();
      return;
    }
  }

  // Padrão: o mês atual (é como o faturamento por vendedor costuma ser cobrado)
  const periodo = periodoPronto('mes');
  el('inicio').value = periodo.inicio;
  el('fim').value = periodo.fim;
  const guardado = estado.aplicarCampos('faturamento-vendedores', {
    inicio: 'inicio', fim: 'fim', busca: 'pesquisa-termo',
  });
  // O vendedor guardado entra no seletor antes da primeira carga
  if (guardado.vendedor) {
    el('filtro-vendedor').append(new Option(`Vendedor ${guardado.vendedor}`, guardado.vendedor));
    el('filtro-vendedor').value = guardado.vendedor;
  }
  el('limpar-pesquisa').hidden = !el('pesquisa-termo').value.trim();
  marcarAtalho();

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    window.location.reload();
  });
  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregar();
  });
  el('atalhos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-dias]');
    if (!botao) return;
    const novo = periodoPronto(botao.dataset.dias);
    el('inicio').value = novo.inicio;
    el('fim').value = novo.fim;
    marcarAtalho();
    carregar();
  });
  el('inicio').addEventListener('change', marcarAtalho);
  el('fim').addEventListener('change', marcarAtalho);
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
  el('filtro-vendedor').addEventListener('change', () => carregar());
  el('baixar-excel').addEventListener('click', baixarExcel);

  carregar();
});
