// Regras de entradas e saídas: valida os filtros, dá nome a cada tipo de movimento e exporta.
// Só quantidades: nenhum preço ou custo sai deste módulo.

const AppError = require('../utils/AppError');
const repo = require('../repositories/movimentos.repository');
const { empresas: listaEmpresas } = require('../repositories/logistica.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA = 24 * 60 * 60 * 1000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Nome do movimento pela tela de origem (TAB_MASTER_ORIGEM) e o tipo (ver movimentos.repository.js).
// Para dar nome a um tipo novo, é só acrescentar aqui.
// Os de out/2026 (tipos 4, 19 e 20) foram nomeados pelo que os lançamentos mostram: o tipo 4 traz a
// indústria do grupo e grandes quantidades; o tipo 20 traz ora clientes (devolução), ora empresas do
// grupo (transferência), sempre com o nº da nota, por isso fica só "Entrada por nota".
const NOMES_POR_ORIGEM = {
  [repo.TAB_NOTA_COMPRA]: { 2: 'Compra (nota de entrada)', entrada: 'Entrada por nota de compra' },
  753289: { 1: 'Venda por nota', saida: 'Saída por nota fiscal' },
  [repo.TAB_CAIXA]: { saida: 'Venda no caixa', entrada: 'Devolução no caixa' },
  339822: { 4: 'Transferência recebida' },
  561384: { 20: 'Entrada por nota' },
  773844: { 19: 'Entrada por nota' },
};

function nomeDoMovimento(m) {
  const sentido = Number(m.entrada) > 0 ? 'entrada' : 'saida';
  const nomes = NOMES_POR_ORIGEM[m.origem] ?? {};
  return nomes[m.tipo] ?? nomes[sentido] ?? `${sentido === 'entrada' ? 'Outra entrada' : 'Outra saída'} (tipo ${m.tipo})`;
}

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

// Período padrão: últimos 30 dias, no máximo 1 ano
function montarFiltros(query) {
  let inicio = data(query.inicio, 'inicio');
  let fim = data(query.fim, 'fim');
  if (!fim) fim = iso(new Date());
  if (!inicio) inicio = iso(new Date(new Date(`${fim}T12:00:00`).getTime() - 29 * UM_DIA));
  if (inicio > fim) throw new AppError('A data inicial não pode ser depois da final');
  const dias = Math.round((new Date(`${fim}T12:00:00`) - new Date(`${inicio}T12:00:00`)) / UM_DIA) + 1;
  if (dias > 366) throw new AppError('Escolha um período de no máximo 1 ano');

  const filtros = { inicio, fim, empresa: null };
  if (query.empresa) {
    const empresa = Number(query.empresa);
    if (!Number.isInteger(empresa) || empresa <= 0) throw new AppError('"empresa" deve ser um número');
    filtros.empresa = empresa;
  }
  const busca = String(query.busca ?? '').trim().slice(0, 60);
  if (busca) filtros.busca = busca;
  return filtros;
}

const produtos = (query) => repo.produtos(montarFiltros(query));
const empresas = () => listaEmpresas();

async function movimentos(query, params) {
  const codigo = Number(params.produto);
  if (!Number.isInteger(codigo) || codigo <= 0) throw new AppError('Código do produto inválido');
  const dados = await repo.movimentos(codigo, montarFiltros(query));
  if (!dados.produto) throw new AppError(`Produto ${codigo} não encontrado`, 404);
  // Separa o que chegou (nota de fornecedor, transferência) do que voltou (devolução de venda).
  // Na nota que chegou, quem está no lançamento é o fornecedor; na devolução, é o cliente.
  const entradas = dados.entradas.map((m) => {
    const devolucao = m.devolucao_nota != null || m.origem === repo.TAB_CAIXA;
    return {
      ...m,
      devolucao,
      nome: m.devolucao_nota != null ? 'Devolução de venda' : nomeDoMovimento(m),
    };
  });
  dados.entradas = entradas.filter((m) => !m.devolucao).map(({ entidade, ...m }) => ({ ...m, fornecedor: entidade }));
  dados.devolucoes = entradas.filter((m) => m.devolucao).map(({ entidade, ...m }) => ({ ...m, cliente: entidade }));
  return dados;
}

async function exportar(query) {
  const filtros = montarFiltros(query);
  const { lista } = await repo.produtos(filtros);
  const dataBR = (d) => String(d).split('-').reverse().join('/');
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Entradas e saídas', {
    titulo: 'Entradas e saídas do estoque | Belo Norte',
    subtitulo: `${lista.length} produtos · de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`
      + `${filtros.empresa ? ` · empresa ${filtros.empresa}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''}`,
    colunas: [
      { titulo: 'Código', chave: 'produto', tipo: 'codigo', largura: 9 },
      { titulo: 'Produto', chave: 'descricao', largura: 48 },
      { titulo: 'Entrou', chave: 'entrou', tipo: 'inteiro', largura: 12 },
      { titulo: 'Saiu', chave: 'saiu', tipo: 'inteiro', largura: 12 },
      { titulo: 'Saldo hoje', chave: 'saldo', tipo: 'inteiro', largura: 12 },
      { titulo: 'Movimentos', chave: 'movimentos', tipo: 'inteiro', largura: 12 },
    ],
    linhas: lista,
  });
  return { workbook, nomeArquivo: `entradas_e_saidas_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

module.exports = { produtos, empresas, movimentos, exportar };
