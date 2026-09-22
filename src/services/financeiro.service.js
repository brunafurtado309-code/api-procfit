// Regras do financeiro: valida os filtros antes de ir ao banco.

const AppError = require('../utils/AppError');
const repo = require('../repositories/financeiro.repository');
const excel = require('../utils/excel');

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const SITUACOES = ['aberto', 'parcial', 'quitado', 'todos'];
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;
// Colunas que a lista de títulos aceita ordenar (as mesmas do repository)
const ORDENS = [
  'vencimento', 'nota', 'titulo', 'devedor', 'forma', 'valor', 'recebido', 'pendente',
  'nota_valor', 'nota_recebido', 'nota_pendente',
];

// Aqui a data é OPCIONAL (diferente de vendas): sem datas, mostra tudo em aberto
function validarData(valor, nome) {
  if (valor === undefined || valor === '') return null;
  if (!FORMATO_DATA.test(valor)) {
    throw new AppError(`Parâmetro "${nome}" deve estar no formato AAAA-MM-DD`);
  }
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) {
    throw new AppError(`Data inválida em "${nome}"`);
  }
  return valor;
}

function numeroOpcional(valor, nome) {
  if (valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) {
    throw new AppError(`"${nome}" deve ser um número inteiro`);
  }
  return numero;
}

function montarFiltros(query) {
  const inicio = validarData(query.inicio, 'inicio');
  const fim = validarData(query.fim, 'fim');
  if (inicio && fim && fim < inicio) {
    throw new AppError('"fim" não pode ser anterior a "inicio"');
  }

  const situacao = query.situacao ?? 'aberto';
  if (!SITUACOES.includes(situacao)) {
    throw new AppError(`"situacao" deve ser: ${SITUACOES.join(', ')}`);
  }

  let limite = LIMITE_PADRAO;
  if (query.limite !== undefined && query.limite !== '') {
    limite = Number(query.limite);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw new AppError(`"limite" deve ser entre 1 e ${LIMITE_MAXIMO}`);
    }
  }

  let pagina = 1;
  if (query.pagina !== undefined && query.pagina !== '') {
    pagina = Number(query.pagina);
    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new AppError('"pagina" deve ser 1 ou mais');
    }
  }

  const DEVEDORES = ['cliente', 'adquirente'];
  const devedor = query.devedor ?? null;
  if (devedor !== null && !DEVEDORES.includes(devedor)) {
    throw new AppError(`"devedor" deve ser: ${DEVEDORES.join(', ')}`);
  }

  const ORIGENS = ['nota', 'sem_nota'];
  const origem = query.origem ?? null;
  if (origem !== null && !ORIGENS.includes(origem)) {
    throw new AppError(`"origem" deve ser: ${ORIGENS.join(', ')}`);
  }

  const ATRASOS = ['vencidos', 'a_vencer'];
  const atraso = query.atraso ?? null;
  if (atraso !== null && !ATRASOS.includes(atraso)) {
    throw new AppError(`"atraso" deve ser: ${ATRASOS.join(', ')}`);
  }

  // Filtros de coluna: texto simples e faixa de valor
  const texto = (valor, tamanho) => {
    const limpo = (valor ?? '').trim();
    if (limpo === '') return null;
    if (limpo.length > tamanho) throw new AppError(`Filtro muito longo (máximo ${tamanho} caracteres)`);
    return limpo;
  };

  const valorDecimal = (valor, nome) => {
    if (valor === undefined || valor === '') return null;
    const numero = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(numero) || numero < 0) throw new AppError(`"${nome}" deve ser um valor numérico`);
    return numero;
  };

  const busca = (query.busca ?? '').trim();

  // Ordenação ao clicar no nome da coluna
  const ordem = query.ordem ? String(query.ordem) : null;
  if (ordem !== null && !ORDENS.includes(ordem)) {
    throw new AppError(`"ordem" deve ser: ${ORDENS.join(', ')}`);
  }
  const direcao = query.direcao ? String(query.direcao) : 'asc';
  if (!['asc', 'desc'].includes(direcao)) {
    throw new AppError('"direcao" deve ser asc ou desc');
  }

  return {
    inicio,
    fim,
    situacao,
    atraso,
    origem,
    devedor,
    empresa: numeroOpcional(query.empresa, 'empresa'),
    modalidade: numeroOpcional(query.modalidade, 'modalidade'),
    busca: busca === '' ? null : busca,
    f_nota: texto(query.f_nota, 20),
    f_pedido: texto(query.f_pedido, 20),
    f_titulo: texto(query.f_titulo, 40),
    f_cliente: texto(query.f_cliente, 80),
    f_valor_min: valorDecimal(query.f_valor_min, 'f_valor_min'),
    f_valor_max: valorDecimal(query.f_valor_max, 'f_valor_max'),
    atraso_min: numeroOpcional(query.atraso_min, 'atraso_min'),
    atraso_max: numeroOpcional(query.atraso_max, 'atraso_max'),
    ordem,
    direcao,
    limite,
    pagina,
  };
}

const resumo = (query) => repo.resumo(montarFiltros(query));
const porFaixaAtraso = (query) => repo.porFaixaAtraso(montarFiltros(query));
const titulos = (query) => repo.titulos(montarFiltros(query));
const cartoes = (query) => repo.cartoes(montarFiltros(query));
const porCliente = (query) => repo.porCliente(montarFiltros(query));
const indicadores = (query) => repo.indicadores(montarFiltros(query));
const previsao = (query) => repo.previsao(montarFiltros(query));
const baixasPorMes = (query) => repo.baixasPorMes(montarFiltros(query));

// ===== Recebimentos (todas as baixas de título, com a origem) =====
const ORIGENS_TEXTO = Object.fromEntries(
  Object.values(repo.ORIGENS_RECEBIMENTO).map((o) => [String(o.id), o.nome]),
);

function filtrosRecebimentos(query) {
  const { inicio, fim, busca } = montarFiltros(query);
  const filtros = { inicio, fim, busca };
  if (query.origem) {
    const origem = Number(query.origem);
    if (!ORIGENS_TEXTO[String(origem)]) throw new AppError('"origem" não é uma tela conhecida');
    filtros.origem = origem;
  }
  if (query.usuario) {
    const usuario = Number(query.usuario);
    if (!Number.isInteger(usuario)) throw new AppError('"usuario" deve ser um número');
    filtros.usuario = usuario;
  }
  if (query.ordem) {
    if (!repo.ORDENACAO_RECEBIMENTOS[query.ordem]) {
      throw new AppError(`"ordem" deve ser: ${Object.keys(repo.ORDENACAO_RECEBIMENTOS).join(', ')}`);
    }
    filtros.ordem = query.ordem;
  }
  if (query.forma) {
    const codigo = repo.FORMAS_RECEBIMENTO[query.forma];
    if (codigo === undefined) {
      throw new AppError(`"forma" deve ser: ${Object.keys(repo.FORMAS_RECEBIMENTO).join(', ')}`);
    }
    filtros.forma = codigo;
    filtros.formaNome = query.forma;
  }
  filtros.direcao = query.direcao === 'asc' ? 'asc' : 'desc';
  return filtros;
}

const recebimentos = (query) => repo.recebimentos(filtrosRecebimentos(query));

// Colunas da planilha de recebimentos
const COLUNAS_RECEBIMENTOS = [
  { titulo: 'Recebimento', chave: 'dia', tipo: 'data', largura: 12 },
  { titulo: 'Lançado em', chave: 'lancado_em', largura: 17 },
  { titulo: 'Origem', chave: 'origem', largura: 22 },
  { titulo: 'Quem lançou', chave: 'usuario_nome', largura: 28 },
  { titulo: 'Título', chave: 'titulo', largura: 16 },
  { titulo: 'Nota fiscal', chave: 'nota', tipo: 'codigo', largura: 11 },
  { titulo: 'Pedido', chave: 'pedido', tipo: 'codigo', largura: 10 },
  { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 11 },
  { titulo: 'Cliente', chave: 'cliente', largura: 40 },
  { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
  { titulo: 'Forma', chave: 'forma', largura: 14 },
  { titulo: 'Valor do título', chave: 'valor_titulo', tipo: 'moeda', largura: 14, somar: true },
  { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda', largura: 14, somar: true },
  { titulo: 'Lote', chave: 'lote', tipo: 'codigo', largura: 9 },
];

async function exportarRecebimentos(query) {
  const filtros = filtrosRecebimentos(query);
  const lista = await repo.recebimentos(filtros);
  const dataBR = (d) => d.split('-').reverse().join('/');
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Recebimentos', {
    titulo: 'Recebimentos | Belo Norte',
    subtitulo: `${lista.length} baixas de título · recebimento de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`
      + `${filtros.origem ? ` · ${ORIGENS_TEXTO[String(filtros.origem)]}` : ''}`
      + `${filtros.formaNome ? ` · ${filtros.formaNome}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: COLUNAS_RECEBIMENTOS,
    linhas: lista,
    totais: true,
  });
  return { workbook, nomeArquivo: `recebimentos_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

const MESES_PADRAO = 12;
const MESES_MAXIMO = 60;

function fichaCliente(query, params) {
  const entidade = Number(params.entidade);
  if (!Number.isInteger(entidade) || entidade <= 0) {
    throw new AppError('Código do cliente inválido');
  }

  let meses = MESES_PADRAO;
  if (query.meses !== undefined && query.meses !== '') {
    meses = Number(query.meses);
    if (!Number.isInteger(meses) || meses < 1 || meses > MESES_MAXIMO) {
      throw new AppError(`"meses" deve ser entre 1 e ${MESES_MAXIMO}`);
    }
  }

  return repo.fichaCliente(entidade, { meses });
}

module.exports = {
  resumo, cartoes, indicadores, previsao, porFaixaAtraso, porCliente, titulos, fichaCliente, baixasPorMes,
  recebimentos, exportarRecebimentos, montarFiltros, // usado pela exportação para Excel (mesmas regras da tela)
};