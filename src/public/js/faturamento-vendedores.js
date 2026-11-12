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
let soDevolucao = false; // botão "Só com devolução": a lista mostra só as notas que voltaram

const TEMPO_LIMITE_MS = 60000;

let cargaAtual = 0;      // cada carga tem um número: resposta de carga antiga é ignorada
let cargaControle = null; // a carga anterior é cancelada quando outra começa (clique rápido)

async function buscar(rota, parametros = {}, sinalExterno = null) {
  const url = new URL(`/faturamento/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  sinalExterno?.addEventListener('abort', () => controle.abort(), { once: true });
  let resposta;
  try {
    resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' }, signal: controle.signal });
  } catch (erro) {
    if (sinalExterno?.aborted) throw erro; // trocou de filtro no meio: a carga nova assume
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

async function buscarJson(rota, parametros, sinal) {
  const resposta = await buscar(rota, parametros, sinal);
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

const filtrosAtuais = () => ({
  inicio: el('inicio').value || null,
  fim: el('fim').value || null,
  busca: el('pesquisa-termo').value.trim() || null,
  vendedor: el('filtro-vendedor').value || null,
  devolucao: soDevolucao ? 1 : null,
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

// Celular: cada célula ganha o nome da coluna (o CSS mostra em cima do valor, no cartão)
function rotular(tabela) {
  const nomes = [...tabela.tHead.rows[0].cells].map((th) => th.textContent.replace(/[▲▼↕]/g, '').trim());
  for (const linha of [...tabela.tBodies[0].rows, ...tabela.tFoot.rows]) {
    let coluna = 0;
    for (const celula of linha.cells) {
      if (nomes[coluna]) celula.dataset.rotulo = nomes[coluna];
      coluna += celula.colSpan || 1;
    }
  }
}

function marcarDevolucao() {
  const botao = el('so-devolucao');
  botao.classList.toggle('atalho--ativo', soDevolucao);
  botao.setAttribute('aria-pressed', String(soDevolucao));
}

// Selo da devolução: "total" (voltou a nota inteira) ou "parcial"
function seloDevolucao(n) {
  const caixa = document.createDocumentFragment();
  const tipo = n.devolucao_tipo === 'total' ? 'total' : 'parcial';
  caixa.append(span(tipo === 'total' ? 'Total' : 'Parcial', `selo-devolucao selo-devolucao--${tipo}`));
  const dia = n.devolucao_dia ? dataBR(n.devolucao_dia).slice(0, 5) : '';
  const vezes = Number(n.devolucoes) > 1 ? ` (${n.devolucoes} devoluções)` : '';
  caixa.append(span(`NF ${n.nota_devolucao ?? '—'}${dia ? ` · ${dia}` : ''}${vezes}`, 'devolucao-nf'));
  return caixa;
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
  const minhaCarga = ++cargaAtual;
  cargaControle?.abort();
  cargaControle = new AbortController();
  try {
    const dados = await buscarJson('notas-vendedor', filtrosAtuais(), cargaControle.signal);
    if (minhaCarga !== cargaAtual) return; // já pediram outra coisa: esta resposta não vale mais
    vendedores = dados.vendedores ?? [];
    notas = dados.notas ?? [];
    pagina = 1;
    // Cada parte da tela é desenhada separada: se uma der problema, as outras aparecem
    parte('vendedores', () => { preencherSeletor(); mostrarResumo(); mostrarVendedores(); });
    parte('analise', () => mostrarAnalise(el('analise'), dados, el('filtro-vendedor').value));
    parte('notas', () => mostrarNotas());
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
    if (minhaCarga !== cargaAtual || erro.name === 'AbortError') return;
    mostrarStatus(erro.message, true);
  }
}

// Desenha uma parte da tela sem deixar um erro dela apagar as outras
function parte(nome, desenhar) {
  try {
    desenhar();
  } catch (erro) {
    console.error(`Faturados por vendedor: falha ao montar "${nome}"`, erro);
    const alvo = el({ vendedores: 'tabela-vendedores', analise: 'analise', notas: 'tabela-notas' }[nome]);
    const texto = 'Esta parte não pôde ser montada agora. Clique em Atualizar; se continuar, avise o TI.';
    if (alvo?.tBodies) {
      const linha = document.createElement('tr');
      const celula = td(texto, 'vazio');
      celula.colSpan = 9;
      linha.append(celula);
      alvo.tBodies[0].replaceChildren(linha);
    } else if (alvo) {
      alvo.replaceChildren(span(texto, 'negativo'));
    }
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
    linha.title = 'Abrir a análise deste vendedor';
    const celulaNotas = td(inteiro(v.notas));
    // "2 com devolução": abre só as notas devolvidas deste vendedor
    if (Number(v.notas_devolvidas)) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'link-devolucao';
      botao.textContent = plural(v.notas_devolvidas, 'com devolução', 'com devolução');
      botao.title = 'Ver só as notas deste vendedor que tiveram devolução';
      botao.addEventListener('click', (evento) => {
        evento.stopPropagation();
        el('filtro-vendedor').value = String(v.cod_vendedor);
        soDevolucao = true;
        marcarDevolucao();
        carregar().then(() => el('titulo-notas').scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
      celulaNotas.append(botao);
    }
    linha.append(
      comAuxiliar(v.vendedor ?? `Vendedor ${v.cod_vendedor}`, `código ${v.cod_vendedor}`, 'esquerda cel-titulo'),
      celulaNotas,
      td(inteiro(v.clientes)),
      td(dinheiro(v.valor)),
      td(porcento(Number(v.valor) || 0, total)),
      td(Number(v.notas) ? dinheiro(Number(v.valor) / Number(v.notas)) : '—'),
      td(devolvido > 0.009 ? dinheiro(devolvido) : '—', devolvido > 0.009 ? 'negativo' : null),
      td(dinheiro(v.liquido), 'coluna-final'),
      td(span('Ver análise →', 'atencao__ver'), 'esquerda sem-quebra cel-acao'),
    );
    // Abre a análise numa janela por cima: a tela de trás não recarrega nem sai do lugar
    linha.addEventListener('click', () => abrirAnaliseVendedor(v));
    return linha;
  }));

  const rodape = document.createElement('tr');
  const qtd = somar(vendedores, 'notas');
  const devolvido = somar(vendedores, 'devolvido');
  rodape.append(
    td('Total', 'esquerda cel-titulo'),
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
  rotular(tabela);
}

// ===== 3. Análise (olhar de gestor de vendas) =====
// Sem vendedor escolhido: o pico de vendas da equipe. Com vendedor: a análise dele, comparada
// com a equipe e com o mesmo intervalo do mês anterior. Tudo calculado com os dados já carregados.
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const pct = (n, casas = 1) => `${(Number(n) || 0).toFixed(casas).replace('.', ',')}%`;
const diaDaSemana = (iso) => new Date(`${iso}T12:00:00`).getDay();

// Todos os dias do período (dia sem nota entra com zero no gráfico)
function diasDoPeriodo(inicio, fim) {
  const dias = [];
  for (let d = new Date(`${inicio}T12:00:00`); formatarData(d) <= fim; d.setDate(d.getDate() + 1)) {
    dias.push(formatarData(d));
  }
  return dias;
}

function numero(titulo, valor, detalhe, classeDetalhe) {
  const caixa = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = titulo;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  if (detalhe) {
    const pequeno = document.createElement('small');
    pequeno.textContent = detalhe;
    if (classeDetalhe) pequeno.className = classeDetalhe;
    dd.append(pequeno);
  }
  caixa.append(dt, dd);
  return caixa;
}

function linhaBarra(nome, detalheNome, valor, detalheValor, fracao, pico) {
  const linha = document.createElement('div');
  linha.className = `linha-barra${pico ? ' linha-barra--pico' : ''}`;
  const rotulo = span(nome, 'linha-barra__nome');
  rotulo.title = nome;
  if (detalheNome) {
    const pequeno = document.createElement('small');
    pequeno.textContent = detalheNome;
    rotulo.append(pequeno);
  }
  const trilho = span('', 'barra-trilho');
  const cheio = span('', 'barra-preenchida');
  cheio.style.width = `${Math.max(0, Math.min(100, fracao * 100))}%`;
  trilho.append(cheio);
  const caixaValor = span(valor, 'linha-barra__valor');
  if (detalheValor) {
    const pequeno = document.createElement('small');
    pequeno.textContent = detalheValor;
    caixaValor.append(pequeno);
  }
  linha.append(rotulo, trilho, caixaValor);
  return linha;
}

function variacao(atual, anterior) {
  if (!(Number(anterior) > 0)) return null;
  return ((Number(atual) - Number(anterior)) / Number(anterior)) * 100;
}

// raiz: onde desenhar (a seção da tela ou a janela); escolhido: código do vendedor ('' = equipe)
function mostrarAnalise(raiz, dados, escolhido) {
  raiz.replaceChildren(el('modelo-analise').content.cloneNode(true));
  const parte = (nome) => raiz.querySelector(`.an-${nome}`);
  const inicio = el('inicio').value;
  const fim = el('fim').value;
  const v = escolhido ? vendedores.find((x) => String(x.cod_vendedor) === escolhido) : null;
  const campoValor = escolhido ? 'valor_vendedor' : 'valor';
  const campoNotas = escolhido ? 'notas_vendedor' : 'notas';
  const nome = v?.vendedor ?? (escolhido ? `Vendedor ${escolhido}` : '');
  const primeiroNome = nome.split(' ')[0] || 'O vendedor';

  // Equipe
  const equipe = {
    valor: somar(vendedores, 'valor'),
    notas: somar(vendedores, 'notas'),
    devolvido: somar(vendedores, 'devolvido'),
    anterior: somar(vendedores, 'valor_anterior'),
  };
  const ativos = vendedores.filter((x) => Number(x.notas) > 0);
  const ticketEquipe = equipe.notas ? equipe.valor / equipe.notas : 0;
  const mediaPorVendedor = ativos.length ? equipe.valor / ativos.length : 0;
  const devolucaoEquipe = equipe.valor ? (equipe.devolvido / equipe.valor) * 100 : 0;

  // Quem está sendo analisado (vendedor ou equipe toda)
  const alvo = v
    ? { valor: Number(v.valor) || 0, notas: Number(v.notas) || 0, devolvido: Number(v.devolvido) || 0,
      clientes: Number(v.clientes) || 0, anterior: Number(v.valor_anterior) || 0,
      notasAnterior: Number(v.notas_anterior) || 0 }
    : { valor: equipe.valor, notas: equipe.notas, devolvido: equipe.devolvido, clientes: null,
      anterior: equipe.anterior, notasAnterior: somar(vendedores, 'notas_anterior') };
  const ticket = alvo.notas ? alvo.valor / alvo.notas : 0;
  const devolucaoPct = alvo.valor ? (alvo.devolvido / alvo.valor) * 100 : 0;
  const crescimento = variacao(alvo.valor, alvo.anterior);

  // Série por dia (com zeros) e picos
  const porDia = new Map((dados.porDia ?? []).map((d) => [String(d.dia).slice(0, 10), d]));
  const dias = diasDoPeriodo(inicio, fim);
  const serie = dias.map((dia) => ({
    dia,
    valor: Number(porDia.get(dia)?.[campoValor]) || 0,
    notas: Number(porDia.get(dia)?.[campoNotas]) || 0,
  }));
  const comVenda = serie.filter((d) => d.valor > 0);
  const pico = comVenda.reduce((m, d) => (d.valor > (m?.valor ?? -1) ? d : m), null);
  const mediaDia = comVenda.length ? alvo.valor / comVenda.length : 0;
  // Dias úteis (segunda a sábado) do período sem nenhuma nota
  const diasUteis = serie.filter((d) => diaDaSemana(d.dia) !== 0);
  const semNota = diasUteis.filter((d) => d.valor === 0 && d.dia <= formatarData(new Date()));

  // Média por dia da semana (só dias que já passaram, contando os sem venda)
  const semana = DIAS_SEMANA.map((nomeDia, i) => {
    const doDia = serie.filter((d) => diaDaSemana(d.dia) === i && d.dia <= formatarData(new Date()));
    const total = doDia.reduce((t, d) => t + d.valor, 0);
    return { nome: nomeDia, i, dias: doDia.length, total, media: doDia.length ? total / doDia.length : 0 };
  }).filter((s) => s.dias > 0 && (s.i !== 0 || s.total > 0)); // domingo só se teve venda
  const melhorSemana = semana.reduce((m, s) => (s.media > (m?.media ?? -1) ? s : m), null);
  const piorSemana = semana.filter((s) => s.i !== 0)
    .reduce((m, s) => (s.media < (m?.media ?? Infinity) ? s : m), null);

  // Clientes
  const clientes = dados.clientes ?? [];
  const top3 = clientes.slice(0, 3).reduce((t, c) => t + (Number(c.valor) || 0), 0);
  const concentracao = alvo.valor ? (top3 / alvo.valor) * 100 : 0;

  // Projeção: só quando o período é o mês atual até hoje
  const hoje = new Date();
  const mesAtual = periodoPronto('mes');
  let projecao = null;
  if (inicio === mesAtual.inicio && fim === mesAtual.fim && hoje.getDate() > 1) {
    const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const uteisAteHoje = diasUteis.length || 1;
    let uteisNoMes = 0;
    for (let d = 1; d <= ultimo; d += 1) {
      if (new Date(hoje.getFullYear(), hoje.getMonth(), d).getDay() !== 0) uteisNoMes += 1;
    }
    projecao = (alvo.valor / uteisAteHoje) * uteisNoMes;
  }

  // ---- Título e descrição ----
  parte('titulo').textContent = v ? `Análise de ${nome}` : 'Pico de vendas da equipe';
  parte('descricao').textContent = v
    ? `Como ${primeiroNome} está vendendo de ${dataBR(inicio)} a ${dataBR(fim)}, comparado com a equipe `
      + `e com o mesmo intervalo do mês anterior (${dataBR(dados.anterior?.inicio)} a ${dataBR(dados.anterior?.fim)}).`
    : `Quando a equipe mais vende, de ${dataBR(inicio)} a ${dataBR(fim)}. Clique num vendedor acima para ver a análise dele.`;

  // ---- Números ----
  const ranking = v ? vendedores.findIndex((x) => x === v) + 1 : null;
  const numeros = [];
  if (v) {
    numeros.push(numero('Faturado', dinheiro(alvo.valor),
      `${pct(equipe.valor ? (alvo.valor / equipe.valor) * 100 : 0)} da equipe · ${ranking}º de ${vendedores.length}`));
  }
  numeros.push(numero(v ? 'Mês anterior (mesmo intervalo)' : 'Comparado ao mês anterior',
    crescimento === null ? '—' : `${crescimento >= 0 ? '+' : ''}${pct(crescimento)}`,
    alvo.anterior > 0 ? `era ${dinheiro(alvo.anterior)}` : 'sem nota no mês anterior',
    crescimento === null ? null : crescimento >= 0 ? 'sobe' : 'desce'));
  numeros.push(numero('Ticket médio', dinheiro(ticket),
    v && ticketEquipe ? `equipe ${dinheiro(ticketEquipe)} (${ticket >= ticketEquipe ? '+' : ''}${pct(((ticket / ticketEquipe) - 1) * 100, 0)})` : `${plural(alvo.notas, 'nota', 'notas')}`));
  numeros.push(numero('Pico de vendas', pico ? dinheiro(pico.valor) : '—',
    pico ? `${DIAS_SEMANA[diaDaSemana(pico.dia)].toLowerCase()}, ${dataBR(pico.dia).slice(0, 5)} · ${plural(pico.notas, 'nota', 'notas')}` : null));
  numeros.push(numero('Média por dia com venda', dinheiro(mediaDia),
    `${plural(comVenda.length, 'dia', 'dias')} com nota de ${plural(diasUteis.length, 'dia útil', 'dias úteis')}`));
  if (v) {
    numeros.push(numero('Clientes atendidos', inteiro(alvo.clientes),
      alvo.clientes ? `${(alvo.notas / alvo.clientes).toFixed(1).replace('.', ',')} notas por cliente` : null));
  }
  numeros.push(numero('Devolução', pct(devolucaoPct), v ? `equipe ${pct(devolucaoEquipe)}` : dinheiro(alvo.devolvido),
    devolucaoPct > Math.max(1, devolucaoEquipe * 1.5) ? 'desce' : null));
  if (projecao !== null) {
    numeros.push(numero('Se mantiver o ritmo', dinheiro(projecao), 'projeção do mês (dias úteis)'));
  }
  parte('numeros').replaceChildren(...numeros);

  // ---- Leitura do gestor ----
  const fortes = [];
  const atencao = [];
  if (v) {
    if (ranking === 1) fortes.push(`Maior faturamento da equipe no período (${pct((alvo.valor / equipe.valor) * 100)} do total).`);
    else if (alvo.valor >= mediaPorVendedor) fortes.push(`Fatura acima da média por vendedor (${dinheiro(mediaPorVendedor)}): está em ${ranking}º de ${vendedores.length}.`);
    else atencao.push(`Fatura abaixo da média por vendedor: ${dinheiro(alvo.valor)} contra ${dinheiro(mediaPorVendedor)} (${ranking}º de ${vendedores.length}).`);
    if (ticketEquipe) {
      const dif = ((ticket / ticketEquipe) - 1) * 100;
      if (dif >= 10) fortes.push(`Ticket médio ${pct(dif, 0)} acima da equipe: vende pedidos maiores (${dinheiro(ticket)} por nota).`);
      else if (dif <= -10) atencao.push(`Ticket médio ${pct(-dif, 0)} abaixo da equipe (${dinheiro(ticket)} contra ${dinheiro(ticketEquipe)}): vale trabalhar mix e quantidade por pedido.`);
    }
  }
  if (crescimento !== null) {
    if (crescimento >= 5) fortes.push(`Cresceu ${pct(crescimento)} sobre o mesmo intervalo do mês anterior.`);
    else if (crescimento <= -5) atencao.push(`Caiu ${pct(-crescimento)} contra o mesmo intervalo do mês anterior (${dinheiro(alvo.anterior)}).`);
    else fortes.push(`Estável em relação ao mês anterior (${crescimento >= 0 ? '+' : ''}${pct(crescimento)}).`);
  } else if (v) {
    atencao.push('Sem notas no mesmo intervalo do mês anterior: não dá para comparar a evolução ainda.');
  }
  if (pico && alvo.valor) {
    const peso = (pico.valor / alvo.valor) * 100;
    const texto = `Pico em ${DIAS_SEMANA[diaDaSemana(pico.dia)].toLowerCase()}, ${dataBR(pico.dia)}: ${dinheiro(pico.valor)} (${pct(peso, 0)} do período).`;
    if (peso >= 25 && comVenda.length >= 4) atencao.push(`${texto} Muito concentrado num dia só: a venda depende de pedidos grandes pontuais.`);
    else fortes.push(texto);
  }
  if (melhorSemana && piorSemana && melhorSemana !== piorSemana && piorSemana.media >= 0) {
    fortes.push(`${melhorSemana.nome} é o dia mais forte (média de ${dinheiro(melhorSemana.media)}).`);
    if (melhorSemana.media > 0 && piorSemana.media < melhorSemana.media * 0.5) {
      atencao.push(`${piorSemana.nome} é o dia mais fraco (média de ${dinheiro(piorSemana.media)}): bom dia para ligar para a carteira e fazer pedidos.`);
    }
  }
  if (semNota.length >= 2) {
    atencao.push(`${plural(semNota.length, 'dia útil', 'dias úteis')} sem nenhuma nota${v ? ` de ${primeiroNome}` : ''}: `
      + `${semNota.slice(-4).map((d) => dataBR(d.dia).slice(0, 5)).join(', ')}${semNota.length > 4 ? '…' : ''}.`);
  }
  if (v && clientes.length) {
    if (concentracao >= 50) atencao.push(`Carteira concentrada: os 3 maiores clientes são ${pct(concentracao, 0)} do faturamento. Perder um deles pesa muito.`);
    else fortes.push(`Carteira bem distribuída: os 3 maiores clientes são ${pct(concentracao, 0)} do faturamento.`);
    if (alvo.clientes && alvo.notas / alvo.clientes >= 2) fortes.push(`Clientes voltam a comprar: ${(alvo.notas / alvo.clientes).toFixed(1).replace('.', ',')} notas por cliente no período.`);
  }
  if (alvo.devolvido > 0.009) {
    if (devolucaoPct > Math.max(1, devolucaoEquipe * 1.5)) {
      atencao.push(`Devolução de ${pct(devolucaoPct)} (${dinheiro(alvo.devolvido)}), acima da equipe (${pct(devolucaoEquipe)}): conferir o pedido com o cliente antes de fechar.`);
    } else {
      fortes.push(`Devolução sob controle: ${pct(devolucaoPct)} do faturado.`);
    }
  } else if (alvo.notas) {
    fortes.push('Nenhuma devolução no período.');
  }
  if (!v && ativos.length) {
    const lider = vendedores[0];
    fortes.push(`${lider.vendedor ?? `Vendedor ${lider.cod_vendedor}`} lidera com ${dinheiro(lider.valor)} (${pct((lider.valor / equipe.valor) * 100)} da equipe).`);
    const top2 = vendedores.slice(0, 2).reduce((t, x) => t + (Number(x.valor) || 0), 0);
    if (vendedores.length > 3 && top2 / equipe.valor >= 0.4) {
      atencao.push(`Os 2 maiores vendedores fazem ${pct((top2 / equipe.valor) * 100, 0)} do faturamento: a equipe depende muito deles.`);
    }
  }
  if (projecao !== null) {
    fortes.push(`No ritmo atual, ${v ? primeiroNome : 'a equipe'} fecha o mês em torno de ${dinheiro(projecao)}.`);
  }

  const bloco = (titulo, itens, classe) => {
    const caixa = document.createElement('div');
    caixa.className = classe;
    const h = document.createElement('h3');
    h.textContent = titulo;
    const ul = document.createElement('ul');
    ul.append(...itens.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
    caixa.append(h, ul);
    return caixa;
  };
  parte('leitura').replaceChildren(
    bloco('Pontos fortes', fortes.length ? fortes : ['Sem destaque no período.'], 'leitura--forte'),
    bloco('Pontos de atenção', atencao.length ? atencao : ['Nada fora do normal no período.'], 'leitura--atencao'),
  );

  // ---- Gráfico por dia: o pico em destaque ----
  parte('titulo-grafico').textContent = v ? `Faturado por dia: ${primeiroNome}` : 'Faturado por dia: equipe';
  if (typeof graficos === 'undefined') {
    parte('grafico').textContent = 'O gráfico não carregou agora (o resto da análise continua valendo).';
  } else graficos.colunas(parte('grafico'), {
    titulo: parte('titulo-grafico').textContent,
    altura: 230,
    // No celular só o dia (05), para os rótulos não se encostarem
    rotulos: serie.map((d) => (window.matchMedia('(max-width: 720px)').matches ? d.dia.slice(8, 10) : dataBR(d.dia).slice(0, 5))),
    series: [{
      nome: 'Faturado em nota',
      valores: serie.map((d) => d.valor),
      cores: serie.map((d) => (pico && d.dia === pico.dia ? 'var(--verde-escuro)'
        : diaDaSemana(d.dia) === 0 ? 'var(--verde-claro)' : 'var(--verde)')),
    }],
    vazio: 'Nenhuma nota no período.',
  });

  // ---- Dia da semana ----
  const maiorMedia = Math.max(0, ...semana.map((s) => s.media));
  parte('semana').replaceChildren(...semana.map((s) => linhaBarra(
    s.nome, `${plural(s.dias, 'dia', 'dias')} no período`, dinheiro(s.media), `total ${dinheiro(s.total)}`,
    maiorMedia ? s.media / maiorMedia : 0, s === melhorSemana,
  )));
  if (!semana.length) parte('semana').textContent = 'Sem dias no período.';

  // ---- Clientes ----
  parte('titulo-clientes').textContent = v ? `Principais clientes de ${primeiroNome}` : 'Principais clientes da equipe';
  const maiorCliente = Math.max(0, ...clientes.map((c) => Number(c.valor) || 0));
  parte('clientes').replaceChildren(...clientes.map((c, i) => linhaBarra(
    c.cliente ?? `Cliente ${c.cod_cliente}`,
    `${plural(c.notas, 'nota', 'notas')} · última ${dataBR(c.ultima_compra).slice(0, 5)}`
      + `${Number(c.devolvido) > 0.009 ? ` · devolveu ${dinheiro(c.devolvido)}` : ''}`,
    dinheiro(c.valor), alvo.valor ? `${pct((Number(c.valor) / alvo.valor) * 100)} do faturado` : null,
    maiorCliente ? (Number(c.valor) || 0) / maiorCliente : 0, i === 0,
  )));
  if (!clientes.length) parte('clientes').textContent = 'Sem clientes no período.';
}

// ===== Janela da análise do vendedor =====
let vendedorNaJanela = null;
let cargaJanela = 0;

async function abrirAnaliseVendedor(v) {
  const janela = el('janela-vendedor');
  vendedorNaJanela = v;
  const minha = ++cargaJanela;
  const nome = v.vendedor ?? `Vendedor ${v.cod_vendedor}`;
  el('janela-vendedor-titulo').textContent = `Análise de ${nome}`;
  el('janela-vendedor-resumo').textContent = `código ${v.cod_vendedor} · ${dataBR(el('inicio').value)} a ${dataBR(el('fim').value)}`;
  el('janela-vendedor-corpo').replaceChildren();
  el('janela-vendedor-status').textContent = 'Montando a análise…';
  el('janela-vendedor-status').classList.remove('status--erro');
  if (!janela.open) {
    janela.showModal();
    document.body.classList.add('com-janela'); // a tela de trás não rola junto
  }
  try {
    // Mesmo período e loja da tela; sem pesquisa nem filtro de devolução (a venda inteira dele)
    const { busca, devolucao, ...filtros } = filtrosAtuais();
    const dados = await buscarJson('notas-vendedor', { ...filtros, vendedor: v.cod_vendedor });
    if (minha !== cargaJanela || !janela.open) return;
    el('janela-vendedor-status').textContent = '';
    mostrarAnalise(el('janela-vendedor-corpo'), dados, String(v.cod_vendedor));
    const titulo = el('janela-vendedor-corpo').querySelector('.an-titulo');
    if (titulo) titulo.hidden = true; // o nome já está no topo da janela
    el('janela-vendedor-corpo').scrollTop = 0;
  } catch (erro) {
    if (minha !== cargaJanela) return;
    el('janela-vendedor-status').textContent = erro.message;
    el('janela-vendedor-status').classList.add('status--erro');
  }
}

function fecharAnaliseVendedor() {
  const janela = el('janela-vendedor');
  if (janela.open) janela.close();
}

// ===== 4. Lista de notas =====
function mostrarMarcadores() {
  const itens = [];
  const vendedor = el('filtro-vendedor');
  if (vendedor.value) {
    itens.push({
      texto: `Vendedor: ${vendedor.selectedOptions[0]?.textContent.replace(/ \(\d[\d.]*\)$/, '') ?? vendedor.value}`,
      remover: () => { vendedor.value = ''; },
    });
  }
  if (soDevolucao) {
    itens.push({ texto: 'Só com devolução', remover: () => { soDevolucao = false; marcarDevolucao(); } });
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
  const nomeVendedor = vendedores.find((v) => String(v.cod_vendedor) === vendedor)?.vendedor ?? `vendedor ${vendedor}`;
  el('titulo-notas').textContent = `Notas${soDevolucao ? ' com devolução' : ''}`
    + `${vendedor ? ` de ${nomeVendedor}` : ''} (${inteiro(itens.length)})`;
  const ordemCelular = el('ordem-celular');
  const escolhaCelular = `${ordem.coluna}:${ordem.direcao}`;
  if ([...ordemCelular.options].some((o) => o.value === escolhaCelular)) ordemCelular.value = escolhaCelular;

  // Com um vendedor escolhido, a coluna Vendedor só repetiria o nome: sai
  const comVendedor = !vendedor;
  const colunas = [['Nota', 'nota', true], ['Data', 'dia', true], ['Pedido', 'pedido', true],
    ['Cliente', 'cliente', true]];
  if (comVendedor) colunas.push(['Vendedor', 'vendedor', true]);
  colunas.push(['Valor da nota', 'valor'], ['Devolução', 'nota_devolucao', true], ['Devolvido', 'devolvido'],
    ['Líquido', 'liquido']);
  const tabela = el('tabela-notas');
  cabecalho(tabela, colunas, (coluna, direcao) => {
    ordem = { coluna, direcao };
    pagina = 1;
    mostrarNotas();
  });

  const linhas = [];
  if (!itens.length) {
    const linha = document.createElement('tr');
    const vazio = td(soDevolucao ? 'Nenhuma nota com devolução nesses filtros.' : 'Nenhuma nota com esses filtros.', 'vazio');
    vazio.colSpan = colunas.length;
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
    if (n.tem_devolucao) linha.className = 'linha-devolvida';
    // Detalhes (empresa, desconto, NF de devolução) ficam no "passar o mouse" e no Excel,
    // para a linha caber na tela
    const celulaNota = td(`NF ${n.nota}`, 'esquerda sem-quebra cel-titulo');
    celulaNota.title = `Empresa ${n.empresa}`;
    const celulaValor = td(dinheiro(n.valor), 'sem-quebra');
    if (Number(n.desconto) > 0.009) celulaValor.title = `Desconto de ${dinheiro(n.desconto)}`;
    const celulaDevolvido = n.tem_devolucao
      ? td(devolvido > 0.009 ? dinheiro(devolvido) : 'sem valor', 'negativo sem-quebra')
      : td('—');
    // Devolução à vista na linha: selo total/parcial + nº e dia da NF de devolução
    const celulaDevolucao = n.tem_devolucao ? td(seloDevolucao(n), 'esquerda sem-quebra cel-largo') : td('', 'esquerda');
    if (n.tem_devolucao) celulaDevolucao.title = `NF de devolução ${n.nota_devolucao ?? '—'} em ${dataBR(n.devolucao_dia)}`;
    linha.append(
      celulaNota,
      td(dataBR(n.dia), 'esquerda sem-quebra'),
      td(pedidoJanela.link(n.pedido), 'esquerda sem-quebra'),
      td(n.cliente ?? `Cliente ${n.cod_cliente}`, 'esquerda cel-largo'),
    );
    if (comVendedor) linha.append(td(n.vendedor ?? `Vendedor ${n.cod_vendedor}`, 'esquerda cel-largo'));
    linha.append(
      celulaValor,
      celulaDevolucao,
      celulaDevolvido,
      td(dinheiro(n.liquido), 'coluna-final sem-quebra'),
    );
    linhas.push(linha);
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const rodape = document.createElement('tr');
  const rotulo = td(`Total (${plural(itens.length, 'nota', 'notas')})`, 'esquerda cel-titulo');
  rotulo.colSpan = comVendedor ? 5 : 4;
  const devolvidas = itens.filter((n) => n.tem_devolucao).length;
  rodape.append(rotulo, td(dinheiro(somar(itens, 'valor'))),
    td(devolvidas ? plural(devolvidas, 'nota devolvida', 'notas devolvidas') : '', 'esquerda'),
    td(dinheiro(somar(itens, 'devolvido'))), td(dinheiro(somar(itens, 'liquido'))));
  tabela.tFoot.replaceChildren(rodape);
  rotular(tabela);
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
  soDevolucao = String(guardado.devolucao ?? '') === '1';
  marcarDevolucao();
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
  // Janela do vendedor: fechar (botão, Esc ou clique fora) e "ver as notas na lista"
  const janela = el('janela-vendedor');
  janela.addEventListener('close', () => { document.body.classList.remove('com-janela'); cargaJanela += 1; });
  janela.addEventListener('click', (evento) => { if (evento.target === janela) fecharAnaliseVendedor(); });
  el('janela-vendedor-fechar').addEventListener('click', fecharAnaliseVendedor);
  el('janela-vendedor-notas').addEventListener('click', () => {
    if (!vendedorNaJanela) return;
    el('filtro-vendedor').value = String(vendedorNaJanela.cod_vendedor);
    fecharAnaliseVendedor();
    carregar().then(() => el('titulo-notas').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });

  el('so-devolucao').addEventListener('click', () => {
    soDevolucao = !soDevolucao;
    marcarDevolucao();
    carregar();
  });
  el('ordem-celular').addEventListener('change', (evento) => {
    const [coluna, direcao] = evento.target.value.split(':');
    ordem = { coluna, direcao };
    pagina = 1;
    mostrarNotas();
  });

  carregar();
});
