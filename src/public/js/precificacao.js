// Painel da Precificação. Cada passo da construção acrescenta uma parte da tela aqui.
//
// Parte 1 — "O custo está certo?": as notas de compra por situação.
// Parte 2 — Fornecedores: o tipo de cada um (revenda, produção, uso e consumo ou misto),
//           um por um ou vários de uma vez (marcando a caixinha da linha).
// A API manda as listas inteiras; trocar de situação ou pesquisar não chama a API de novo.
// Classificar uma nota ou um fornecedor grava no banco do painel e recarrega as duas partes,
// porque uma decisão muda a situação das notas.

const el = (id) => document.getElementById(id);
const inteiro = (v) => new Intl.NumberFormat('pt-BR').format(Number(v) || 0);
const dinheiro = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const decimal = (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(v) || 0);
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
let fornecedores = null;
let dias = 90;
let situacaoAtual = 'parada';
const marcados = new Set(); // códigos dos fornecedores marcados para classificar juntos

// O que cada situação significa, como aparece no cartão e quais colunas a lista mostra
const SITUACOES = {
  parada: {
    titulo: 'Mercadoria parada',
    explica: (d) => 'Notas de revenda que ainda não entraram no estoque. '
      + `Em laranja, as que passaram de ${d.prazo_entrada_dias} dias desde a emissão.`,
    nota: (r, d) => (r.notas ? `${dinheiro(r.valor)} · ${inteiro(r.atrasadas)} com mais de ${d.prazo_entrada_dias} dias` : 'nenhuma nota parada'),
    alerta: (r) => r.atrasadas > 0,
    colunaDias: 'Dias parada',
    classifica: true,
  },
  a_classificar: {
    titulo: 'Nota a classificar',
    explica: () => 'Notas de fornecedores mistos (que mandam revenda e matéria-prima). '
      + 'Escolha o tipo de cada uma: as de revenda passam a contar como mercadoria parada.',
    nota: (r) => (r.notas ? dinheiro(r.valor) : 'nenhuma nota'),
    alerta: (r) => r.notas > 0,
    colunaDias: 'Dias desde a emissão',
    classifica: true,
  },
  nao_lancada: {
    titulo: 'Chegou e não foi lançada',
    explica: (d) => 'Notas emitidas contra o CNPJ que não viraram nota de compra no PROCFIT. '
      + 'Ficam de fora as transferências entre as empresas do grupo, as devoluções e as notas canceladas. '
      + `Em laranja, só as de revenda ou ainda sem tipo, com mais de ${d.prazo_entrada_dias} dias. `
      + 'Comodato, locação, remessa, retorno e combustível já vêm sugeridos como "não é compra".',
    nota: (r) => (r.notas ? `${dinheiro(r.valor)} · ${inteiro(r.atrasadas)} a verificar` : 'nenhuma nota'),
    alerta: (r) => r.atrasadas > 0,
    colunaDias: 'Dias desde a emissão',
  },
  entrou: {
    titulo: 'Entrou no estoque',
    explica: () => 'Notas finalizadas pela logística: o custo do produto já foi atualizado no PROCFIT. '
      + 'Dias = quanto tempo a nota levou da emissão até entrar.',
    nota: (r) => (r.notas ? `espera média de ${decimal(r.dias_medio)} dias` : 'nenhuma nota'),
    alerta: () => false,
    colunaDias: 'Dias até entrar',
  },
  producao_consumo: {
    titulo: 'Produção ou uso e consumo',
    explica: () => 'Notas que não entram no custo de revenda: matéria-prima da produção (que ainda não tem '
      + 'processo no sistema) e uso e consumo. Não são atraso. As de maior valor aparecem primeiro.',
    nota: (r) => (r.notas ? dinheiro(r.valor) : 'nenhuma nota'),
    alerta: () => false,
    colunaDias: 'Dias desde a emissão',
    classifica: true,
  },
};

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// Chama a API com a chave do login; trata "sem login" e "sem acesso" num lugar só
async function chamar(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: { 'x-api-key': chave.ler() ?? '', ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}) },
  });
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

function celula(conteudo, classe = '') {
  const td = document.createElement('td');
  if (conteudo instanceof Node) td.append(conteudo);
  else td.textContent = conteudo;
  if (classe) td.className = classe;
  return td;
}

// Seletor de tipo: a primeira opção (valor vazio) é "seguir o que já vale" (fornecedor ou sugestão).
// Itálico cinza só quando o que vale é a sugestão automática; decisão de uma pessoa fica em texto normal.
function seletor(tipos, atual, textoPadrao, sugerido, aoMudar) {
  const select = document.createElement('select');
  select.className = `seletor-tipo${sugerido ? ' seletor-tipo--sugerido' : ''}`;
  select.append(new Option(textoPadrao, ''));
  for (const [valor, texto] of Object.entries(tipos)) select.append(new Option(texto, valor));
  select.value = atual ?? '';
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await aoMudar(select.value || null);
    } catch (erro) {
      mostrarStatus(erro.message, true);
      select.disabled = false;
    }
  });
  if (sugerido) select.title = 'Sugestão automática: escolha um tipo para confirmar';
  return select;
}

// ---------- Parte 1: notas ----------

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

  const pendentes = dados.fornecedores_a_confirmar;
  el('aviso-fornecedores').hidden = !pendentes;
  el('aviso-fornecedores-texto').textContent = pendentes
    ? `${plural(pendentes, 'fornecedor', 'fornecedores')} deste período ainda com tipo sugerido. `
      + 'Até alguém confirmar, as notas deles seguem a sugestão automática.'
    : '';
}

function cabecalho(tabela, colunas) {
  const linha = document.createElement('tr');
  for (const [texto, esquerda] of colunas) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = texto;
    if (esquerda) th.className = 'esquerda';
    linha.append(th);
  }
  el(tabela).tHead.replaceChildren(linha);
}

// O que a nota segue hoje, quando ninguém classificou a própria nota
function textoPadraoDaNota(n) {
  if (n.tipo_origem === 'fornecedor') {
    return n.tipo ? `Do fornecedor: ${dados.tipos_nota[n.tipo]}` : 'Classificar…';
  }
  if (n.tipo === 'revenda') return 'Revenda (sugerido)';
  if (n.tipo === null) return 'Classificar…';
  return 'Sem entrada (sugerido)';
}

// Nota que não virou nota de compra: o que vale quando ninguém escolheu
const textoPadraoDaNfe = (n) => (n.tipo === 'nao_compra' ? 'Não é compra (sugerido)' : 'Classificar…');

async function classificarNfe(n, tipo) {
  mostrarStatus(`Gravando a nota ${n.numero}…`);
  await chamar(`/precificacao/nfe/${n.registro}`, { method: 'PUT', body: JSON.stringify({ tipo }) });
  await carregar(`Nota ${n.numero} classificada.`);
}

async function classificarNota(n, tipo) {
  mostrarStatus(`Gravando a nota ${n.numero}…`);
  await chamar(`/precificacao/notas/${n.nota_id}`, { method: 'PUT', body: JSON.stringify({ tipo }) });
  await carregar(`Nota ${n.numero} classificada.`);
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
      ['Emissão', false], [s.colunaDias, false], ['Valor', false], ['Tipo da nota', true]]
    : [['Nota', true], ['Fornecedor', true], ['Empresa', true], ['Emissão', false], ['Lançada', false],
      ...(situacaoAtual === 'entrou' ? [['Entrou', false]] : []), [s.colunaDias, false], ['Valor', false],
      ...(s.classifica ? [['Tipo da nota', true]] : [])];
  cabecalho('tabela-notas', colunas);

  const linhas = itens.map((n) => {
    const tr = document.createElement('tr');
    if (n.atrasada) tr.className = 'linha-vencida';
    const diasNota = celula(inteiro(n.dias), n.atrasada ? 'atraso' : '');
    if (xml) {
      const fornecedor = celula(n.fornecedor, 'esquerda');
      if (n.erro) {
        const erro = document.createElement('span');
        erro.className = 'qtd negativo';
        erro.textContent = `Erro ao importar: ${n.erro}`;
        fornecedor.append(document.createElement('br'), erro);
      }
      tr.append(celula(n.numero, 'esquerda'), fornecedor, celula(n.destinatario ?? '–', 'esquerda'),
        celula(n.operacao ?? '–', 'esquerda'), celula(dataBR(n.emissao)), diasNota, celula(dinheiro(n.valor)),
        celula(seletor(dados.tipos_nfe, n.tipo_origem === 'nfe' ? n.tipo : null, textoPadraoDaNfe(n),
          n.tipo_origem === 'sugestao', (tipo) => classificarNfe(n, tipo)), 'esquerda'));
    } else {
      tr.append(celula(n.numero, 'esquerda'), celula(n.fornecedor ?? '–', 'esquerda'),
        celula(n.nome_empresa ?? `Empresa ${n.empresa}`, 'esquerda'),
        celula(dataBR(n.emissao)), celula(dataBR(n.lancada_em)),
        ...(situacaoAtual === 'entrou' ? [celula(dataBR(n.entrou_em))] : []),
        diasNota, celula(dinheiro(n.valor)));
      if (s.classifica) {
        const daNota = n.tipo_origem === 'nota' ? n.tipo : null;
        tr.append(celula(seletor(dados.tipos_nota, daNota, textoPadraoDaNota(n), n.tipo_origem === 'sugestao',
          (tipo) => classificarNota(n, tipo)), 'esquerda'));
      }
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

// ---------- Parte 2: fornecedores ----------

function textoSugestao(f) {
  if (f.sugestao === 'revenda') return 'Sugerido: Revenda';
  if (f.sugestao === 'misto') return 'Sugerido: Misto';
  return 'Sugerido: sem entrada no estoque';
}

// Quanto cada fornecedor mandou no período (vem das listas de notas, que já são do período)
function valoresDoPeriodo() {
  const porFornecedor = new Map();
  for (const [situacao, lista] of Object.entries(dados.listas)) {
    if (situacao === 'nao_lancada') continue; // não viraram nota de compra: não têm código de fornecedor
    for (const n of lista) {
      const cod = Number(n.cod_fornecedor);
      const atual = porFornecedor.get(cod) ?? { notas: 0, valor: 0 };
      porFornecedor.set(cod, { notas: atual.notas + 1, valor: atual.valor + n.valor });
    }
  }
  return porFornecedor;
}

// Fornecedores que aparecem com os filtros atuais: não confirmados primeiro, maior valor no período no topo
function fornecedoresVisiveis() {
  const termo = normalizar(el('pesquisa-termo').value.trim());
  const soPendentes = el('so-pendentes').checked;
  const soPeriodo = el('so-periodo').checked;
  const periodo = valoresDoPeriodo();
  return fornecedores.fornecedores
    .map((f) => ({ ...f, periodo: periodo.get(f.codigo) ?? { notas: 0, valor: 0 } }))
    .filter((f) => (!soPendentes || !f.tipo)
      && (!soPeriodo || f.periodo.notas > 0)
      && (!termo || normalizar(f.nome).includes(termo)))
    .sort((a, b) => (Boolean(a.tipo) - Boolean(b.tipo)) || (b.periodo.valor - a.periodo.valor) || (b.notas - a.notas));
}

async function classificarFornecedor(f, tipo) {
  mostrarStatus(`Gravando ${f.nome}…`);
  await chamar(`/precificacao/fornecedores/${f.codigo}`, { method: 'PUT', body: JSON.stringify({ tipo }) });
  marcados.delete(f.codigo);
  await carregar(`${f.nome}: classificação gravada.`);
}

async function aplicarLote() {
  const tipo = el('lote-tipo').value;
  if (!tipo || !marcados.size) return;
  const total = marcados.size;
  const nomeTipo = fornecedores.tipos[tipo];
  if (!window.confirm(`Classificar ${plural(total, 'fornecedor', 'fornecedores')} como "${nomeTipo}"?`)) return;
  el('lote-aplicar').disabled = true;
  mostrarStatus(`Gravando ${plural(total, 'fornecedor', 'fornecedores')}…`);
  try {
    await chamar('/precificacao/fornecedores', {
      method: 'PUT',
      body: JSON.stringify({ fornecedores: [...marcados], tipo }),
    });
    marcados.clear();
    await carregar(`${plural(total, 'fornecedor classificado', 'fornecedores classificados')} como ${nomeTipo}.`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  } finally {
    el('lote-aplicar').disabled = false;
  }
}

// Barra dos marcados: só aparece com algum fornecedor marcado
function mostrarLote(visiveis) {
  el('lote').hidden = marcados.size === 0;
  el('lote-texto').textContent = `${plural(marcados.size, 'fornecedor marcado', 'fornecedores marcados')}:`;
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((f) => marcados.has(f.codigo));
  el('marcar-todos').checked = todosVisiveisMarcados;
  el('marcar-todos').indeterminate = !todosVisiveisMarcados && visiveis.some((f) => marcados.has(f.codigo));
}

function mostrarFornecedores() {
  const visiveis = fornecedoresVisiveis();
  // Quem saiu da lista (filtro ou já classificado) deixa de ficar marcado sem ninguém ver
  const codigosVisiveis = new Set(visiveis.map((f) => f.codigo));
  for (const cod of [...marcados]) if (!codigosVisiveis.has(cod)) marcados.delete(cod);

  const linhas = visiveis.map((f) => {
    const tr = document.createElement('tr');
    if (marcados.has(f.codigo)) tr.className = 'linha-marcada';

    const marcar = document.createElement('input');
    marcar.type = 'checkbox';
    marcar.checked = marcados.has(f.codigo);
    marcar.setAttribute('aria-label', `Marcar ${f.nome ?? f.codigo}`);
    marcar.addEventListener('change', () => {
      if (marcar.checked) marcados.add(f.codigo);
      else marcados.delete(f.codigo);
      tr.classList.toggle('linha-marcada', marcar.checked);
      mostrarLote(visiveis);
    });

    const nome = celula(f.nome ?? `Fornecedor ${f.codigo}`, 'esquerda');
    const codigo = document.createElement('span');
    codigo.className = 'qtd';
    codigo.textContent = ` código ${f.codigo}`;
    nome.append(codigo);

    const noPeriodo = celula(f.periodo.notas ? dinheiro(f.periodo.valor) : '–');
    if (f.periodo.notas) {
      const qtd = document.createElement('span');
      qtd.className = 'qtd';
      qtd.textContent = ` · ${plural(f.periodo.notas, 'nota', 'notas')}`;
      noPeriodo.append(qtd);
    }

    const parcela = f.notas ? Math.round((f.finalizadas / f.notas) * 100) : 0;
    tr.append(
      celula(marcar, 'coluna-marcar'),
      nome,
      noPeriodo,
      celula(inteiro(f.notas)),
      celula(`${inteiro(f.finalizadas)} (${parcela}%)`),
      celula(dataBR(f.ultima_nota)),
      celula(seletor(fornecedores.tipos, f.tipo, textoSugestao(f), !f.tipo,
        (tipo) => classificarFornecedor(f, tipo)), 'esquerda'),
      celula(f.tipo ? `${f.alterado_por ?? '–'} · ${dataBR(String(f.alterado_em).slice(0, 10))}` : '–', 'esquerda'),
    );
    return tr;
  });

  if (!linhas.length) {
    const tr = document.createElement('tr');
    const vazio = celula(el('so-pendentes').checked && !el('pesquisa-termo').value.trim()
      ? 'Todos os fornecedores desta lista já foram confirmados.'
      : 'Nenhum fornecedor encontrado.', 'vazio');
    vazio.colSpan = 8;
    tr.append(vazio);
    linhas.push(tr);
  }
  el('tabela-fornecedores').tBodies[0].replaceChildren(...linhas);
  mostrarLote(visiveis);
}

// ---------- Carregar e ligar a tela ----------

async function carregar(mensagem) {
  mostrarStatus('Lendo as notas no PROCFIT…');
  try {
    [dados, fornecedores] = await Promise.all([
      chamar(`/precificacao/notas?dias=${dias}`),
      chamar('/precificacao/fornecedores'),
    ]);
    if (el('lote-tipo').options.length === 0) {
      el('lote-tipo').append(new Option('Escolha o tipo…', ''));
      for (const [valor, texto] of Object.entries(fornecedores.tipos)) el('lote-tipo').append(new Option(texto, valor));
    }
    mostrarSituacoes();
    mostrarLista();
    mostrarFornecedores();
    el('bloco-notas').hidden = false;
    el('bloco-fornecedores').hidden = false;
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    mostrarStatus(`${mensagem ? `${mensagem} · ` : ''}notas dos últimos ${dias} dias · atualizado às ${hora}`);
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

  // Pesquisa: filtra as notas e os fornecedores na própria tela
  const repintar = () => {
    if (!dados) return;
    mostrarLista();
    mostrarFornecedores();
  };
  el('form-pesquisa').addEventListener('submit', (evento) => evento.preventDefault());
  el('pesquisa-termo').addEventListener('input', () => {
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    repintar();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    repintar();
  });
  el('so-pendentes').addEventListener('change', () => fornecedores && mostrarFornecedores());
  el('so-periodo').addEventListener('change', () => fornecedores && mostrarFornecedores());

  // Marcar vários fornecedores e dar o mesmo tipo a todos
  el('marcar-todos').addEventListener('change', () => {
    const visiveis = fornecedoresVisiveis();
    for (const f of visiveis) {
      if (el('marcar-todos').checked) marcados.add(f.codigo);
      else marcados.delete(f.codigo);
    }
    mostrarFornecedores();
  });
  el('lote-aplicar').addEventListener('click', aplicarLote);
  el('lote-limpar').addEventListener('click', () => {
    marcados.clear();
    mostrarFornecedores();
  });

  carregar();
});
