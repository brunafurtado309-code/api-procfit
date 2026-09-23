// Painel administrativo: usuários do PROCFIT e o que cada um faz no sistema.
// Chave própria (setor "admin"): quem tem a chave de vendas ou financeiro não entra aqui.

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (valor) => moeda.format(Number(valor) || 0);
const inteiro = (valor) => (Number(valor) || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (valor) => (valor ? `${dataBR(valor)} ${String(valor).slice(11, 16)}` : '—');
const formatarData = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

// ===== Estado =====
let usuarios = [];
let areasPorUsuario = new Map();
let ordem = { coluna: 'acoes', direcao: 'desc' };

// ===== API =====
async function buscar(rota, parametros = {}) {
  const url = new URL(`/admin/${rota}`, window.location.origin);
  for (const [nome, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(nome, valor);
  }
  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.reload();
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Esta chave não tem acesso ao administrativo.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os dados.');
  return corpo;
}

const filtrosAtuais = () => ({ inicio: el('inicio').value || null, fim: el('fim').value || null });

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

function thOrdenavel(titulo, chaveColuna, esquerda = false) {
  const th = document.createElement('th');
  th.scope = 'col';
  if (esquerda) th.className = 'esquerda';
  if (!chaveColuna) {
    th.textContent = titulo;
    return th;
  }
  const ativa = ordem.coluna === chaveColuna;
  const crescente = ordem.direcao === 'asc';
  if (ativa) th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = ativa ? 'ordenar ordenar--ativo' : 'ordenar';
  const seta = span(ativa ? (crescente ? '▲' : '▼') : '↕', 'ordenar__seta');
  seta.setAttribute('aria-hidden', 'true');
  botao.append(titulo, seta);
  botao.addEventListener('click', () => {
    ordem = { coluna: chaveColuna, direcao: ativa && crescente ? 'desc' : 'asc' };
    mostrarUsuarios();
  });
  th.append(botao);
  return th;
}

// ===== Períodos prontos =====
function periodoPronto(nome) {
  const hoje = new Date();
  if (nome === 'mes') {
    return { inicio: formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: formatarData(hoje) };
  }
  const dias = Number(nome);
  return {
    inicio: formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (dias - 1))),
    fim: formatarData(hoje),
  };
}

// ===== Carregar =====
async function carregar() {
  estado.salvar('admin', { ...filtrosAtuais(), busca: el('pesquisa-termo').value.trim() });
  mostrarStatus('Carregando a atividade dos usuários…');
  try {
    const dados = await buscar('usuarios', filtrosAtuais());
    usuarios = dados.usuarios;
    areasPorUsuario = new Map();
    for (const a of dados.areas) {
      const lista = areasPorUsuario.get(a.usuario) ?? [];
      lista.push(a);
      areasPorUsuario.set(a.usuario, lista);
    }
    mostrarResumo();
    mostrarGrafico(dados.porDia);
    mostrarUsuarios();
    el('painel').hidden = false;
    mostrarStatus(`atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarResumo() {
  const soma = (campo) => usuarios.reduce((t, u) => t + (Number(u[campo]) || 0), 0);
  const usaram = usuarios.filter((u) => Number(u.acoes) > 0).length;
  const parados = usuarios.filter((u) => Number(u.acoes) === 0).length;
  el('total-acoes').textContent = inteiro(soma('acoes'));
  el('total-explica').textContent = `${plural(usuarios.length, 'usuário cadastrado', 'usuários cadastrados')} no PROCFIT`;
  el('ind-ativos').replaceChildren(inteiro(usaram), span('pessoas com ações no período'));
  el('ind-parados').replaceChildren(inteiro(parados), span('nenhuma ação no período'));
  el('ind-cancelamentos').replaceChildren(inteiro(soma('cancelamentos')), span('pedidos, notas, títulos, pagamentos'));
  el('ind-fora').replaceChildren(inteiro(soma('fora_horario')), span('antes das 6h ou depois das 20h'));
  el('ind-cancelamentos').classList.toggle('negativo', soma('cancelamentos') > 0);
  el('ind-fora').classList.toggle('negativo', soma('fora_horario') > 0);
}

function mostrarGrafico(porDia) {
  const dias = [...new Set(porDia.map((p) => p.dia))].sort();
  const areas = [...new Set(porDia.map((p) => p.area))];
  const valorDe = (dia, area) => Number(porDia.find((p) => p.dia === dia && p.area === area)?.acoes) || 0;
  graficos.colunas(el('grafico-dias'), {
    titulo: 'Ações por dia',
    formato: 'inteiro',
    empilhado: true,
    rotulos: dias.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`),
    series: areas.map((area) => ({ nome: area, valores: dias.map((d) => valorDe(d, area)) })),
    vazio: 'Nenhuma ação registrada no período.',
  });
}

// ===== Lista de usuários =====
function visiveis() {
  const termo = el('pesquisa-termo').value.trim().toLowerCase();
  if (!termo) return usuarios;
  return usuarios.filter((u) => `${u.nome ?? ''} ${u.login ?? ''} ${u.usuario}`.toLowerCase().includes(termo));
}

function mostrarUsuarios() {
  const lista = [...visiveis()].sort((a, b) => {
    const fator = ordem.direcao === 'asc' ? 1 : -1;
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * fator;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator;
  });
  el('titulo-usuarios').textContent = `Usuários (${inteiro(lista.length)})`;

  const tabela = el('tabela-usuarios');
  const cab = document.createElement('tr');
  for (const [titulo, campo, esquerda] of [['Usuário', 'nome', true], ['Situação', 'ativo', true],
    ['Ações no período', 'acoes'], ['Atua em', null, true], ['Cancelamentos', 'cancelamentos'],
    ['Fora do horário', 'fora_horario'], ['Última atividade', 'ultima_atividade', true]]) {
    cab.append(thOrdenavel(titulo, campo, esquerda));
  }
  tabela.tHead.replaceChildren(cab);

  tabela.tBodies[0].replaceChildren(...(lista.length ? lista.map((u) => {
    const linha = document.createElement('tr');
    const nome = document.createElement('button');
    nome.type = 'button';
    nome.className = 'link-pedido';
    nome.textContent = u.nome ?? `Usuário ${u.usuario}`;
    nome.title = 'Ver tudo o que esta pessoa fez no período';
    nome.addEventListener('click', () => abrirUsuario(u));
    const celulaNome = td(nome, 'esquerda');
    celulaNome.append(span(`${u.login ?? '—'} · código ${u.usuario}`, 'qtd'));
    const areas = (areasPorUsuario.get(u.usuario) ?? []).sort((a, b) => b.acoes - a.acoes)
      .map((a) => a.area).join(' · ');
    const semUso = Number(u.acoes) === 0;
    linha.append(
      celulaNome,
      td(span(u.ativo === 'S' ? 'Ativo' : 'Inativo', `situacao ${u.ativo === 'S' ? 'situacao--faturada' : 'situacao--cancelada'}`), 'esquerda'),
      td(inteiro(u.acoes), semUso ? null : 'coluna-final'),
      td(areas || '—', 'esquerda'),
      td(Number(u.cancelamentos) ? inteiro(u.cancelamentos) : '—', Number(u.cancelamentos) ? 'negativo' : null),
      td(Number(u.fora_horario) ? inteiro(u.fora_horario) : '—', Number(u.fora_horario) ? 'negativo' : null),
      comAuxiliar(u.ultima_atividade ? dataHoraBR(u.ultima_atividade) : 'sem atividade no período', null,
        'esquerda sem-quebra'),
    );
    return linha;
  }) : [Object.assign(document.createElement('tr'),
    { innerHTML: '<td class="vazio" colspan="7">Nenhum usuário encontrado.</td>' })]));

  const soma = (campo) => lista.reduce((t, u) => t + (Number(u[campo]) || 0), 0);
  const rodape = document.createElement('tr');
  rodape.append(td(`Total (${plural(lista.length, 'usuário', 'usuários')})`, 'esquerda'), td(''),
    td(inteiro(soma('acoes'))), td(''), td(inteiro(soma('cancelamentos'))), td(inteiro(soma('fora_horario'))), td(''));
  tabela.tFoot.replaceChildren(rodape);
}

// ===== Janela: linha do tempo de uma pessoa =====
let usuarioAberto = null;

async function abrirUsuario(u) {
  usuarioAberto = u;
  const janela = el('janela-usuario');
  el('usuario-titulo').textContent = u.nome ?? `Usuário ${u.usuario}`;
  el('usuario-resumo').textContent = `${u.login ?? ''} · código ${u.usuario} · carregando…`;
  el('usuario-corpo').replaceChildren(span('Carregando as ações…', 'explica'));
  if (!janela.open) janela.showModal();

  try {
    const [{ lancamentos, porAcao }, recebimentos] = await Promise.all([
      buscar('atividade', { ...filtrosAtuais(), usuario: u.usuario }),
      buscar('recebimentos', { ...filtrosAtuais(), usuario: u.usuario }),
    ]);
    el('usuario-resumo').textContent = `${u.login ?? ''} · código ${u.usuario} · `
      + `${plural(lancamentos.length, 'ação', 'ações')} de ${dataBR(el('inicio').value)} a ${dataBR(el('fim').value)}`;

    const partes = [];
    const totalRecebido = recebimentos.reduce((t, r) => t + (Number(r.recebido) || 0), 0);
    const lotes = new Set(recebimentos.map((r) => r.lote)).size;

    // 1) Três números no topo: o resumo da pessoa no período
    const resumo = document.createElement('dl');
    resumo.className = 'indicadores indicadores--janela';
    const indicador = (rotulo, valor, nota) => {
      const dt = document.createElement('dt');
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      dd.append(valor);
      if (nota) dd.append(span(nota));
      resumo.append(dt, dd);
    };
    indicador('Ações no período', inteiro(lancamentos.length), porAcao.length
      ? `${porAcao[0].acao.toLowerCase()} é a principal` : 'nenhuma ação');
    indicador('Títulos baixados', inteiro(recebimentos.length), `em ${plural(lotes, 'lançamento', 'lançamentos')}`);
    indicador('Valor recebido', dinheiro(totalRecebido), 'títulos baixados por ela');
    partes.push(resumo);

    // 2) O que ela mais faz (as cinco principais)
    if (porAcao.length) {
      const maximo = Math.max(...porAcao.map((a) => Number(a.acoes) || 0));
      const barras = document.createElement('div');
      barras.className = 'barras';
      barras.replaceChildren(...porAcao.slice(0, 5).map((a) => {
        const linha = document.createElement('div');
        linha.className = 'barra barra--previsao';
        const trilho = span('', 'barra-trilho');
        const preenchida = span('', 'barra-preenchida');
        preenchida.style.width = `${maximo ? Math.max(2, (Number(a.acoes) / maximo) * 100) : 0}%`;
        trilho.append(preenchida);
        const valor = span(inteiro(a.acoes), 'barra-valor');
        valor.append(Object.assign(document.createElement('small'), { textContent: a.area }));
        linha.append(span(a.acao, 'barra-rotulo'), trilho, valor);
        return linha;
      }));
      partes.push(barras);
    }

    // 3) Recebimentos: os 20 mais recentes, em poucas colunas. O resto vai no Excel.
    if (recebimentos.length) {
      const MOSTRAR = 20;
      const titulo = document.createElement('h3');
      titulo.textContent = 'Últimos recebimentos';
      partes.push(titulo);

      const tabela = document.createElement('table');
      tabela.className = 'tabela tabela--itens';
      const cab = document.createElement('tr');
      for (const [texto, esquerda] of [['Lançado em', true], ['Cliente', true], ['Nota / pedido', true],
        ['Forma', true], ['Recebido']]) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = texto;
        if (esquerda) th.className = 'esquerda';
        cab.append(th);
      }
      tabela.createTHead().append(cab);
      const corpo = tabela.createTBody();
      for (const r of recebimentos.slice(0, MOSTRAR)) {
        const parcial = Number(r.recebido) + 0.009 < Number(r.valor_titulo);
        const tr = document.createElement('tr');
        tr.append(
          comAuxiliar(dataHoraBR(r.lancado_em), `recebido em ${dataBR(r.dia)}`, 'esquerda sem-quebra'),
          td(r.cliente ?? `Cliente ${r.cod_cliente}`, 'esquerda'),
          comAuxiliar(r.nota ? `NF ${r.nota}` : 'sem nota', r.pedido ? `pedido ${r.pedido}` : null, 'esquerda'),
          td(r.forma ?? '—', 'esquerda'),
          comAuxiliar(dinheiro(r.recebido), parcial ? `parcial de ${dinheiro(r.valor_titulo)}` : null,
            null, 'qtd negativo'),
        );
        corpo.append(tr);
      }
      tabela.createTFoot().append((() => {
        const linha = document.createElement('tr');
        const rotulo = td(recebimentos.length > MOSTRAR
          ? `${plural(recebimentos.length, 'título', 'títulos')} no período · os ${MOSTRAR} últimos acima`
          : `Total (${plural(recebimentos.length, 'título', 'títulos')})`, 'esquerda');
        rotulo.colSpan = 4;
        linha.append(rotulo, td(dinheiro(totalRecebido)));
        return linha;
      })());
      partes.push(tabela);

      const acoes = document.createElement('p');
      const botaoExcel = document.createElement('button');
      botaoExcel.type = 'button';
      botaoExcel.className = 'botao-secundario';
      botaoExcel.textContent = 'Baixar Excel com todos os recebimentos';
      botaoExcel.addEventListener('click', () => baixarExcel(u.usuario, 'recebimentos'));
      acoes.append(botaoExcel);
      partes.push(acoes);
    }

    // 4) Dia a dia: fechado, para quem quiser conferir hora a hora
    if (lancamentos.length) {
      const porDia = new Map();
      for (const l of lancamentos) {
        if (!porDia.has(l.dia)) porDia.set(l.dia, []);
        porDia.get(l.dia).push(l);
      }
      const detalhes = document.createElement('details');
      detalhes.className = 'mais-detalhes';
      const resumoDias = document.createElement('summary');
      resumoDias.textContent = `Ver o dia a dia (${plural(lancamentos.length, 'ação', 'ações')} em `
        + `${plural(porDia.size, 'dia', 'dias')})`;
      detalhes.append(resumoDias);
      const tabela = document.createElement('table');
      tabela.className = 'tabela tabela--itens';
      const cab = document.createElement('tr');
      for (const texto of ['Dia', 'Hora', 'Área', 'O que fez', 'Documento']) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'esquerda';
        th.textContent = texto;
        cab.append(th);
      }
      tabela.createTHead().append(cab);
      const corpo = tabela.createTBody();
      for (const l of lancamentos.slice(0, 500)) {
        const fora = Number(l.hora.slice(0, 2)) < 6 || Number(l.hora.slice(0, 2)) >= 20;
        const tr = document.createElement('tr');
        tr.append(td(dataBR(l.dia), 'esquerda sem-quebra'), td(l.hora, fora ? 'esquerda negativo' : 'esquerda'),
          td(l.area, 'esquerda'), td(l.acao, 'esquerda'), td(l.referencia ?? '—', 'esquerda'));
        corpo.append(tr);
      }
      detalhes.append(tabela);
      partes.push(detalhes);
    } else {
      partes.push(span('Nenhuma ação registrada para esta pessoa no período.', 'explica'));
    }

    el('usuario-corpo').replaceChildren(...partes);
  } catch (erro) {
    el('usuario-corpo').replaceChildren(span(erro.message, 'status--erro'));
  }
}

// ===== Excel =====
async function baixarExcel(usuario = null, tipo = null) {
  const botao = usuario ? el('usuario-excel') : el('baixar-excel');
  botao.disabled = true;
  try {
    const url = new URL('/admin/usuarios/excel', window.location.origin);
    for (const [nome, valor] of Object.entries({ ...filtrosAtuais(), usuario, tipo })) {
      if (valor) url.searchParams.set(nome, valor);
    }
    const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() ?? '' } });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'usuarios-procfit.xlsx';
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
    const informada = window.prompt('Informe a chave de acesso do administrativo:');
    if (!informada) {
      mostrarStatus('É preciso informar a chave de acesso para ver esta tela.', true);
      return;
    }
    chave.guardar(informada.trim());
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'admin');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.reload();
      return;
    }
  }

  const periodo = periodoPronto('30');
  el('inicio').value = periodo.inicio;
  el('fim').value = periodo.fim;
  // Volta como estava (período e pesquisa)
  estado.aplicarCampos('admin', { inicio: 'inicio', fim: 'fim', busca: 'pesquisa-termo' });
  el('limpar-pesquisa').hidden = !el('pesquisa-termo').value.trim();

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
    for (const item of el('atalhos').querySelectorAll('[data-dias]')) {
      item.classList.toggle('atalho--ativo', item === botao);
    }
    carregar();
  });
  el('form-pesquisa').addEventListener('submit', (evento) => {
    evento.preventDefault();
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    mostrarUsuarios();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    mostrarUsuarios();
  });
  el('baixar-excel').addEventListener('click', () => baixarExcel());
  el('usuario-excel').addEventListener('click', () => baixarExcel(usuarioAberto?.usuario));
  el('usuario-fechar').addEventListener('click', () => el('janela-usuario').close());

  carregar();
});
