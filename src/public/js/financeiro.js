// Painel financeiro: contas a receber.
// A chave fica guardada na aba (sessionStorage), igual ao painel de vendas.

const el = (id) => document.getElementById(id);

const dinheiro = (valor) =>
  valor === null || valor === undefined
    ? '—'
    : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const numero = (valor) => (valor === null || valor === undefined ? '—' : Number(valor).toLocaleString('pt-BR'));

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

// ===== Chave de acesso =====
// Mesma chave guardada pelo painel de vendas: quem tem acesso aos dois
// troca de módulo sem informar a chave de novo.
const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

class ChaveInvalida extends Error {}
class SemAcesso extends Error {}

async function buscar(rota, parametros = {}) {
  const url = new URL(`/financeiro/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }

  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });

  if (resposta.status === 401) throw new ChaveInvalida();
  if (resposta.status === 403) throw new SemAcesso('Esta chave não tem acesso ao financeiro.');
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  }
  return resposta.json();
}

// ===== Estado da tela =====
const ABAS = {
  titulos:  { situacao: 'aberto',  modalidade: null, titulo: 'Títulos em aberto' },
  parciais: { situacao: 'parcial', modalidade: null, titulo: 'Títulos com baixa parcial' },
  boletos:  { situacao: 'aberto',  modalidade: 1,    titulo: 'Boletos em aberto, por vencimento' },
  cobranca: { situacao: 'aberto',  modalidade: null, titulo: 'Títulos vencidos', somenteVencidos: true },
};

let abaAtual = 'titulos';
let pagina = 1;
let totalPaginas = 1;
const LIMITE = 50;

function filtrosAtuais() {
  const aba = ABAS[abaAtual];
  return {
    situacao: aba.situacao,
    inicio: el('inicio').value || null,
    // Na aba de cobrança, mostra só o que já venceu: "até ontem"
    fim: aba.somenteVencidos ? ontem() : (el('fim').value || null),
    modalidade: aba.modalidade ?? (el('modalidade').value || null),
    busca: el('pesquisa-termo').value.trim() || null,
    limite: LIMITE,
    pagina,
  };
}

function ontem() {
  const data = new Date();
  data.setDate(data.getDate() - 1);
  return data.toISOString().slice(0, 10);
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// ===== Desenho da tela =====
function mostrarResumo(resumo) {
  el('total-pendente').textContent = dinheiro(resumo.pendente);
  el('resumo-linha').textContent =
    `${numero(resumo.titulos)} títulos de ${numero(resumo.clientes)} clientes · ` +
    `valor original ${dinheiro(resumo.valor_original)} · já recebido ${dinheiro(resumo.recebido)}`;

  const cartoes = [
    { titulo: 'Vencido', valor: dinheiro(resumo.vencido), nota: 'já passou do vencimento' },
    { titulo: 'A vencer', valor: dinheiro(resumo.a_vencer), nota: 'ainda dentro do prazo' },
    { titulo: 'Baixa parcial', valor: dinheiro(resumo.pendente_parciais), nota: `${numero(resumo.titulos_parciais)} títulos` },
    { titulo: 'Clientes', valor: numero(resumo.clientes), nota: 'com valor em aberto' },
  ];

  el('cartoes').replaceChildren(
    ...cartoes.map((c) => {
      const caixa = document.createElement('article');
      caixa.className = 'cartao';
      const titulo = document.createElement('h3');
      titulo.textContent = c.titulo;
      const valor = document.createElement('p');
      valor.className = 'cartao-valor';
      valor.textContent = c.valor;
      const nota = document.createElement('p');
      nota.className = 'cartao-nota';
      nota.textContent = c.nota;
      caixa.append(titulo, valor, nota);
      return caixa;
    }),
  );
}

function mostrarFaixas(faixas) {
  const corpo = el('tabela-faixas').querySelector('tbody');
  corpo.replaceChildren(
    ...faixas.map((f) => {
      const linha = document.createElement('tr');
      for (const texto of [f.faixa.replace(/^\d+\.\s*/, ''), numero(f.titulos), numero(f.clientes), dinheiro(f.pendente)]) {
        const celula = document.createElement('td');
        celula.textContent = texto;
        linha.append(celula);
      }
      return linha;
    }),
  );
}

// Nome do cliente clicável: abre a ficha com tudo dele
function celulaCliente(titulo) {
  const td = document.createElement('td');
  td.className = 'esquerda';
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'link-cliente';
  botao.textContent = `${titulo.cod_cliente} · ${titulo.cliente ?? 'sem nome'}`;
  botao.addEventListener('click', () => abrirFicha(titulo.cod_cliente, titulo.cliente));
  td.append(botao);
  return td;
}

function celula(texto, classe = null) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (classe) td.className = classe;
  return td;
}

function mostrarTitulos({ total, lista }) {
  const corpo = el('tabela-titulos').querySelector('tbody');

  if (lista.length === 0) {
    const linha = document.createElement('tr');
    const td = celula('Nenhum título encontrado com esses filtros.');
    td.colSpan = 10;
    linha.append(td);
    corpo.replaceChildren(linha);
  } else {
    corpo.replaceChildren(
      ...lista.map((t) => {
        const linha = document.createElement('tr');
        linha.append(
          celula(dataBR(t.vencimento)),
          celula(t.dias_atraso > 0 ? `${numero(t.dias_atraso)} dias` : 'em dia', t.dias_atraso > 0 ? 'atraso' : null),
          celula(t.nota ?? '—'),
          celula(t.pedido ?? '—'),
          celula(t.titulo ?? '—'),
          celulaCliente(t),
          celula(t.modalidade),
          celula(dinheiro(t.valor)),
          celula(dinheiro(t.recebido)),
          celula(dinheiro(t.pendente)),
        );
        return linha;
      }),
    );
  }

  // Rodapé com os totais do filtro inteiro (não só da página)
  const rodape = el('tabela-titulos').querySelector('tfoot');
  const linha = document.createElement('tr');
  const rotulo = celula(`Total do filtro (${numero(total.total)} títulos)`);
  rotulo.colSpan = 7;
  linha.append(rotulo, celula(dinheiro(total.valor_original)), celula(dinheiro(total.recebido)), celula(dinheiro(total.pendente)));
  rodape.replaceChildren(linha);

  totalPaginas = Math.max(1, Math.ceil(Number(total.total) / LIMITE));
  el('pagina-atual').textContent = `Página ${pagina} de ${numero(totalPaginas)}`;
  el('anterior').disabled = pagina <= 1;
  el('proxima').disabled = pagina >= totalPaginas;
}

// ===== Carregamento =====
let carregando = false;

async function carregar() {
  if (carregando) return;
  carregando = true;
  mostrarStatus('Carregando…');

  try {
    const filtros = filtrosAtuais();
    const [resumo, faixas, titulos] = await Promise.all([
      buscar('resumo', filtros),
      buscar('faixas-atraso', { empresa: filtros.empresa }),
      buscar('titulos', filtros),
    ]);

    mostrarResumo(resumo);
    mostrarFaixas(faixas);
    mostrarTitulos(titulos);
    mostrarStatus(`${ABAS[abaAtual].titulo} · atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    if (erro instanceof ChaveInvalida) {
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    if (erro instanceof SemAcesso) {
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Esta chave não abre o financeiro. Peça a chave do setor financeiro.');
      return;
    }
    console.error(erro);
    mostrarStatus(erro.message, true);
  } finally {
    carregando = false;
  }
}

// ===== Ficha do cliente =====
const SITUACAO_TEXTO = { ABERTO: 'Em aberto', PARCIAL: 'Baixa parcial', QUITADO: 'Quitado' };

async function abrirFicha(codigo, nome) {
  el('ficha-nome').textContent = nome ?? `Cliente ${codigo}`;
  el('ficha-sub').textContent = `Código ${codigo}`;
  el('ficha-corpo').hidden = true;
  el('ficha-status').textContent = 'Carregando a ficha…';
  el('ficha').showModal();

  try {
    const ficha = await buscar(`clientes/${codigo}`);
    const { financeiro, compras } = ficha;

    el('ficha-cartoes').replaceChildren(
      ...[
        { titulo: 'Pendente', valor: dinheiro(financeiro.pendente), nota: `${numero(financeiro.titulos_abertos)} títulos em aberto` },
        { titulo: 'Vencido', valor: dinheiro(financeiro.vencido), nota: financeiro.maior_atraso ? `maior atraso: ${numero(financeiro.maior_atraso)} dias` : 'nada vencido' },
        { titulo: 'Já comprou', valor: dinheiro(compras.total_comprado), nota: `${numero(compras.documentos)} documentos nos últimos 12 meses` },
        { titulo: 'Último recebimento', valor: dataBR(financeiro.ultimo_recebimento), nota: `última compra em ${dataBR(compras.ultima_compra)}` },
      ].map((c) => {
        const caixa = document.createElement('article');
        caixa.className = 'cartao';
        const titulo = document.createElement('h3');
        titulo.textContent = c.titulo;
        const valor = document.createElement('p');
        valor.className = 'cartao-valor';
        valor.textContent = c.valor;
        const nota = document.createElement('p');
        nota.className = 'cartao-nota';
        nota.textContent = c.nota;
        caixa.append(titulo, valor, nota);
        return caixa;
      }),
    );

    el('ficha-produtos').querySelector('tbody').replaceChildren(
      ...ficha.produtos.map((p) => {
        const linha = document.createElement('tr');
        linha.append(
          celula(p.produto),
          celula(p.descricao ?? '—', 'esquerda'),
          celula(numero(p.quantidade)),
          celula(dinheiro(p.valor)),
        );
        return linha;
      }),
    );

    el('ficha-titulos').querySelector('tbody').replaceChildren(
      ...ficha.titulos.map((t) => {
        const linha = document.createElement('tr');
        linha.append(
          celula(dataBR(t.vencimento)),
          celula(SITUACAO_TEXTO[t.situacao] ?? t.situacao),
          celula(t.nota ?? '—'),
          celula(t.pedido ?? '—'),
          celula(t.titulo ?? '—'),
          celula(dinheiro(t.valor)),
          celula(dinheiro(t.recebido)),
          celula(dinheiro(t.pendente)),
        );
        return linha;
      }),
    );

    el('ficha-status').textContent = '';
    el('ficha-corpo').hidden = false;
  } catch (erro) {
    console.error(erro);
    el('ficha-status').textContent = erro.message ?? 'Não foi possível carregar a ficha.';
  }
}

// ===== Entrada e saída =====
function mostrarEntrada() {
  el('form-chave').hidden = false;
  el('painel').hidden = true;
  el('trocar-chave').hidden = true;
  document.getElementById('modulos').hidden = true;
  el('campo-chave').value = '';
  el('campo-chave').focus();
}

async function mostrarPainel() {
  // Antes de desenhar, pergunta à API o que esta chave abre
  let setores;
  try {
    setores = await modulos.setoresDaChave();
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      mostrarEntrada();
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    setores = ['financeiro']; // API fora do ar: segue e deixa a própria carga avisar
  }

  // Chave de outro setor: vai direto para o módulo dela, sem erro na cara do usuário
  if (!setores.includes('financeiro')) {
    modulos.irPara(setores[0]);
    return;
  }

  el('form-chave').hidden = true;
  el('painel').hidden = false;
  el('trocar-chave').hidden = false;
  modulos.desenharMenu(setores, 'financeiro');
  carregar();
}

document.addEventListener('DOMContentLoaded', () => {
  el('form-chave').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const valor = el('campo-chave').value.trim();
    if (!valor) return;
    chave.guardar(valor);
    mostrarPainel();
  });

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    mostrarEntrada();
  });

  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    pagina = 1;
    carregar();
  });

  el('form-pesquisa').addEventListener('submit', (evento) => {
    evento.preventDefault();
    pagina = 1;
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    carregar();
  });

  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    pagina = 1;
    carregar();
  });

  el('abas').addEventListener('click', (evento) => {
    const botao = evento.target.closest('.aba');
    if (!botao) return;
    abaAtual = botao.dataset.aba;
    pagina = 1;
    for (const aba of el('abas').querySelectorAll('.aba')) {
      aba.classList.toggle('aba--ativa', aba === botao);
    }
    // A modalidade fixa da aba (ex.: boletos) desabilita o seletor
    el('modalidade').disabled = ABAS[abaAtual].modalidade !== null;
    carregar();
  });

  el('ficha-fechar').addEventListener('click', () => el('ficha').close());

  el('anterior').addEventListener('click', () => {
    if (pagina <= 1) return;
    pagina -= 1;
    carregar();
  });

  el('proxima').addEventListener('click', () => {
    if (pagina >= totalPaginas) return;
    pagina += 1;
    carregar();
  });

  if (chave.ler()) mostrarPainel();
  else mostrarEntrada();
});
