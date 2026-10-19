// Painel da Precificação. Cada passo da construção acrescenta uma parte da tela aqui.
//
// Parte 1 — "O custo está certo?": as notas de compra em quatro situações.
// A API manda as quatro listas de uma vez; trocar de situação ou pesquisar não chama a API de novo.

const el = (id) => document.getElementById(id);
const inteiro = (v) => new Intl.NumberFormat('pt-BR').format(Number(v) || 0);
const dinheiro = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
// "2026-10-15" -> "15/10/2026"; "2026-10-15 19:22" -> "15/10/2026 19:22"
const dataBR = (t) => (t ? `${t.slice(0, 10).split('-').reverse().join('/')}${t.length > 10 ? ` ${t.slice(11, 16)}` : ''}` : '–');
// Sem acento e em minúsculas, para "acai" achar "AÇAÍ"
const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

let dados = null;
let dias = 90;
let situacaoAtual = 'parada';

// O que cada situação significa, como aparece no cartão e quais colunas a lista mostra
const SITUACOES = {
  parada: {
    titulo: 'Mercadoria parada',
    explica: (d) => `Notas de fornecedores de mercadoria que ainda não entraram no estoque. `
      + `Em laranja, as que passaram de ${d.prazo_entrada_dias} dias desde a emissão.`,
    nota: (r, d) => (r.notas
      ? `${dinheiro(r.valor)} · ${inteiro(r.atrasadas)} com mais de ${d.prazo_entrada_dias} dias`
      : 'nenhuma nota parada'),
    alerta: (r) => r.atrasadas > 0,
    colunaDias: 'Dias parada',
  },
  nao_lancada: {
    titulo: 'Chegou e não foi lançada',
    explica: () => 'Notas emitidas contra o CNPJ que não viraram nota de compra no PROCFIT. '
      + 'Ficam de fora as transferências entre as empresas do grupo, as devoluções e as notas canceladas.',
    nota: (r) => (r.notas ? dinheiro(r.valor) : 'nenhuma nota'),
    alerta: (r) => r.atrasadas > 0,
    colunaDias: 'Dias desde a emissão',
  },
  entrou: {
    titulo: 'Entrou no estoque',
    explica: () => 'Notas finalizadas pela logística: o custo do produto já foi atualizado no PROCFIT. '
      + 'Dias = quanto tempo a nota levou da emissão até entrar.',
    nota: (r) => (r.notas ? `espera média de ${String(r.dias_medio ?? 0).replace('.', ',')} dias` : 'nenhuma nota'),
    alerta: () => false,
    colunaDias: 'Dias até entrar',
  },
  sem_entrada: {
    titulo: 'Sem entrada no sistema',
    explica: () => 'Notas de fornecedores que nunca tiveram nenhuma nota finalizada: matéria-prima da produção '
      + '(que ainda não tem processo no sistema) ou uso e consumo. Não entram no custo de revenda e não são atraso.',
    nota: (r) => (r.notas ? `${dinheiro(r.valor)} · produção ou uso e consumo` : 'nenhuma nota'),
    alerta: () => false,
    colunaDias: 'Dias desde a emissão',
  },
};

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// Chama a API com a chave do login; trata "sem login" e "sem acesso" num lugar só
async function chamar(caminho) {
  const resposta = await fetch(caminho, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.reload();
    throw new Error('Login expirado');
  }
  if (resposta.status === 403) throw new Error('Este acesso não tem a tela de precificação liberada.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar.');
  return corpo;
}

function celula(texto, classe = '') {
  const td = document.createElement('td');
  td.textContent = texto;
  if (classe) td.className = classe;
  return td;
}

// Cartões das quatro situações: cada um troca a lista de baixo
function mostrarSituacoes() {
  el('situacoes').replaceChildren(...Object.entries(SITUACOES).map(([id, s]) => {
    const r = dados.resumo[id];
    const ativo = situacaoAtual === id;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `cartao${ativo ? ' cartao--ativo' : ''}`;
    botao.setAttribute('aria-pressed', String(ativo));
    const titulo = document.createElement('h3');
    titulo.textContent = s.titulo;
    const valor = document.createElement('p');
    valor.className = `cartao-valor${s.alerta(r) ? ' negativo' : ''}`;
    valor.textContent = plural(r.notas, 'nota', 'notas');
    const nota = document.createElement('p');
    nota.className = 'cartao-nota';
    nota.textContent = s.nota(r, dados);
    botao.append(titulo, valor, nota);
    botao.addEventListener('click', () => {
      situacaoAtual = id;
      mostrarSituacoes();
      mostrarLista();
    });
    return botao;
  }));
}

function cabecalho(colunas) {
  const linha = document.createElement('tr');
  for (const [texto, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = texto;
    if (esquerda) th.className = 'esquerda';
    linha.append(th);
  }
  el('tabela-notas').tHead.replaceChildren(linha);
}

function mostrarLista() {
  const s = SITUACOES[situacaoAtual];
  const termo = normalizar(el('pesquisa-termo').value.trim());
  const todas = dados.listas[situacaoAtual];
  const itens = termo
    ? todas.filter((n) => normalizar(n.fornecedor).includes(termo) || String(n.numero) === termo)
    : todas;

  el('titulo-lista').textContent = `${s.titulo} (${termo ? `${inteiro(itens.length)} de ` : ''}${inteiro(todas.length)})`;
  el('explica-lista').textContent = s.explica(dados);

  const xml = situacaoAtual === 'nao_lancada';
  const colunas = xml
    ? [['Nota', true], ['Fornecedor', true], ['Para', true], ['Operação', true],
      ['Emissão', false], [s.colunaDias, false], ['Valor', false]]
    : [['Nota', true], ['Fornecedor', true], ['Empresa', true], ['Emissão', false], ['Lançada', false],
      ...(situacaoAtual === 'entrou' ? [['Entrou', false]] : []), [s.colunaDias, false], ['Valor', false]];
  cabecalho(colunas);

  const linhas = itens.map((n) => {
    const tr = document.createElement('tr');
    if (n.atrasada) tr.className = 'linha-vencida';
    const dias = celula(inteiro(n.dias), n.atrasada ? 'atraso' : '');
    if (xml) {
      const fornecedor = celula(n.fornecedor, 'esquerda');
      if (n.erro) {
        const erro = document.createElement('span');
        erro.className = 'qtd negativo';
        erro.textContent = `Erro ao importar: ${n.erro}`;
        fornecedor.append(document.createElement('br'), erro);
      }
      tr.append(celula(n.numero, 'esquerda'), fornecedor, celula(n.destinatario ?? '–', 'esquerda'),
        celula(n.operacao ?? '–', 'esquerda'), celula(dataBR(n.emissao)), dias, celula(dinheiro(n.valor)));
    } else {
      tr.append(celula(n.numero, 'esquerda'), celula(n.fornecedor ?? '–', 'esquerda'),
        celula(n.nome_empresa ?? `Empresa ${n.empresa}`, 'esquerda'),
        celula(dataBR(n.emissao)), celula(dataBR(n.lancada_em)),
        ...(situacaoAtual === 'entrou' ? [celula(dataBR(n.entrou_em))] : []),
        dias, celula(dinheiro(n.valor)));
    }
    return tr;
  });

  if (!linhas.length) {
    const tr = document.createElement('tr');
    const vazio = celula(termo ? 'Nenhuma nota encontrada nesta pesquisa.' : 'Nenhuma nota nesta situação no período.', 'vazio');
    vazio.colSpan = colunas.length;
    tr.append(vazio);
    linhas.push(tr);
  }
  el('tabela-notas').tBodies[0].replaceChildren(...linhas);
}

async function carregar() {
  mostrarStatus('Lendo as notas no PROCFIT…');
  try {
    dados = await chamar(`/precificacao/notas?dias=${dias}`);
    mostrarSituacoes();
    mostrarLista();
    el('bloco-notas').hidden = false;
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    mostrarStatus(`notas dos últimos ${dias} dias · atualizado às ${hora}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'precificacao');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.reload();
      return;
    }
  }

  // Período: clicar num atalho já atualiza
  el('atalhos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-dias]');
    if (!botao) return;
    dias = Number(botao.dataset.dias);
    for (const b of el('atalhos').querySelectorAll('button')) b.classList.toggle('atalho--ativo', b === botao);
    carregar();
  });
  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregar();
  });

  // Pesquisa: filtra na própria tela
  el('form-pesquisa').addEventListener('submit', (evento) => evento.preventDefault());
  el('pesquisa-termo').addEventListener('input', () => {
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    if (dados) mostrarLista();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    if (dados) mostrarLista();
  });

  carregar();
});
