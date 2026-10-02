// Aba Despachos do financeiro: acertos de carga (notas entregues x parcelas geradas).
//
// A chave de acesso é a mesma do financeiro (fica no sessionStorage).
// Sem chave, volta para a página do financeiro, que pede a chave.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (texto) => {
  if (!texto) return '—';
  const [data, hora] = String(texto).split(' ');
  return `${dataBR(data)}${hora ? ` ${hora}` : ''}`;
};
// Nome da pessoa; sem nome cadastrado, mostra o código (ex.: "conferente código 2")
const pessoa = (nome, codigo, rotulo) =>
  (nome && String(nome).trim()) || (codigo != null ? `${rotulo} código ${codigo}` : '—');
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

// Situação do despacho em linguagem simples (a ordem importa: a primeira que valer)
//   Não processado: o acerto ainda não gerou títulos no contas a receber
//   Falta receber:  alguma nota foi entregue sem pagamento completo
//   Conferir:       os títulos gerados não batem com o que foi recebido
//   Ok:             tudo recebido e processado
const SITUACOES = {
  SEM_PARCELAS: { texto: 'Não processado', classe: 'situacao--sem' },
  SEM_NOTAS: { texto: 'Sem notas', classe: 'situacao--cancelada' },
  DESCOBERTO: { texto: 'Falta receber', classe: 'situacao--devolucao' },
  DIFERENCA: { texto: 'Conferir', classe: 'situacao--devolucao' },
  CONFERIDO: { texto: 'Ok', classe: 'situacao--faturada' },
  // Despachos sem acerto (vêm da Saída para a lista do Retorno)
  PENDENTE: { texto: 'Pendente de recebimento', classe: 'situacao--sem' },
  PAGO_FORA: { texto: 'Recebido fora do acerto', classe: 'situacao--devolucao' },
};
const FILTRO_TEXTO = Object.fromEntries(Object.entries(SITUACOES).map(([k, v]) => [k, v.texto]));

function situacaoDoDespacho(a) {
  if (a.situacao === 'PENDENTE') {
    const semAcerto = Number(a.notas_sem_acerto) || 0;
    return semAcerto > 0 && Number(a.notas_pagas_fora) === semAcerto ? 'PAGO_FORA' : 'PENDENTE';
  }
  if (a.situacao === 'SEM_PARCELAS' || a.situacao === 'SEM_NOTAS') return a.situacao;
  if (Number(a.a_descoberto) > 0.01) return 'DESCOBERTO';
  return a.situacao;
}

// Nome da forma de pagamento pelo código (quando o PROCFIT não trouxer a descrição)
const FORMAS = {
  0: 'Carteira', 1: 'Boleto', 2: 'Depósito', 3: 'Cheque', 4: 'Dinheiro',
  6: 'Cartão de crédito', 11: 'PIX', 12: 'Cartão de débito',
};
const nomeForma = (codigo, descricao) =>
  (descricao && descricao.trim()) || FORMAS[codigo] || (codigo != null ? `Forma ${codigo}` : 'Não informada');

// Contas bancárias do PROCFIT (CONTAS_BANCARIAS)
const CONTAS = { 1: 'Itaú Matriz', 2: 'Itaú Itaperi' };
const nomeConta = (codigo) =>
  (codigo == null || Number(codigo) === 0 ? '—' : CONTAS[Number(codigo)] ?? `conta ${codigo}`);

// Tempo entre dois momentos "AAAA-MM-DD HH:MM" (ex.: abertura e processamento do acerto)
function duracao(inicio, fim) {
  if (!inicio || !fim) return null;
  const ler = (texto) => new Date(`${String(texto).replace(' ', 'T')}:00`);
  const minutos = Math.round((ler(fim) - ler(inicio)) / 60000);
  if (!Number.isFinite(minutos) || minutos < 0) return null;
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 24 * 60) return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
  const dias = Math.floor(minutos / (24 * 60));
  const horas = Math.floor((minutos % (24 * 60)) / 60);
  return `${plural(dias, 'dia', 'dias')}${horas ? ` e ${horas} h` : ''}`;
}

// Há quanto tempo (até agora) a partir de "AAAA-MM-DD HH:MM"
function duracaoAteHoje(inicio) {
  const d = new Date();
  const agora = `${formatarData(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return duracao(inicio, agora);
}

// Situação do título no contas a receber (vem do extrato do título)
function situacaoTitulo(t) {
  // Nem a ligação do PROCFIT nem a busca pelo nome acharam título: valor que ninguém vai cobrar
  if (t.titulo_receber == null) return { texto: 'Não virou título', classe: 'situacao--sem', alerta: true };
  const pendente = Number(t.pendente) || 0;
  const recebido = Number(t.recebido) || 0;
  const cancelado = Number(t.cancelado) || 0;
  const noAcerto = Number(t.cancelado_no_acerto) || 0;
  // Cancelamento feito por uma pessoa (motivo diferente do automático do acerto)
  if (cancelado - noAcerto > 0.009 && pendente <= 0.009) return { texto: 'Cancelado', classe: 'situacao--sem', alerta: true };
  // Dinheiro: o processamento do acerto encerra o título da nota (cancelamento automático)
  if (noAcerto > 0.009 && pendente <= 0.009 && pendente >= -0.009) return { texto: 'Pago no acerto', classe: 'situacao--faturada' };
  if (pendente < -0.009) return { texto: 'Recebido a mais', classe: 'situacao--sem', alerta: true };
  if (pendente <= 0.009) return { texto: 'Pago', classe: 'situacao--faturada' };
  if (recebido > 0.009) return { texto: 'Pago em parte', classe: 'situacao--devolucao' };
  return { texto: 'Em aberto', classe: 'situacao--sem' };
}

// Em quais formulários o título foi baixado (ex.: "Retorno de despacho", "Bancos ×2")
const LUGARES_BAIXA = [
  ['baixas_despacho', 'Retorno de despacho'], ['baixas_bancos', 'Bancos por títulos'],
  ['baixas_caixa', 'Caixa'], ['baixas_cofre', 'Cofre da loja'], ['baixas_outras', 'Outra tela'],
];
// Número do acerto citado no motivo automático ("Recebimento e Conferência de Despacho: 150")
const acertoDoMotivo = (motivo) => (String(motivo ?? '').match(/(\d+)\s*$/) || [])[1] ?? null;

function lugaresDaBaixa(t) {
  const lugares = LUGARES_BAIXA
    .filter(([campo]) => Number(t[campo]) > 0)
    .map(([campo, nome]) => (Number(t[campo]) > 1 ? `${nome} ×${t[campo]}` : nome));
  if (Number(t.cancelado_no_acerto) > 0.009) {
    const n = acertoDoMotivo(t.motivo_acerto);
    lugares.push(n ? `Acerto ${n}` : 'Acerto do despacho');
  }
  if (Number(t.cancelado) - (Number(t.cancelado_no_acerto) || 0) > 0.009) {
    lugares.push(`Cancelamento manual${t.cancelamento_manual ? ` nº ${t.cancelamento_manual}` : ''}`);
  }
  return lugares;
}
// Sinal de baixa em duplicidade: baixado em mais de um formulário, ou recebido a mais que o valor.
// (Duas baixas no MESMO lugar podem ser pagamentos parciais legítimos; se passarem do valor,
// o título fica com saldo negativo e cai na segunda regra.)
function baixaSuspeita(t) {
  return lugaresDaBaixa(t).length > 1 || Number(t.pendente) < -0.009 || Boolean(situacaoTitulo(t).alerta);
}

// Quanto da linha do acerto já foi pago: o valor da linha menos o que o título ainda deve
// (cancelamento manual não conta como pagamento)
function valorPago(t) {
  if (t.titulo_receber == null || situacaoTitulo(t).texto === 'Cancelado') return 0;
  const devendo = Math.max(0, Number(t.pendente) || 0);
  return Math.max(0, (Number(t.valor) || 0) - devendo);
}

// Rastreio da baixa: quando, onde, nº do registro, quem fez e se foi parcial
// ex.: "17/09/2026 14:36 · Bancos por títulos nº 2483 · por FULANA · parcial R$ 500,00 de R$ 1.000,00"
function textoBaixa(t) {
  const lugares = lugaresDaBaixa(t);
  if (!lugares.length) return '';
  const quando = t.baixa_hora ? dataHoraBR(t.baixa_hora)
    : (t.ultima_baixa ? dataBR(t.ultima_baixa)
      : (t.cancelado_no_acerto_em ? dataHoraBR(t.cancelado_no_acerto_em) : null));
  const partes = [quando];
  const unicoBanco = lugares.length === 1 && Number(t.baixas_bancos) === 1;
  partes.push(unicoBanco && t.baixa_registro ? `${lugares[0]} nº ${t.baixa_registro}` : lugares.join(' + '));
  if (t.baixa_usuario) partes.push(`por ${t.baixa_usuario}`);
  if (situacaoTitulo(t).texto === 'Pago em parte') {
    partes.push(`parcial: ${dinheiro(t.recebido)} de ${dinheiro(t.valor)}`);
  }
  if (Number(t.estornos)) partes.push(plural(t.estornos, 'estorno', 'estornos'));
  return partes.filter(Boolean).join(' · ');
}

// Colunas de situação usadas nas tabelas de títulos
function celulasSituacaoTitulo(t) {
  const info = situacaoTitulo(t);
  const baixa = textoBaixa(t) || '—';
  const pendente = Number(t.pendente) || 0;
  return [
    td(span(info.texto, `situacao ${info.classe}`), 'esquerda'),
    td(baixa, `esquerda${baixaSuspeita(t) ? ' negativo' : ''}`),
    td(pendente > 0.009 ? dinheiro(pendente) : '—', pendente > 0.009 ? 'negativo' : null),
  ];
}

// Resumo dos títulos: quantos pagos, em aberto e com baixa suspeita
function resumoTitulos(lista) {
  const abertos = lista.filter((t) => ['Em aberto', 'Pago em parte'].includes(situacaoTitulo(t).texto));
  const valorAberto = abertos.reduce((soma, t) => soma + (Number(t.pendente) || 0), 0);
  const suspeitos = lista.filter(baixaSuspeita);
  return { abertos, valorAberto, suspeitos };
}

// Recebimentos no banco repetidos: mais de um na MESMA conta para o mesmo acerto
function recebimentosRepetidos(bancos) {
  const porConta = new Map();
  for (const b of bancos) {
    const conta = Number(b.conta) || 0;
    if (!porConta.has(conta)) porConta.set(conta, []);
    porConta.get(conta).push(b);
  }
  return [...porConta.values()].filter((lista) => lista.length > 1);
}

// ===== Estado da tela =====
let acertos = [];          // lista do período (já filtrada pela situação na API)
let situacaoAtual = null;  // cartão clicado
let ordem = { coluna: 'acerto', direcao: 'desc' };

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

function filtrosAtuais() {
  return {
    inicio: el('inicio').value || null,
    fim: el('fim').value || null,
    busca: el('pesquisa-termo').value.trim() || null,
    situacao: situacaoAtual,
  };
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// ===== Períodos prontos =====
function periodoPronto(nome) {
  const hoje = new Date();
  const diasAtras = (dias) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias);
  const periodos = {
    hoje: [hoje, hoje],
    '7dias': [diasAtras(6), hoje],
    '30dias': [diasAtras(29), hoje],
    mes: [new Date(hoje.getFullYear(), hoje.getMonth(), 1), hoje],
    'mes-passado': [new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), new Date(hoje.getFullYear(), hoje.getMonth(), 0)],
    tudo: [null, null],
  };
  const [inicio, fim] = periodos[nome] ?? [null, null];
  return { inicio: inicio ? formatarData(inicio) : '', fim: fim ? formatarData(fim) : '' };
}

function marcarAtalho(ativo) {
  for (const item of el('atalhos').querySelectorAll('[data-periodo]')) {
    item.classList.toggle('atalho--ativo', item === ativo);
  }
}

// ===== Carregar =====
async function carregar() {
  estado.salvar('despachos', { ...filtrosAtuais(), situacao: situacaoAtual, visao: 'retorno' });
  mostrarStatus('Carregando os acertos…');
  try {
    const { resumo, lista } = await buscar('despachos', filtrosAtuais());
    acertos = lista;
    mostrarGraficoDespachos(lista);
    mostrarResumo(resumo);
    mostrarCartoes(resumo);
    mostrarMarcadores();
    mostrarLista();
    el('painel').hidden = false;
    mostrarStatus(`${situacaoAtual ? `${FILTRO_TEXTO[situacaoAtual]} · ` : ''}atualizado às ${
      new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarResumo(r) {
  el('total-notas').textContent = dinheiro(r.total_notas);
  el('total-explica').textContent = `${plural(r.acertos, 'despacho', 'despachos')} · ${plural(r.notas, 'nota', 'notas')}`;
  el('ind-informado').replaceChildren(dinheiro(r.total_informado), span('pago pelos clientes'));
  el('ind-descoberto').replaceChildren(dinheiro(r.a_descoberto),
    span(`${plural(r.com_descoberto, 'despacho', 'despachos')} com nota paga em parte`));
  el('ind-parcelas').replaceChildren(inteiro(r.sem_parcelas), span('sem títulos no contas a receber'));
  el('ind-diferenca').replaceChildren(inteiro(r.com_diferenca), span('títulos diferentes do recebido'));
  el('ind-descoberto').classList.toggle('negativo', r.a_descoberto > 0.01);
  el('ind-parcelas').classList.toggle('negativo', r.sem_parcelas > 0);
  el('ind-diferenca').classList.toggle('negativo', r.com_diferenca > 0);
}

function span(texto, classe) {
  const s = document.createElement('span');
  s.textContent = texto;
  if (classe) s.className = classe;
  return s;
}

// Cartões-filtro: clicar mostra só os acertos daquela situação
function mostrarCartoes(r) {
  const cartoes = [
    { situacao: null, titulo: 'Todos', valor: (Number(r.acertos) || 0) + (Number(r.pendentes) || 0),
      nota: 'com acerto e pendentes' },
    { situacao: 'DESCOBERTO', titulo: 'Falta receber', valor: r.com_descoberto, nota: 'nota paga em parte' },
    { situacao: 'SEM_PARCELAS', titulo: 'Não processados', valor: r.sem_parcelas, nota: 'sem títulos gerados' },
    { situacao: 'DIFERENCA', titulo: 'Para conferir', valor: r.com_diferenca, nota: 'títulos ≠ recebido' },
    { situacao: 'PENDENTE', titulo: 'Pendentes de recebimento', valor: r.pendentes ?? 0,
      nota: `${dinheiro(r.valor_pendente)} sem acerto lançado` },
  ];
  el('cartoes').replaceChildren(...cartoes.map((c) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `cartao${situacaoAtual === c.situacao ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(situacaoAtual === c.situacao));
    const titulo = document.createElement('h3');
    titulo.textContent = c.titulo;
    const valor = document.createElement('p');
    valor.className = 'cartao-valor';
    valor.textContent = inteiro(c.valor);
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = c.nota;
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      situacaoAtual = c.situacao;
      carregar();
    });
    return botao;
  }));
}

function mostrarMarcadores() {
  const area = el('marcadores');
  if (!situacaoAtual) {
    area.hidden = true;
    area.replaceChildren();
    return;
  }
  const marcador = document.createElement('button');
  marcador.type = 'button';
  marcador.className = 'marcador';
  marcador.append(`Filtro: ${FILTRO_TEXTO[situacaoAtual]}`, span('×'));
  marcador.addEventListener('click', () => {
    situacaoAtual = null;
    carregar();
  });
  area.replaceChildren(marcador);
  area.hidden = false;
}

// ===== Lista de acertos (ordenável clicando no nome da coluna) =====
const COLUNAS = [
  { titulo: 'Despacho', chave: 'carga', esquerda: true },
  { titulo: 'Data', chave: 'data_recebimento', esquerda: true },
  { titulo: 'Notas', chave: 'notas' },
  { titulo: 'Valor das notas', chave: 'total_notas' },
  { titulo: 'Recebido', chave: 'total_informado' },
  { titulo: 'Falta receber', chave: 'a_descoberto' },
  { titulo: 'Situação', chave: 'situacao_tela', esquerda: true },
];

function ordenados() {
  const { coluna, direcao } = ordem;
  const fator = direcao === 'asc' ? 1 : -1;
  return [...acertos].sort((a, b) => {
    const x = a[coluna];
    const y = b[coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
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
    const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕');
    seta.className = 'ordenar__seta';
    seta.setAttribute('aria-hidden', 'true');
    botao.append(coluna.titulo, seta);
    botao.addEventListener('click', () => {
      ordem = { coluna: coluna.chave, direcao: ativa && crescente ? 'desc' : 'asc' };
      mostrarLista();
    });
    th.append(botao);
    linha.append(th);
  }
  return linha;
}

function td(conteudo, classe) {
  const celula = document.createElement('td');
  if (classe) celula.className = classe;
  if (conteudo instanceof Node) celula.append(conteudo);
  else celula.textContent = conteudo ?? '—';
  return celula;
}

function comAuxiliar(texto, auxiliar, classe) {
  const celula = td(texto, classe);
  if (auxiliar) {
    const extra = span(auxiliar);
    extra.className = 'qtd';
    celula.append(extra);
  }
  return celula;
}

function etiquetaSituacao(situacao) {
  const info = SITUACOES[situacao] ?? { texto: situacao, classe: '' };
  const etiqueta = span(info.texto);
  etiqueta.className = `situacao ${info.classe}`;
  return etiqueta;
}

// Recebido × falta receber por dia (colunas empilhadas)
function mostrarGraficoDespachos(lista) {
  const dias = new Map();
  for (const a of lista) {
    if (a.situacao === 'PENDENTE') continue;   // sem acerto: não tem data de recebimento
    const dia = String(a.data_recebimento ?? '').slice(0, 10);
    if (!dia) continue;
    const d = dias.get(dia) ?? { recebido: 0, falta: 0 };
    d.recebido += Number(a.total_informado) || 0;
    d.falta += Math.max(0, Number(a.a_descoberto) || 0);
    dias.set(dia, d);
  }
  const ordenados = [...dias.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  graficos.colunas(el('grafico-despachos'), {
    titulo: 'Recebido e falta receber por dia',
    empilhado: true,
    rotulos: ordenados.map(([dia]) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`),
    series: [
      { nome: 'Recebido', valores: ordenados.map(([, d]) => d.recebido), cor: 'var(--verde)' },
      { nome: 'Falta receber', valores: ordenados.map(([, d]) => d.falta), cor: graficos.ALERTA },
    ],
    vazio: 'Nenhum despacho no período.',
  });
}

function mostrarLista() {
  const tabela = el('tabela-acertos');
  tabela.tHead.replaceChildren(cabecalho());
  for (const a of acertos) a.situacao_tela = SITUACOES[situacaoDoDespacho(a)]?.texto ?? '';
  el('titulo-lista').textContent = situacaoAtual ? `Despachos · ${FILTRO_TEXTO[situacaoAtual]}` : 'Despachos';

  const corpo = tabela.tBodies[0];
  if (acertos.length === 0) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum despacho encontrado com esses filtros.', 'vazio');
    vazio.colSpan = COLUNAS.length;
    linha.append(vazio);
    corpo.replaceChildren(linha);
  } else {
    corpo.replaceChildren(...ordenados().map((a) => {
      const linha = document.createElement('tr');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'link-pedido';
      botao.textContent = a.carga ? `Despacho ${a.carga}` : `Acerto ${a.acerto}`;
      botao.title = 'Ver as notas e como cada uma foi paga';
      const pendente = a.situacao === 'PENDENTE';
      botao.addEventListener('click', () => (pendente ? abrirDespachoJanela(a.carga) : abrirAcerto(a.acerto)));
      const falta = Number(a.a_descoberto) || 0;
      const dias = pendente ? duracaoAteHoje(a.criado_em) : null;
      linha.append(
        comAuxiliar(botao, pendente ? 'sem acerto' : `acerto ${a.acerto}`, 'esquerda sem-quebra'),
        pendente
          ? comAuxiliar(`saiu ${dataBR(a.saida)}`, [dias ? `há ${dias}` : null,
            `conferente ${pessoa(a.usuario_nome, a.usuario, 'usuário')}`].filter(Boolean).join(' · '), 'esquerda sem-quebra')
          : comAuxiliar(dataBR(a.data_recebimento), `lançado por ${pessoa(a.usuario_nome, a.usuario, 'usuário')}`, 'esquerda sem-quebra'),
        td(inteiro(a.notas)),
        td(dinheiro(a.total_notas)),
        td(dinheiro(a.total_informado)),
        td(falta > 0.01 ? dinheiro(falta) : '—', falta > 0.01 ? 'negativo' : null),
        td(etiquetaSituacao(situacaoDoDespacho(a)), 'esquerda'),
      );
      return linha;
    }));
  }

  // Rodapé: soma do que está na lista
  const soma = (campo) => acertos.reduce((t, a) => t + (Number(a[campo]) || 0), 0);
  const rodape = document.createElement('tr');
  const rotulo = td(`Total (${plural(acertos.length, 'despacho', 'despachos')})`, 'esquerda');
  rotulo.colSpan = 2;
  rodape.append(rotulo, td(inteiro(soma('notas'))), td(dinheiro(soma('total_notas'))),
    td(dinheiro(soma('total_informado'))), td(dinheiro(soma('a_descoberto'))), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Janela do acerto =====
function janelaAcerto() {
  let dialogo = el('janela-acerto');
  if (dialogo) return dialogo;
  dialogo = document.createElement('dialog');
  dialogo.id = 'janela-acerto';
  dialogo.className = 'detalhe';
  dialogo.innerHTML = `
    <header class="detalhe__topo">
      <div>
        <h2 id="acerto-titulo">Acerto</h2>
        <p id="acerto-resumo" class="detalhe__resumo"></p>
      </div>
      <div class="detalhe__acoes">
        <button type="button" class="botao-secundario" id="acerto-fechar">Fechar</button>
      </div>
    </header>
    <p id="acerto-status" class="status" role="status"></p>
    <div id="acerto-corpo" class="detalhe__corpo pedido-corpo"></div>`;
  document.body.append(dialogo);
  el('acerto-fechar').addEventListener('click', () => dialogo.close());
  return dialogo;
}

function tabelaSimples(colunas, linhas, rodape) {
  const rolagem = document.createElement('div');
  rolagem.className = 'tabela-rolagem';
  const tabela = document.createElement('table');
  tabela.className = 'tabela tabela--pedido';
  const cab = document.createElement('tr');
  for (const [titulo, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = titulo;
    if (esquerda) th.className = 'esquerda';
    cab.append(th);
  }
  tabela.createTHead().append(cab);
  const corpo = tabela.createTBody();
  for (const linha of linhas) corpo.append(linha);
  if (rodape) tabela.createTFoot().append(rodape);
  rolagem.append(tabela);
  return rolagem;
}

function linhaDe(...celulas) {
  const linha = document.createElement('tr');
  linha.append(...celulas);
  return linha;
}

function aviso(texto) {
  const p = document.createElement('p');
  p.className = 'pedido-obs';
  p.textContent = texto;
  return p;
}

async function abrirAcerto(numero) {
  const dialogo = janelaAcerto();
  el('acerto-titulo').textContent = `Acerto ${numero}`;
  el('acerto-resumo').textContent = '';
  el('acerto-status').textContent = 'Carregando o acerto…';
  el('acerto-status').classList.remove('status--erro');
  el('acerto-corpo').replaceChildren();
  if (!dialogo.open) dialogo.showModal();

  try {
    const dados = await buscar(`despachos/${numero}`);
    const { titulo, resumo, partes } = montarAcerto(numero, dados);
    el('acerto-status').textContent = '';
    el('acerto-titulo').textContent = titulo;
    el('acerto-resumo').textContent = resumo;
    el('acerto-corpo').replaceChildren(...partes);
  } catch (erro) {
    el('acerto-status').textContent = erro.message;
    el('acerto-status').classList.add('status--erro');
  }
}

// Conteúdo completo de um acerto (usado na janela e ao abrir um despacho na lista).
// opcoes.titulosAbertos: mostra a tabela de títulos já aberta
function montarAcerto(numero, resposta, opcoes = {}) {
  {
    const { acerto: a, notas, parcelas, cartoes, bancos = [] } = resposta;
    const tituloJanela = a.carga ? `Despacho ${a.carga}` : `Acerto ${numero}`;
    const resumoJanela = [
      `acerto ${numero}`,
      `recebido em ${dataBR(a.data_recebimento)}`,
      `lançado ${dataHoraBR(a.digitado_em)} por ${pessoa(a.usuario_nome, a.usuario, 'usuário')}`,
    ].join(' · ');

    const partes = [];
    const titulo = (texto) => {
      const h3 = document.createElement('h3');
      h3.textContent = texto;
      return h3;
    };

    // Junta as linhas de cada nota (pagamento dividido vem em mais de uma linha)
    const cartoesPorNota = new Map();
    for (const c of cartoes) {
      if (!cartoesPorNota.has(c.nota)) cartoesPorNota.set(c.nota, []);
      cartoesPorNota.get(c.nota).push(c);
    }
    const porNota = new Map();
    for (const linha of notas) {
      const chaveNota = linha.nota ?? `sem-nota-${linha.detalhe}`;
      if (!porNota.has(chaveNota)) {
        porNota.set(chaveNota, { ...linha, valor_nota: null, pago: 0, formas: [] });
      }
      const nota = porNota.get(chaveNota);
      if (linha.copia_de == null || nota.valor_nota == null) nota.valor_nota = Number(linha.valor_nota) || nota.valor_nota;
      if (!nota.pedido && linha.pedido) nota.pedido = linha.pedido;
      const valor = Number(linha.valor_informado) || 0;
      if (valor > 0.001) {
        nota.pago += valor;
        nota.formas.push({ nome: nomeForma(linha.modalidade, linha.forma), valor });
      }
    }
    // Cartão: acrescenta bandeira e parcelas ao nome da forma
    for (const nota of porNota.values()) {
      const lista = cartoesPorNota.get(nota.nota) ?? [];
      const complemento = lista.map((c) => [c.bandeira, c.parcelas > 1 ? `${c.parcelas}x` : null].filter(Boolean).join(' '))
        .filter(Boolean).join(', ');
      if (complemento) {
        const cartao = nota.formas.find((f) => /cart|créd|cred|déb|deb/i.test(f.nome));
        if (cartao) cartao.nome += ` (${complemento})`;
      }
    }
    const listaNotas = [...porNota.values()];
    const totalNotas = listaNotas.reduce((t, n) => t + (Number(n.valor_nota) || 0), 0);
    const totalPago = listaNotas.reduce((t, n) => t + n.pago, 0);
    const totalFalta = Math.max(0, totalNotas - totalPago);

    // Resumo do despacho: quanto veio em cada forma (confere com o dinheiro e os comprovantes)
    const porForma = new Map();
    for (const nota of listaNotas) {
      for (const f of nota.formas) {
        const nome = f.nome.replace(/\s*\(.*\)$/, '');
        porForma.set(nome, (porForma.get(nome) ?? 0) + f.valor);
      }
    }
    const dados = document.createElement('dl');
    dados.className = 'pedido-dados';
    const item = (rotulo, valor, alerta = false) => {
      const bloco = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      if (valor instanceof Node) dd.append(valor); else dd.textContent = valor ?? '—';
      if (alerta) dd.className = 'negativo';
      bloco.append(dt, dd);
      dados.append(bloco);
    };
    item('Situação', etiquetaSituacao(situacaoDoDespacho(a)));
    item('Valor das notas', dinheiro(totalNotas));
    item('Recebido', dinheiro(totalPago));
    item('Falta receber', totalFalta > 0.01 ? dinheiro(totalFalta) : 'nada', totalFalta > 0.01);
    // Pessoas e momentos de cada etapa do despacho
    item('Conferente (criou o despacho)', [pessoa(a.carga_usuario_nome, a.carga_usuario, 'usuário'),
      a.carga_criada_em ? dataHoraBR(a.carga_criada_em) : null].filter(Boolean).join(' · '));
    item('Responsável', pessoa(a.responsavel_nome, a.responsavel, 'código'));
    item(a.situacao === 'SEM_PARCELAS' ? 'Lançou e não processou' : 'Lançou o retorno',
      pessoa(a.usuario_nome, a.usuario, 'usuário'));
    item('Abertura (início das baixas)', dataHoraBR(a.digitado_em));
    item('Processado em', a.processado_em ? dataHoraBR(a.processado_em) : 'ainda não processado', !a.processado_em);
    const tempo = duracao(a.digitado_em, a.processado_em);
    if (tempo) item('Tempo até processar', tempo);
    for (const [nome, valor] of [...porForma.entries()].sort((x, y) => y[1] - x[1])) {
      item(nome, dinheiro(valor));
    }
    partes.push(dados);

    // Recebimentos repetidos no banco (ex.: conferência processada mais de uma vez)
    for (const repetidos of recebimentosRepetidos(bancos)) {
      partes.push(aviso(`Atenção: ${repetidos.length} recebimentos no banco para este acerto na conta `
        + `${nomeConta(repetidos[0].conta)} (nº ${repetidos.map((b) => b.recebimento).join(', ')}). `
        + 'O normal é um só: confira se houve duplicidade.'));
    }

    // Aviso só quando o processamento não bate com o recebido
    const diferenca = Number(a.diferenca) || 0;
    if (a.situacao === 'SEM_PARCELAS') {
      partes.push(aviso('Este acerto ainda não foi processado: as notas abaixo não viraram títulos no contas a receber.'));
    } else if (Math.abs(diferenca) > 0.01) {
      partes.push(aviso(`Atenção: os títulos gerados somam ${dinheiro(a.total_parcelas)}, `
        + `${dinheiro(Math.abs(diferenca))} ${diferenca > 0 ? 'a menos' : 'a mais'} que o recebido.`));
    }

    // Notas, uma por linha, com todas as formas de pagamento
    partes.push(titulo(`Notas (${listaNotas.length})`));
    const rotuloTotal = td('Total', 'esquerda');
    rotuloTotal.colSpan = 4;
    partes.push(tabelaSimples(
      [['Nota', true], ['Cliente', true], ['Pedido', true], ['Como foi pago', true], ['Valor da nota'], ['Pago'], ['Falta pagar']],
      listaNotas.map((n) => {
        const falta = (Number(n.valor_nota) || 0) - n.pago;
        // Para onde foi o que faltou: os títulos desta nota gerados no acerto (ex.: "10174/Parc")
        const destino = falta > 0.01
          ? parcelas.filter((p) => String(p.titulo ?? '').startsWith(`${n.nota}/`)
              && !['Pago no acerto'].includes(situacaoTitulo(p).texto))
            .map((p) => `${p.titulo}: ${situacaoTitulo(p).texto}`
              + `${Number(p.pendente) > 0.009 ? ` ${dinheiro(p.pendente)}` : ''}`)
            .join(' · ')
          : '';
        const formas = n.formas.length
          ? n.formas.map((f) => `${f.nome} ${dinheiro(f.valor)}`).join(' + ')
          : 'nenhum pagamento informado';
        return linhaDe(
          td(n.nota ? `NF ${n.nota}` : '—', 'esquerda sem-quebra'),
          td([n.codigo_cliente, n.cliente].filter(Boolean).join(' · ') || '—', 'esquerda'),
          td(pedidoJanela.link(n.pedido), 'esquerda'),
          td(formas, n.formas.length ? 'esquerda' : 'esquerda negativo'),
          td(dinheiro(n.valor_nota)),
          td(dinheiro(n.pago)),
          falta > 0.01 ? comAuxiliar(dinheiro(falta), destino || null, 'negativo') : td('—'),
        );
      }),
      linhaDe(rotuloTotal, td(dinheiro(totalNotas)), td(dinheiro(totalPago)),
        td(totalFalta > 0.01 ? dinheiro(totalFalta) : '—', totalFalta > 0.01 ? 'negativo' : null)),
    ));

    // Títulos gerados: fechado, para quem quiser conferir
    if (parcelas.length) {
      const detalhes = document.createElement('details');
      detalhes.className = 'mais-detalhes';
      if (opcoes.titulosAbertos) detalhes.open = true;
      const resumo = document.createElement('summary');
      const rt = resumoTitulos(parcelas);
      resumo.textContent = `Ver os títulos gerados no contas a receber (${parcelas.length} · ${dinheiro(a.total_parcelas)}`
        + `${rt.abertos.length ? ` · ${rt.abertos.length} em aberto` : ' · todos pagos'})`;
      detalhes.append(resumo, tabelaSimples(
        [['Título', true], ['Cliente', true], ['Forma', true], ['Vencimento', true], ['Valor'], ['Pago'],
          ['No sistema', true], ['Baixa (data · onde)', true], ['Em aberto']],
        parcelas.map((p) => linhaDe(
          td(p.titulo ?? '—', 'esquerda sem-quebra'),
          td([p.codigo_cliente, p.cliente].filter(Boolean).join(' · ') || '—', 'esquerda'),
          td(p.forma ?? '—', 'esquerda'),
          td(dataBR(p.vencimento), 'esquerda'),
          td(dinheiro(p.valor)),
          td(valorPago(p) > 0.009 ? dinheiro(valorPago(p)) : '—'),
          ...celulasSituacaoTitulo(p),
        )),
      ));
      if (rt.suspeitos.length) {
        partes.push(aviso(`Atenção: ${plural(rt.suspeitos.length, 'título foi baixado', 'títulos foram baixados')} `
          + 'em mais de um lugar, recebido a mais, cancelado manualmente ou não virou título. Confira na tabela abaixo (em vermelho).'));
      }
      partes.push(detalhes);
    }

    return { titulo: tituloJanela, resumo: resumoJanela, partes };
  }
}

// ===== Excel: a mesma lista da tela =====
async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/despachos/excel', window.location.origin);
    for (const [nome, valor] of Object.entries(filtrosAtuais())) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const cabecalhoArquivo = resposta.headers.get('Content-Disposition') || '';
    const nome = (cabecalhoArquivo.match(/filename="([^"]+)"/) || [])[1] || 'acertos-despacho.xlsx';
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

// ===== Saída: as cargas que deixaram a empresa =====
const SITUACOES_CARGA = {
  EM_ROTA: { texto: 'Em rota', classe: 'situacao--sem' },
  PARCIAL: { texto: 'Acertada em parte', classe: 'situacao--devolucao' },
  ACERTADA: { texto: 'Acertada', classe: 'situacao--faturada' },
};
let cargas = [];
let cargaSituacao = null;
let cargaAberta = null;
let soPagasFora = false;   // cartão "Pagas fora do acerto" (filtro feito na tela)
let ordemCargas = { coluna: 'saida', direcao: 'desc' };

async function carregarCargas() {
  estado.salvar('despachos', { ...filtrosAtuais(), situacaoCarga: cargaSituacao, visao: 'saida' });
  mostrarStatus('Carregando as cargas…');
  try {
    const dados = await buscar('despachos/cargas', { ...filtrosAtuais(), situacao: cargaSituacao });
    cargas = dados.lista;
    mostrarResumoCargas(dados.resumo);
    mostrarCartoesCargas(dados.resumo);
    // Pesquisou o número de um despacho: já abre o detalhe dele
    const termo = el('pesquisa-termo').value.trim();
    const achado = /^\d+$/.test(termo) ? cargas.find((c) => String(c.carga) === termo) : null;
    if (achado) cargaAberta = achado.carga;
    mostrarCargas();
    if (achado) abrirNotasDaCarga(achado.carga);
    el('painel').hidden = false;
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarResumoCargas(r) {
  el('carga-total').textContent = dinheiro(r.valor);
  el('carga-explica').textContent = `${plural(r.cargas, 'carga', 'cargas')} · ${plural(r.notas, 'nota', 'notas')}`;
  el('carga-ind-rota').replaceChildren(inteiro(r.em_rota), span(`${dinheiro(r.valor_em_rota)} sem acerto`));
  el('carga-ind-parcial').replaceChildren(inteiro(r.parciais), span(`${dinheiro(r.valor_parcial)} faltando`));
  el('carga-ind-acertada').replaceChildren(inteiro(r.acertadas), span('cargas fechadas'));
  el('carga-ind-informado').replaceChildren(dinheiro(r.informado), span('recebido dos motoristas'));
  el('carga-ind-rota').classList.toggle('negativo', Number(r.em_rota) > 0);
  el('carga-ind-parcial').classList.toggle('negativo', Number(r.parciais) > 0);
}

function mostrarCartoesCargas(r) {
  const itens = [
    { id: null, titulo: 'Todas', valor: inteiro(r.cargas), nota: `${dinheiro(r.valor)} em notas` },
    { id: 'EM_ROTA', titulo: 'Em rota', valor: inteiro(r.em_rota), nota: `${dinheiro(r.valor_em_rota)} sem acerto`, alerta: true },
    { id: 'PARCIAL', titulo: 'Acertadas em parte', valor: inteiro(r.parciais), nota: `${dinheiro(r.valor_parcial)} faltando`, alerta: true },
    { id: 'ACERTADA', titulo: 'Acertadas', valor: inteiro(r.acertadas), nota: 'nada pendente' },
  ];
  // Despachos com notas pagas por fora do acerto (ex.: baixadas em Bancos por títulos)
  const fora = cargas.filter((c) => Number(c.notas_pagas_fora) + Number(c.notas_parciais_fora) > 0);
  if (soPagasFora || fora.length) {
    itens.push({
      id: 'FORA', titulo: 'Pagas fora do acerto', valor: inteiro(fora.length),
      nota: `${dinheiro(fora.reduce((t, c) => t + (Number(c.valor_pago_fora) || 0), 0))} baixados em outras telas`,
      alerta: true,
    });
  }
  el('carga-cartoes').replaceChildren(...itens.map((c) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    const ativo = c.id === 'FORA' ? soPagasFora : (!soPagasFora && cargaSituacao === c.id);
    botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const titulo = document.createElement('h3');
    titulo.textContent = c.titulo;
    const valor = document.createElement('p');
    valor.className = `cartao-valor${c.alerta && Number(c.valor.replace(/\D/g, '')) > 0 ? ' negativo' : ''}`;
    valor.textContent = c.valor;
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = c.nota;
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      if (c.id === 'FORA') {
        soPagasFora = !ativo;
        cargaSituacao = null;
      } else {
        soPagasFora = false;
        cargaSituacao = ativo ? null : c.id;
      }
      cargaAberta = null;
      carregarCargas();
    });
    return botao;
  }));
}

function mostrarCargas() {
  estado.salvar('despachos', { ...filtrosAtuais(), situacaoCarga: cargaSituacao, visao: 'saida' });
  const fator = ordemCargas.direcao === 'asc' ? 1 : -1;
  const base = soPagasFora
    ? cargas.filter((c) => Number(c.notas_pagas_fora) + Number(c.notas_parciais_fora) > 0)
    : cargas;
  const lista = [...base].sort((a, b) => {
    const x = a[ordemCargas.coluna];
    const y = b[ordemCargas.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  el('carga-titulo-lista').textContent = `Despachos${soPagasFora ? ' · pagos fora do acerto' : ''} (${inteiro(lista.length)})`;

  const tabela = el('tabela-cargas');
  const cab = document.createElement('tr');
  for (const [texto, campo, esquerda] of [['Despacho', 'carga', true], ['Saída', 'saida', true], ['Rota', 'rota', true],
    ['Conferente', 'conferente', true], ['Notas', 'notas'], ['Valor que saiu', 'valor'],
    ['Acertado', 'informado'], ['Pago fora do acerto', 'valor_pago_fora'], ['Situação', 'situacao', true], ['', null, true]]) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (esquerda) th.className = 'esquerda';
    if (!campo) {
      th.textContent = texto;
    } else {
      const ativa = ordemCargas.coluna === campo;
      const crescente = ordemCargas.direcao === 'asc';
      if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
      const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
      seta.setAttribute('aria-hidden', 'true');
      botao.append(texto, seta);
      botao.addEventListener('click', (evento) => {
        evento.stopPropagation();
        ordemCargas = { coluna: campo, direcao: ativa && crescente ? 'desc' : 'asc' };
        mostrarCargas();
      });
      th.append(botao);
    }
    cab.append(th);
  }
  tabela.tHead.replaceChildren(cab);

  const linhas = [];
  if (!lista.length) {
    const linha = document.createElement('tr');
    const vazio = td('Nenhum despacho com esses filtros.', 'vazio');
    vazio.colSpan = 10;
    linha.append(vazio);
    linhas.push(linha);
  }
  for (const c of lista) {
    const aberta = cargaAberta === c.carga;
    const linha = document.createElement('tr');
    linha.className = `linha-dia${aberta ? ' linha-dia--aberta' : ''}`;
    const info = SITUACOES_CARGA[c.situacao] ?? { texto: c.situacao, classe: '' };
    // Todas as notas sem acerto já foram pagas por fora: não está mais "em rota" de verdade
    const todasPagasFora = Number(c.notas_sem_acerto) > 0 && Number(c.notas_pagas_fora) === Number(c.notas_sem_acerto);
    const infoTela = todasPagasFora && c.situacao !== 'ACERTADA'
      ? { texto: c.situacao === 'EM_ROTA' ? 'Pago fora do acerto' : 'Resto pago fora', classe: 'situacao--devolucao' }
      : info;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-expandir';
    botao.setAttribute('aria-expanded', String(aberta));
    botao.setAttribute('aria-label', aberta ? 'Fechar a carga' : 'Ver as notas da carga');
    botao.textContent = aberta ? '▾' : '▸';
    linha.append(
      // Número do despacho (é o que o conferente usa), com o acerto e o conferente embaixo
      comAuxiliar(`Despacho ${c.carga}`, c.acerto ? `acerto ${c.acerto}` : 'sem acerto', 'esquerda sem-quebra'),
      comAuxiliar(dataBR(c.saida), c.recebimento ? `voltou ${dataBR(c.recebimento)}` : null, 'esquerda sem-quebra'),
      // Rota com o responsável (motorista) embaixo
      comAuxiliar(c.rota || '—', c.responsavel ?? null, 'esquerda'),
      // Conferente = quem criou o despacho, com o momento em que criou
      comAuxiliar(pessoa(c.conferente, c.usuario, 'usuário'),
        c.criado_em ? `criou ${dataHoraBR(c.criado_em)}` : null, 'esquerda'),
      comAuxiliar(inteiro(c.notas), Number(c.notas_acertadas) ? `${inteiro(c.notas_acertadas)} acertadas` : null),
      td(dinheiro(c.valor), 'coluna-final'),
      td(Number(c.informado) > 0.009 ? dinheiro(c.informado) : '—'),
      // Notas que não passaram pelo acerto, mas foram baixadas em outra tela (ex.: Bancos por títulos)
      comAuxiliar(Number(c.valor_pago_fora) > 0.009 ? dinheiro(c.valor_pago_fora) : '—',
        Number(c.notas_pagas_fora) + Number(c.notas_parciais_fora) > 0
          ? `${inteiro(Number(c.notas_pagas_fora) + Number(c.notas_parciais_fora))} de ${inteiro(c.notas_sem_acerto)} notas sem acerto`
          : null),
      td(span(infoTela.texto, `situacao ${infoTela.classe}`), 'esquerda'),
      td(botao, 'esquerda'),
    );
    const alternar = async () => {
      cargaAberta = aberta ? null : c.carga;
      mostrarCargas();
      if (!aberta) await abrirNotasDaCarga(c.carga);
    };
    botao.addEventListener('click', (evento) => { evento.stopPropagation(); alternar(); });
    linha.addEventListener('click', alternar);
    linhas.push(linha);
    if (aberta) {
      const detalhe = document.createElement('tr');
      detalhe.className = 'linha-itens';
      detalhe.id = `carga-notas-${c.carga}`;
      const celula = document.createElement('td');
      celula.colSpan = 10;
      celula.append(span('Carregando as notas da carga…', 'explica'));
      detalhe.append(celula);
      linhas.push(detalhe);
    }
  }
  tabela.tBodies[0].replaceChildren(...linhas);

  const soma = (campo) => lista.reduce((t, c) => t + (Number(c[campo]) || 0), 0);
  const rodape = document.createElement('tr');
  const rotulo = td(`Total (${plural(lista.length, 'despacho', 'despachos')})`, 'esquerda');
  rotulo.colSpan = 4;
  rodape.append(rotulo, td(inteiro(soma('notas'))), td(dinheiro(soma('valor'))), td(dinheiro(soma('informado'))),
    td(soma('valor_pago_fora') > 0.009 ? dinheiro(soma('valor_pago_fora')) : '—'), td(''), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// Ao abrir um despacho: dados do despacho, o acerto completo (o mesmo detalhe da janela
// do Retorno) e as notas que ainda não voltaram
async function abrirNotasDaCarga(carga) {
  const linha = el(`carga-notas-${carga}`);
  if (!linha) return;
  try {
    const caixa = await montarDespacho(carga);
    linha.firstChild.replaceChildren(caixa);
  } catch (erro) {
    linha.firstChild.replaceChildren(span(erro.message, 'status--erro'));
  }
}

// O mesmo detalhe do despacho, numa janela (usado na lista do Retorno para os pendentes)
async function abrirDespachoJanela(carga) {
  const dialogo = janelaAcerto();
  el('acerto-titulo').textContent = `Despacho ${carga}`;
  el('acerto-resumo').textContent = 'pendente de recebimento: ainda sem acerto lançado';
  el('acerto-status').textContent = 'Carregando o despacho…';
  el('acerto-status').classList.remove('status--erro');
  el('acerto-corpo').replaceChildren();
  if (!dialogo.open) dialogo.showModal();
  try {
    const caixa = await montarDespacho(carga);
    el('acerto-status').textContent = '';
    el('acerto-corpo').replaceChildren(caixa);
  } catch (erro) {
    el('acerto-status').textContent = erro.message;
    el('acerto-status').classList.add('status--erro');
  }
}

// Monta o detalhe completo de um despacho (dados, acertos e notas) e devolve a caixa pronta
async function montarDespacho(carga) {
  {
    const { carga: c, notas, acertos = [], titulosDasNotas = [] } = await buscar(`despachos/cargas/${carga}`);
    const detalhesAcertos = await Promise.all(acertos.map((a) => buscar(`despachos/${a.acerto}`)));
    const partes = [];
    const titulo = (texto) => {
      const h3 = document.createElement('h3');
      h3.textContent = texto;
      return h3;
    };

    // ----- 1) O despacho: quem conferiu, quando saiu e quanto tempo ficou na rua -----
    if (c) {
      const dados = document.createElement('dl');
      dados.className = 'pedido-dados';
      const item = (rotulo, valor, alerta = false) => {
        const bloco = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = rotulo;
        const dd = document.createElement('dd');
        dd.textContent = valor ?? '—';
        if (alerta) dd.className = 'negativo';
        bloco.append(dt, dd);
        dados.append(bloco);
      };
      item('Conferente (criou o despacho)', pessoa(c.conferente, c.usuario, 'usuário'));
      item('Criado em', dataHoraBR(c.criado_em));
      item('Rota', c.rota || '—');
      item('Responsável', c.responsavel ?? '—');
      item('Valor que saiu', `${dinheiro(c.valor)} · ${plural(c.notas, 'nota', 'notas')}`);
      if (acertos.length) {
        item('Da saída ao retorno', duracao(c.criado_em, acertos[0].aberto_em) ?? '—');
        const ultimo = acertos[acertos.length - 1];
        item('Da saída ao processamento', duracao(c.criado_em, ultimo.processado_em) ?? 'sem registro de hora');
      } else {
        const ha = duracaoAteHoje(c.criado_em);
        item('Retorno', `pendente de recebimento${ha ? ` há ${ha}` : ''} (sem acerto)`, true);
      }
      partes.push(dados);
    }

    // ----- 2) Cada acerto, com o mesmo detalhe da janela do Retorno -----
    acertos.forEach((a, i) => {
      const montado = montarAcerto(a.acerto, detalhesAcertos[i], { titulosAbertos: true });
      const cabecalho = document.createElement('div');
      cabecalho.style.display = 'flex';
      cabecalho.style.flexWrap = 'wrap';
      cabecalho.style.gap = '0.75rem';
      cabecalho.style.alignItems = 'center';
      const h3 = titulo(`Acerto ${a.acerto}`);
      h3.style.margin = '0';
      const abrir = document.createElement('button');
      abrir.type = 'button';
      abrir.className = 'botao-secundario';
      abrir.textContent = 'Abrir em janela';
      abrir.addEventListener('click', (evento) => {
        evento.stopPropagation();
        abrirAcerto(a.acerto);
      });
      cabecalho.append(h3, span(montado.resumo, 'explica'), abrir);
      partes.push(cabecalho, ...montado.partes);
    });

    // ----- 3) Notas: as que não voltaram (ou todas, se ainda não há acerto) -----
    // Para cada nota, os títulos dela no contas a receber: situação e onde foram baixados.
    const titulosPorNota = new Map();
    for (const t of titulosDasNotas) {
      const chaveNota = Number(t.nota);
      if (!titulosPorNota.has(chaveNota)) titulosPorNota.set(chaveNota, []);
      titulosPorNota.get(chaveNota).push(t);
    }
    const pendentes = acertos.length ? notas.filter((n) => !(Number(n.informado) > 0.009)) : notas;
    if (acertos.length && !pendentes.length) {
      partes.push(span('Todas as notas do despacho voltaram no acerto.', 'explica'));
    }
    if (pendentes.length) {
      partes.push(titulo(acertos.length
        ? `Notas que não voltaram no acerto (${pendentes.length})`
        : `Notas do despacho (${pendentes.length})`));

      // Notas que não passaram pelo acerto, mas cujo título já foi baixado em outro formulário
      const baixadasFora = pendentes.filter((n) => (titulosPorNota.get(Number(n.nota)) ?? [])
        .some((t) => lugaresDaBaixa(t).length > 0));
      if (baixadasFora.length) {
        partes.push(aviso(`${plural(baixadasFora.length, 'nota deste despacho foi baixada', 'notas deste despacho foram baixadas')} `
          + 'fora do acerto do despacho (veja a coluna "Títulos da nota").'));
      }

      const celulaTitulos = (lista) => {
        const celula = document.createElement('td');
        celula.className = 'esquerda';
        if (!lista.length) {
          celula.textContent = titulosDasNotas.length ? 'sem título no contas a receber' : '—';
          return celula;
        }
        for (const t of lista) {
          const linhaTitulo = document.createElement('div');
          const info = situacaoTitulo(t);
          const rastreio = textoBaixa(t);
          linhaTitulo.append(
            `${t.titulo} · ${nomeForma(t.modalidade)} · ${dinheiro(t.valor)} `,
            span(info.texto, `situacao ${info.classe}`),
          );
          if (rastreio) linhaTitulo.append(span(` ${rastreio}`, baixaSuspeita(t) ? 'negativo' : 'explica'));
          celula.append(linhaTitulo);
        }
        return celula;
      };

      let somaValor = 0;
      let somaAberto = 0;
      const linhas = pendentes.map((n) => {
        const lista = titulosPorNota.get(Number(n.nota)) ?? [];
        const aberto = lista.reduce((t, x) => t + Math.max(0, Number(x.pendente) || 0), 0);
        somaValor += Number(n.valor) || 0;
        somaAberto += aberto;
        return linhaDe(
          td(`NF ${n.nota}`, 'esquerda sem-quebra'),
          comAuxiliar(n.cliente ?? `Cliente ${n.cod_cliente}`, `código ${n.cod_cliente}`, 'esquerda'),
          td(pedidoJanela.link(n.pedido), 'esquerda'),
          td(dinheiro(n.valor)),
          celulaTitulos(lista),
          td(lista.length ? (aberto > 0.009 ? dinheiro(aberto) : '—') : '—', aberto > 0.009 ? 'negativo' : null),
        );
      });
      const rotulo = td(`Total (${plural(pendentes.length, 'nota', 'notas')})`, 'esquerda');
      rotulo.colSpan = 3;
      partes.push(tabelaSimples(
        [['Nota', true], ['Cliente', true], ['Pedido', true], ['Valor da nota'], ['Títulos da nota (situação · onde baixou)', true],
          ['Em aberto']],
        linhas,
        linhaDe(rotulo, td(dinheiro(somaValor)), td(''),
          td(somaAberto > 0.009 ? dinheiro(somaAberto) : '—', somaAberto > 0.009 ? 'negativo' : null)),
      ));
    }

    const caixa = document.createElement('div');
    caixa.style.display = 'grid';
    caixa.style.gap = '0.75rem';
    caixa.style.padding = '0.5rem 0.25rem 1rem';
    // Cliques dentro do detalhe não fecham a linha
    caixa.addEventListener('click', (evento) => evento.stopPropagation());
    caixa.append(...partes);
    return caixa;
  }
}

// Excel das cargas (respeita o período, a pesquisa e o cartão escolhido)
async function baixarExcelCargas() {
  const botao = el('carga-excel');
  botao.disabled = true;
  try {
    const url = new URL('/financeiro/despachos/cargas/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({ ...filtrosAtuais(), situacao: cargaSituacao })) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'cargas-despacho.xlsx';
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

// Alterna entre as duas partes da tela
function mostrarVisao(qual) {
  const saida = qual === 'saida';
  el('visao-saida').hidden = !saida;
  el('visao-retorno').hidden = saida;
  el('ver-saida').classList.toggle('divisao__item--ativa', saida);
  el('ver-retorno').classList.toggle('divisao__item--ativa', !saida);
  if (saida) carregarCargas();
  else carregar();
}

// Recarrega a parte da tela que está aberta (Saída ou Retorno)
function recarregar() {
  if (el('visao-saida').hidden) carregar();
  else {
    cargaAberta = null;
    carregarCargas();
  }
}

// Pesquisa rápida pelo número do despacho, logo acima de cada lista.
// Usa a mesma caixa de pesquisa do topo; número pesquisa em todas as datas.
function filtroRapido(depoisDe) {
  const form = document.createElement('form');
  form.className = 'filtro-rapido';
  form.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin:0.5rem 0 0.75rem';
  const campo = document.createElement('input');
  campo.type = 'search';
  campo.inputMode = 'numeric';
  campo.placeholder = 'Nº do despacho';
  campo.setAttribute('aria-label', 'Número do despacho');
  campo.style.cssText = 'padding:0.5rem 0.75rem;border:1px solid #cfd8d3;border-radius:8px;font:inherit;width:11rem';
  const buscarBotao = document.createElement('button');
  buscarBotao.type = 'submit';
  buscarBotao.className = 'botao-secundario';
  buscarBotao.textContent = 'Buscar despacho';
  const limpar = document.createElement('button');
  limpar.type = 'button';
  limpar.className = 'botao-secundario';
  limpar.textContent = 'Mostrar todos';
  form.append(campo, buscarBotao, limpar);
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    el('pesquisa-termo').value = campo.value.trim();
    el('limpar-pesquisa').hidden = !campo.value.trim();
    recarregar();
  });
  limpar.addEventListener('click', () => {
    campo.value = '';
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    recarregar();
  });
  depoisDe.after(form);
  return campo;
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    window.location.href = 'financeiro.html';
    return;
  }
  pedidoJanela.configurar({ setor: 'financeiro' });

  // Menu de módulos (Vendas | Financeiro) para quem tem mais de um setor
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

  // Período inicial: últimos 30 dias
  const inicial = periodoPronto('30dias');
  el('inicio').value = inicial.inicio;
  el('fim').value = inicial.fim;

  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    recarregar();
  });
  el('atalhos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-periodo]');
    if (!botao) return;
    const periodo = periodoPronto(botao.dataset.periodo);
    el('inicio').value = periodo.inicio;
    el('fim').value = periodo.fim;
    marcarAtalho(botao);
    recarregar();
  });
  for (const id of ['inicio', 'fim']) {
    el(id).addEventListener('input', () => marcarAtalho(null));
  }

  el('form-pesquisa').addEventListener('submit', (evento) => {
    evento.preventDefault();
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    recarregar();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    recarregar();
  });

  // Pesquisa rápida pelo número do despacho em cima das duas listas
  filtroRapido(el('carga-titulo-lista').closest('.bloco-topo'));
  filtroRapido(el('titulo-lista'));
  el('baixar-excel').addEventListener('click', baixarExcel);

  // Cargas: alternar entre as duas partes e baixar o Excel das cargas
  el('ver-saida').addEventListener('click', () => mostrarVisao('saida'));
  el('ver-retorno').addEventListener('click', () => mostrarVisao('retorno'));
  el('carga-excel').addEventListener('click', () => baixarExcelCargas());

  // Volta como estava: mesma parte da tela (saída ou retorno) e mesmos filtros
  const guardado = estado.aplicarCampos('despachos', { inicio: 'inicio', fim: 'fim', busca: 'pesquisa-termo' });
  if (guardado.situacao) situacaoAtual = guardado.situacao;
  if (guardado.situacaoCarga) cargaSituacao = guardado.situacaoCarga;
  el('limpar-pesquisa').hidden = !el('pesquisa-termo').value.trim();

  mostrarVisao(guardado.visao === 'retorno' ? 'retorno' : 'saida');
});
