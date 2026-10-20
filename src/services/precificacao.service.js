// Regras do módulo precificação. Cada passo da construção acrescenta as suas aqui.

const AppError = require('../utils/AppError');
const repo = require('../repositories/precificacao.repository');
const classificacao = require('../repositories/classificacao.repository');

// Períodos que a tela oferece (dias para trás, a partir de hoje)
const PERIODOS = [30, 60, 90, 180];
const PERIODO_PADRAO = 90;

// Nota de mercadoria sem entrada há mais dias que isto vira atraso (laranja na tela)
const PRAZO_ENTRADA_DIAS = 3;

// Sugestão automática do tipo do fornecedor, pelo histórico dele no PROCFIT:
//   nenhuma nota finalizada            -> sem sugestão (as notas vão para "produção ou uso e consumo")
//   PARCELA_REVENDA ou mais finalizadas -> revenda
//   entre os dois                       -> misto (cada nota precisa ser classificada)
// A sugestão só vale até alguém confirmar ou corrigir na tela.
const PARCELA_REVENDA = 0.8;

const TIPOS_FORNECEDOR = {
  revenda: 'Revenda',
  producao: 'Produção',
  consumo: 'Uso e consumo',
  misto: 'Misto (classificar cada nota)',
};
const TIPOS_NOTA = {
  revenda: 'Revenda',
  producao: 'Produção',
  consumo: 'Uso e consumo',
};

// Nota que chegou contra o CNPJ e não virou nota de compra: além dos tipos acima, pode não ser compra
// (comodato, locação, remessa, retorno, combustível do posto).
const TIPOS_NFE = { ...TIPOS_NOTA, nao_compra: 'Não é compra' };
// Natureza de operação que sugere "não é compra" (sem acento e em maiúsculas antes de comparar)
// "RETOR" pega RETORNO e a forma abreviada que aparece nas notas (ex.: RETOR.SUBSTITUICAO)
const OPERACAO_NAO_COMPRA = /COMODATO|LOCACAO|REMESSA|RETOR|COMBUSTIVEL/;
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

const SITUACOES = ['parada', 'a_classificar', 'nao_lancada', 'entrou', 'producao_consumo'];

function periodo(valor) {
  if (valor === undefined || valor === null || valor === '') return PERIODO_PADRAO;
  const dias = Number(valor);
  if (!PERIODOS.includes(dias)) throw new AppError(`"dias" deve ser: ${PERIODOS.join(', ')}`);
  return dias;
}

function codigo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new AppError(`Código ${nome} inválido`);
  return numero;
}

function sugestao(f) {
  const notas = Number(f.notas) || 0;
  const finalizadas = Number(f.finalizadas) || 0;
  if (!notas || !finalizadas) return null;
  return finalizadas / notas >= PARCELA_REVENDA ? 'revenda' : 'misto';
}

// Fornecedores com o histórico, a sugestão e a classificação confirmada (se houver)
async function montarFornecedores() {
  const [lista, confirmadas] = await Promise.all([repo.fornecedores(), classificacao.listar('fornecedor')]);
  const porCodigo = new Map();
  for (const f of lista) {
    const c = confirmadas.get(Number(f.codigo));
    porCodigo.set(Number(f.codigo), {
      codigo: Number(f.codigo),
      nome: f.nome,
      notas: Number(f.notas) || 0,
      finalizadas: Number(f.finalizadas) || 0,
      valor: Number(f.valor) || 0,
      ultima_nota: f.ultima_nota,
      sugestao: sugestao(f),
      tipo: c?.tipo ?? null,
      alterado_por: c?.alterado_por ?? null,
      alterado_em: c?.alterado_em ?? null,
    });
  }
  return porCodigo;
}

// Decide o tipo de uma nota que ainda não entrou: primeiro a classificação da própria nota,
// depois a do fornecedor (confirmada), por último a sugestão.
// Devolve { tipo, origem }; tipo null = precisa classificar a nota (fornecedor misto).
function tipoDaNota(nota, fornecedor, notasConfirmadas) {
  const daNota = notasConfirmadas.get(Number(nota.nota_id));
  if (daNota) return { tipo: daNota.tipo, origem: 'nota' };
  if (fornecedor?.tipo) {
    return { tipo: fornecedor.tipo === 'misto' ? null : fornecedor.tipo, origem: 'fornecedor' };
  }
  const s = fornecedor?.sugestao;
  if (s === 'revenda') return { tipo: 'revenda', origem: 'sugestao' };
  if (s === 'misto') return { tipo: null, origem: 'sugestao' };
  return { tipo: 'sem_historico', origem: 'sugestao' };
}

function situacaoDaNota(nota, tipo) {
  if (nota.entrou) return 'entrou';
  if (tipo === 'revenda') return 'parada';
  if (tipo === null) return 'a_classificar';
  return 'producao_consumo';
}

const umaCasa = (v) => Math.round(v * 10) / 10;

async function notas(query) {
  const filtros = { dias: periodo(query.dias) };
  const [{ compras, xml }, fornecedores, notasConfirmadas, nfeConfirmadas] = await Promise.all([
    repo.notas(filtros), montarFornecedores(), classificacao.listar('nota'), classificacao.listar('nfe'),
  ]);

  const listas = Object.fromEntries(SITUACOES.map((s) => [s, []]));
  for (const n of compras) {
    const fornecedor = fornecedores.get(Number(n.cod_fornecedor));
    const { tipo, origem } = n.entrou ? { tipo: null, origem: null } : tipoDaNota(n, fornecedor, notasConfirmadas);
    const situacao = situacaoDaNota(n, tipo);
    listas[situacao].push({
      ...n,
      entrou: Boolean(n.entrou),
      valor: Number(n.valor) || 0,
      tipo,
      tipo_origem: origem,
      tipo_fornecedor: fornecedor?.tipo ?? null,
      atrasada: situacao === 'parada' && n.dias > PRAZO_ENTRADA_DIAS,
    });
  }
  // Chegou e não foi lançada: só é alerta o que é (ou pode ser) revenda; o resto fica na lista sem laranja
  listas.nao_lancada = xml.map((n) => {
    const confirmada = nfeConfirmadas.get(Number(n.registro));
    const sugerida = OPERACAO_NAO_COMPRA.test(semAcento(n.operacao)) ? 'nao_compra' : null;
    const tipo = confirmada?.tipo ?? sugerida;
    return {
      ...n,
      valor: Number(n.valor) || 0,
      tipo,
      tipo_origem: confirmada ? 'nfe' : 'sugestao',
      atrasada: (tipo === null || tipo === 'revenda') && n.dias > PRAZO_ENTRADA_DIAS,
    };
  });
  // Produção ou uso e consumo: as de maior valor primeiro (não é atraso, é volume)
  listas.producao_consumo.sort((a, b) => b.valor - a.valor);

  const resumo = {};
  for (const s of SITUACOES) {
    const itens = listas[s];
    resumo[s] = {
      notas: itens.length,
      valor: itens.reduce((t, n) => t + n.valor, 0),
      dias_medio: itens.length ? umaCasa(itens.reduce((t, n) => t + Number(n.dias || 0), 0) / itens.length) : null,
      atrasadas: itens.filter((n) => n.atrasada).length,
    };
  }

  // Fornecedores com nota no período que ainda não foram confirmados por ninguém
  const doPeriodo = new Set(compras.map((n) => Number(n.cod_fornecedor)));
  const aConfirmar = [...doPeriodo].filter((c) => fornecedores.get(c) && !fornecedores.get(c).tipo).length;

  return {
    dias: filtros.dias,
    prazo_entrada_dias: PRAZO_ENTRADA_DIAS,
    tipos_nota: TIPOS_NOTA,
    tipos_nfe: TIPOS_NFE,
    fornecedores_a_confirmar: aConfirmar,
    resumo,
    listas,
  };
}

// Lista de fornecedores para classificar: os não confirmados primeiro, os que mais mandam nota no topo
async function fornecedores() {
  const lista = [...(await montarFornecedores()).values()];
  lista.sort((a, b) => (Boolean(a.tipo) - Boolean(b.tipo)) || (b.notas - a.notas));
  return { tipos: TIPOS_FORNECEDOR, parcela_revenda: PARCELA_REVENDA, fornecedores: lista };
}

// Quem grava: o nome do login; a chave mestra de emergência não tem nome
const quem = (usuario) => usuario || 'chave mestra';

function tipoValido(tipo, tipos) {
  if (tipo === null || tipo === undefined || tipo === '') return null;
  if (!tipos[tipo]) throw new AppError(`"tipo" deve ser: ${Object.keys(tipos).join(', ')} (ou vazio para tirar)`);
  return tipo;
}

async function classificarFornecedor(query, params, corpo, usuario) {
  const cod = codigo(params.fornecedor, 'do fornecedor');
  const tipo = tipoValido(corpo?.tipo, TIPOS_FORNECEDOR);
  return classificacao.definir('fornecedor', cod, tipo, quem(usuario));
}

// Vários fornecedores com o mesmo tipo (ex.: todos os de material de construção como uso e consumo)
const LIMITE_LOTE = 500;
async function classificarFornecedores(query, params, corpo, usuario) {
  const lista = corpo?.fornecedores;
  if (!Array.isArray(lista) || !lista.length) throw new AppError('Escolha ao menos um fornecedor');
  if (lista.length > LIMITE_LOTE) throw new AppError(`No máximo ${LIMITE_LOTE} fornecedores de uma vez`);
  const codigos = [...new Set(lista.map((c) => codigo(c, 'do fornecedor')))];
  const tipo = tipoValido(corpo?.tipo, TIPOS_FORNECEDOR);
  return classificacao.definir('fornecedor', codigos, tipo, quem(usuario));
}

async function classificarNota(query, params, corpo, usuario) {
  const cod = codigo(params.nota, 'da nota');
  const tipo = tipoValido(corpo?.tipo, TIPOS_NOTA);
  return classificacao.definir('nota', cod, tipo, quem(usuario));
}

async function classificarNfe(query, params, corpo, usuario) {
  const cod = codigo(params.registro, 'da nota');
  const tipo = tipoValido(corpo?.tipo, TIPOS_NFE);
  return classificacao.definir('nfe', cod, tipo, quem(usuario));
}

// ---------- Produtos: tipo e categoria ----------

const TIPOS_PRODUTO = {
  revenda: 'Revenda',
  producao: 'Produção própria',
  insumo: 'Insumo de produção',
  uso_interno: 'Uso interno',
};
const TAMANHO_CATEGORIA = 60;

// Sugestão do tipo pelo cadastro e pelo comportamento no PROCFIT, com o motivo (aparece na tela,
// para quem confirma saber de onde veio). Vale até alguém confirmar.
function sugestaoProduto(p) {
  const vende = Boolean(p.ultima_venda);
  const compra = Number(p.compras) > 0;
  if (p.industrializado) return { tipo: 'producao', motivo: 'marcado como industrializado no PROCFIT' };
  if (p.insumo) return { tipo: 'insumo', motivo: 'marcado como insumo no PROCFIT' };
  if (vende && compra) return { tipo: 'revenda', motivo: 'é comprado e vendido' };
  if (vende) return { tipo: 'producao', motivo: 'vende e não tem compra no sistema' };
  if (compra) return { tipo: 'uso_interno', motivo: 'é comprado e não é vendido' };
  return { tipo: null, motivo: 'sem compra nem venda no último ano' };
}

// O que mudou desde a confirmação e merece uma olhada (a classificação NÃO muda sozinha)
function motivoRevisao(p, confirmado) {
  if (!confirmado) return null;
  if (confirmado.referencia != null && confirmado.referencia !== (p.descricao ?? '')) {
    return `a descrição mudou (era "${confirmado.referencia}")`;
  }
  // Venda DEPOIS da confirmação (ou da última revisão): o que já tinha vendido antes, quem confirmou viu
  const confirmadoEm = confirmado.alterado_em ? new Date(confirmado.alterado_em).toISOString().slice(0, 10) : '';
  if (['insumo', 'uso_interno'].includes(confirmado.tipo) && p.ultima_venda && p.ultima_venda > confirmadoEm) {
    return `está como "${TIPOS_PRODUTO[confirmado.tipo]}", mas teve venda em ${p.ultima_venda.split('-').reverse().join('/')}`;
  }
  return null;
}

async function produtos(query) {
  const filtros = { dias: periodo(query.dias) };
  const [lista, tipos, categorias] = await Promise.all([
    repo.produtos(filtros), classificacao.listar('produto'), classificacao.listar('produto_categoria'),
  ]);
  const itens = lista.map((p) => {
    const codigo = Number(p.codigo);
    const confirmado = tipos.get(codigo);
    const categoria = categorias.get(codigo);
    const sugestao = sugestaoProduto(p);
    return {
      codigo,
      descricao: p.descricao,
      unidade: p.unidade,
      industrializado: Boolean(p.industrializado),
      insumo: Boolean(p.insumo),
      vendido_qtd: Number(p.vendido_qtd) || 0,
      vendido_valor: Number(p.vendido_valor) || 0,
      ultima_venda: p.ultima_venda,
      compras: Number(p.compras) || 0,
      ultima_compra: p.ultima_compra,
      varejo: p.varejo == null ? null : Number(p.varejo),
      sugestao: sugestao.tipo,
      sugestao_motivo: sugestao.motivo,
      tipo: confirmado?.tipo ?? null,
      alterado_por: confirmado?.alterado_por ?? null,
      alterado_em: confirmado?.alterado_em ?? null,
      revisar: motivoRevisao(p, confirmado),
      categoria: categoria?.tipo ?? null,
    };
  });
  // Os que mais venderam no período primeiro
  itens.sort((a, b) => (b.vendido_valor - a.vendido_valor) || String(a.descricao).localeCompare(String(b.descricao)));
  const nomesCategorias = [...new Set(itens.map((p) => p.categoria).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { dias: filtros.dias, tipos: TIPOS_PRODUTO, categorias: nomesCategorias, produtos: itens };
}

// Nome da categoria: espaços arrumados; se já existe uma igual (sem diferenciar acento e maiúscula),
// usa a grafia que já existe, para não nascer "Descartáveis" e "descartaveis" lado a lado.
const chaveCategoria = (t) => semAcento(t).replace(/\s+/g, ' ').trim();
async function nomeCategoria(valor) {
  if (valor === null || valor === undefined) return null;
  const nome = String(valor).replace(/\s+/g, ' ').trim();
  if (!nome) return null;
  if (nome.length > TAMANHO_CATEGORIA) throw new AppError(`A categoria pode ter no máximo ${TAMANHO_CATEGORIA} letras`);
  const existentes = [...new Set([...(await classificacao.listar('produto_categoria')).values()].map((c) => c.tipo))];
  return existentes.find((e) => chaveCategoria(e) === chaveCategoria(nome)) ?? nome;
}

// Um ou vários produtos de uma vez. O corpo pode trazer "tipo", "categoria" ou os dois;
// o que não vier fica como está. null ou vazio tira a classificação.
async function classificarProdutos(query, params, corpo, usuario) {
  const lista = corpo?.produtos;
  if (!Array.isArray(lista) || !lista.length) throw new AppError('Escolha ao menos um produto');
  if (lista.length > LIMITE_LOTE) throw new AppError(`No máximo ${LIMITE_LOTE} produtos de uma vez`);
  const codigos = [...new Set(lista.map((c) => codigo(c, 'do produto')))];
  const temTipo = Object.prototype.hasOwnProperty.call(corpo, 'tipo');
  const temCategoria = Object.prototype.hasOwnProperty.call(corpo, 'categoria');
  if (!temTipo && !temCategoria) throw new AppError('Informe o "tipo" e/ou a "categoria"');

  // Valida tudo antes de gravar qualquer coisa
  const operacoes = [];
  if (temTipo) {
    const tipo = tipoValido(corpo.tipo, TIPOS_PRODUTO);
    // Guarda a descrição de agora: se ela mudar depois, a tela pede revisão
    const descricoes = await repo.descricoes();
    const referencias = new Map(codigos.map((c) => [c, descricoes.get(c) ?? '']));
    // revisado: alguém clicou "Está certo" no aviso de revisão (grava mesmo sem mudar o tipo)
    operacoes.push({ alvo: 'produto', codigos, tipo, referencias, forcar: corpo.revisado === true });
  }
  if (temCategoria) {
    operacoes.push({ alvo: 'produto_categoria', codigos, tipo: await nomeCategoria(corpo.categoria) });
  }
  // Tipo e categoria juntos: ou grava os dois, ou nenhum
  return classificacao.definirJuntos(operacoes, quem(usuario));
}

module.exports = {
  produtos,
  classificarProdutos,
  notas, fornecedores, classificarFornecedor, classificarFornecedores, classificarNota, classificarNfe, PERIODOS,
};
