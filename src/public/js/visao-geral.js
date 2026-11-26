// Visão geral do financeiro (nov/2026).
// Uma chamada só (/financeiro/visao-geral) traz tudo; a tela só desenha.
// A loja escolhida no menu vale aqui também (modulos.marcarLoja).

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => (valor === null || valor === undefined ? '—' : moeda.format(Number(valor) || 0));
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const dataCurta = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—');

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

// Cada nível da "Saúde dos números": texto da pílula e a classe de etiqueta que já existe
const NIVEIS = {
  critico:   { texto: 'Crítico',   classe: 'situacao--sem' },
  atencao:   { texto: 'Atenção',   classe: 'situacao--devolucao' },
  ok:        { texto: 'Em dia',    classe: 'situacao--faturada' },
  sem_dados: { texto: 'Sem dados', classe: 'situacao--cancelada' },
};

async function buscar() {
  const url = new URL('/financeiro/visao-geral', window.location.origin);
  if (typeof modulos !== 'undefined') modulos.marcarLoja(url); // loja do menu
  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.href = 'financeiro.html';
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Esta chave não tem acesso ao financeiro.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar a visão geral.');
  return corpo;
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

function aviso(id, texto) {
  el(id).hidden = !texto;
  el(id).textContent = texto ?? '';
}

function celula(conteudo, classe) {
  const td = document.createElement('td');
  if (classe) td.className = classe;
  if (conteudo instanceof Node) td.append(conteudo);
  else td.textContent = conteudo;
  return td;
}

function comQtd(texto, qtd) {
  const span = document.createDocumentFragment();
  span.append(texto);
  if (qtd) {
    const pequeno = document.createElement('span');
    pequeno.className = 'qtd';
    pequeno.textContent = qtd;
    span.append(document.createElement('br'), pequeno);
  }
  return span;
}

// ===== 1. Posição hoje =====
function cartao({ titulo, valor, nota, link, classeValor }) {
  const a = document.createElement('a');
  a.className = 'cartao cartao--link';
  a.href = link;
  const h3 = document.createElement('h3');
  h3.textContent = titulo;
  const v = document.createElement('p');
  v.className = `cartao-valor${classeValor ? ` ${classeValor}` : ''}`;
  v.textContent = valor;
  const n = document.createElement('p');
  n.className = 'cartao-nota';
  n.textContent = nota;
  a.append(h3, v, n);
  return a;
}

function mostrarPosicao(p) {
  aviso('aviso-posicao', p.erro);
  const { clientes, cartao: c, pagar } = p;
  el('cartoes-posicao').replaceChildren(
    cartao({
      titulo: 'A receber de clientes', valor: dinheiro(clientes.aberto), link: 'financeiro.html#titulos',
      nota: `${inteiro(clientes.devedores)} clientes · ${inteiro(clientes.titulos)} títulos · vencido ${dinheiro(clientes.vencido)}`,
    }),
    cartao({
      titulo: 'Cartão a receber', valor: dinheiro(c.aberto), link: 'financeiro.html#cartao',
      nota: `no prazo ${dinheiro(c.a_vencer)} · vencido ${dinheiro(c.vencido)}`,
    }),
    cartao({
      titulo: 'A pagar', valor: dinheiro(pagar.aberto), link: 'pagar.html#pagar',
      nota: `${inteiro(pagar.fornecedores)} fornecedores · vencido ${dinheiro(pagar.vencido)}`,
    }),
    cartao({
      titulo: 'Saldo (receber − pagar)', valor: dinheiro(p.saldo), link: 'financeiro.html#titulos',
      classeValor: p.saldo !== null && p.saldo < 0 ? 'negativo' : '',
      nota: 'clientes + cartão no prazo − a pagar',
    }),
  );
}

// ===== 2. Entradas × saídas =====
function mostrarSemanas(semanas, quantas) {
  el('etiqueta-semanas').textContent = `próximas ${quantas} semanas`;
  graficos.colunas(el('grafico-semanas'), {
    rotulos: semanas.map((s) => dataCurta(s.semana)),
    series: [
      { nome: 'Entradas (clientes + cartão)', valores: semanas.map((s) => s.entradas) },
      { nome: 'Saídas (a pagar)', valores: semanas.map((s) => s.saidas), cor: 'var(--outros)' },
    ],
    formato: 'moeda',
    altura: 240,
    vazio: 'Nada previsto para as próximas semanas.',
  });

  el('tabela-semanas').tBodies[0].replaceChildren(...semanas.map((s) => {
    const tr = document.createElement('tr');
    const negativo = (v) => (v < 0 ? 'negativo' : '');
    tr.append(
      celula(`semana de ${dataCurta(s.semana)}`),
      celula(dinheiro(s.clientes)),
      celula(dinheiro(s.cartao)),
      celula(dinheiro(s.entradas)),
      celula(dinheiro(s.saidas)),
      celula(dinheiro(s.saldo), negativo(s.saldo)),
      celula(dinheiro(s.acumulado), `coluna-saldo ${negativo(s.acumulado)}`),
    );
    return tr;
  }));
}

// ===== 3. Saúde dos números =====
function mostrarSaude(itens) {
  el('tabela-saude').tBodies[0].replaceChildren(...itens.map((item) => {
    const tr = document.createElement('tr');
    if (item.nivel === 'critico') tr.className = 'linha-vencida';
    const nivel = NIVEIS[item.nivel] ?? NIVEIS.sem_dados;
    const pilula = document.createElement('span');
    pilula.className = `situacao ${nivel.classe}`;
    pilula.textContent = nivel.texto;
    const abrir = document.createElement('a');
    abrir.href = item.link;
    abrir.className = 'ver-detalhes';
    abrir.textContent = 'Abrir'; // a seta vem do estilo .ver-detalhes
    tr.append(
      celula(pilula, 'esquerda'),
      celula(comQtd(item.texto, item.erro ?? item.detalhe), 'esquerda'),
      celula(item.erro ? '—' : inteiro(item.quantidade)),
      celula(item.erro ? '—' : dinheiro(item.valor)),
      celula(abrir),
    );
    return tr;
  }));
}

// ===== 4. Onde o dinheiro está =====
function mostrarEtapas(etapas) {
  el('cartoes-etapas').replaceChildren(...etapas.map((e) => {
    const li = document.createElement('li');
    li.className = 'etapa';
    const card = cartao({
      titulo: `${e.etapa} · ${e.titulo}`,
      valor: e.erro ? '—' : dinheiro(e.valor),
      nota: e.erro ?? `${inteiro(e.quantidade)} ${e.unidade} · ${e.nota}`,
      link: e.link,
    });
    li.append(card);
    return li;
  }));
}

// ===== 5. Prazos médios =====
function mostrarPrazos(p) {
  aviso('aviso-prazos', p.erro);
  const dias = (v) => (v === null || v === undefined ? '—' : `${inteiro(v)} dias`);
  const numero = (rotulo, valor, nota, alerta = false) => {
    const div = document.createElement('div');
    div.className = 'numero';
    const dt = document.createElement('dt');
    dt.textContent = rotulo;
    const dd = document.createElement('dd');
    dd.textContent = valor;
    const span = document.createElement('span');
    span.className = `nota${alerta ? ' nota--alerta' : ''}`;
    span.textContent = nota;
    div.append(dt, dd, span);
    return div;
  };
  const d = p.diferenca;
  el('numeros-prazos').replaceChildren(
    numero('Prazo médio de recebimento', dias(p.recebimento), 'da emissão até o cliente pagar'),
    numero('Prazo médio de pagamento', dias(p.pagamento), 'da emissão até a empresa pagar'),
    numero('Diferença', dias(d),
      d === null ? '' : d > 0 ? 'a empresa paga antes de receber: financia o cliente com o próprio caixa'
        : 'a empresa recebe antes de pagar', d !== null && d > 0),
  );
}

// ===== Carregamento =====
let carregando = false;
async function carregar() {
  if (carregando) return;
  carregando = true;
  mostrarStatus('Carregando a visão geral…');
  try {
    const dados = await buscar();
    mostrarPosicao(dados.posicao);
    mostrarSemanas(dados.semanas, dados.semanas_previstas);
    mostrarSaude(dados.saude);
    mostrarEtapas(dados.etapas ?? []);
    mostrarPrazos(dados.prazos);
    el('painel').hidden = false;
    const hora = new Date(dados.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const loja = typeof modulos !== 'undefined' ? await modulos.nomeDaLoja?.() : null;
    mostrarStatus(`${loja ? `${loja} · ` : 'Todas as lojas · '}atualizado às ${hora}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  } finally {
    carregando = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    window.location.href = 'financeiro.html';
    return;
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'financeiro');
    modulos.aoMudarLoja(() => carregar()); // trocar a loja no menu atualiza a tela sem recarregar
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
  carregar();
});
