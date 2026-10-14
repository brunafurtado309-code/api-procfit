// Regras do módulo logística: valida os filtros, dá nome às tabelas de preço e exporta a lista.

const AppError = require('../utils/AppError');
const repo = require('../repositories/logistica.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA = 24 * 60 * 60 * 1000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const NOMES_TABELAS = { [repo.TABELA_VAREJO]: 'Varejo', [repo.TABELA_ATACADO]: 'Atacado' };

const ALERTA_TEXTO = {
  NEGATIVO: 'Estoque negativo',
  SOBRA: 'Entrou o dobro ou mais do que saiu',
  PRECO_ALTERADO: 'Preço alterado no período',
  PRECO_FORA: 'Preço alterado fora do sistema',
};

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

function empresa(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new AppError('"empresa" deve ser um número');
  return numero;
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

  const filtros = { inicio, fim, empresa: empresa(query.empresa) };
  const busca = String(query.busca ?? '').trim().slice(0, 60);
  if (busca) filtros.busca = busca;
  if (query.alerta) {
    if (!repo.ALERTAS[query.alerta]) {
      throw new AppError(`"alerta" deve ser: ${Object.keys(repo.ALERTAS).join(', ')}`);
    }
    filtros.alerta = query.alerta;
  }
  return filtros;
}

const nomeTabela = (t) => NOMES_TABELAS[t] ?? `Tabela ${t}`;
const moedaBR = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Mudança de preço em uma linha de texto (usada no Excel)
const mudancaEmTexto = (m) => `${String(m.quando).slice(0, 10).split('-').reverse().join('/')} ${m.nome_tabela}: `
  + `${moedaBR(m.antes)} → ${moedaBR(m.depois)}${m.fora_do_sistema ? ' (fora do sistema)' : ''}`;

async function painel(query) {
  const dados = await repo.painel(montarFiltros(query));
  for (const linha of dados.lista) {
    linha.ultimas_mudancas = linha.ultimas_mudancas.map((m) => ({ ...m, nome_tabela: nomeTabela(m.tabela) }));
  }
  return dados;
}
const empresas = () => repo.empresas();

async function produto(query, params) {
  const codigo = Number(params.produto);
  if (!Number.isInteger(codigo) || codigo <= 0) throw new AppError('Código do produto inválido');
  const ficha = await repo.produto(codigo, { empresa: empresa(query.empresa) });
  if (!ficha.produto) throw new AppError(`Produto ${codigo} não encontrado`, 404);
  // A rotina da madrugada grava o nome do servidor (SQL-...): isso não é uma pessoa
  const pessoa = (nome) => (nome && !/^SQL-/i.test(nome) ? nome : null);
  const margem = (preco, custo) => (Number(preco) > 0 && custo != null
    ? Math.round(((Number(preco) - Number(custo)) / Number(preco)) * 10000) / 100
    : null);
  ficha.precos = ficha.precos.map((p) => ({
    ...p,
    nome_tabela: nomeTabela(p.tabela),
    margem_pct: margem(p.preco, p.custo_medio),
    atualizado_por: pessoa(p.atualizado_por),
  }));
  // Quem alterou: fora do sistema, o login do banco; pelo sistema o log só diz "PROCFIT",
  // então usa quem salvou a tabela de preço por último, se foi no mesmo minuto
  const segundos = (texto) => (texto ? new Date(String(texto).replace(' ', 'T')).getTime() / 1000 : null);
  ficha.historico = ficha.historico.map((h) => {
    const salvo = ficha.precos.find((p) => p.tabela === h.tabela && p.atualizado_por
      && Math.abs(segundos(p.atualizado_em) - segundos(h.quando)) <= 60);
    return {
      ...h,
      nome_tabela: nomeTabela(h.tabela),
      quem: h.fora_do_sistema ? h.usuario : (salvo?.atualizado_por ?? null),
    };
  });
  return ficha;
}

async function exportar(query) {
  const filtros = montarFiltros(query);
  const { lista } = await painel(query);
  for (const linha of lista) {
    linha.ultimas_mudancas_texto = linha.ultimas_mudancas.map(mudancaEmTexto).join(' | ');
  }
  const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : null);
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Produtos', {
    titulo: 'Logística | Belo Norte',
    subtitulo: `${lista.length} produtos · de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`
      + `${filtros.empresa ? ` · empresa ${filtros.empresa}` : ''}`
      + `${filtros.alerta ? ` · ${ALERTA_TEXTO[filtros.alerta]}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''}`
      + ` · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Código', chave: 'produto', tipo: 'codigo', largura: 9 },
      { titulo: 'Produto', chave: 'descricao', largura: 42 },
      { titulo: 'Comprado', chave: 'comprado', tipo: 'inteiro', largura: 11 },
      { titulo: 'Entrou no estoque', chave: 'entrou', tipo: 'inteiro', largura: 12 },
      { titulo: 'Vendido', chave: 'vendido', tipo: 'inteiro', largura: 11 },
      { titulo: 'Saiu do estoque', chave: 'saiu', tipo: 'inteiro', largura: 12 },
      { titulo: 'Saldo hoje', chave: 'saldo', tipo: 'inteiro', largura: 11 },
      { titulo: 'Fornecedor (última compra)', chave: 'fornecedor', largura: 34 },
      { titulo: 'Última compra', chave: 'ultima_compra', tipo: 'data', largura: 12 },
      { titulo: 'Valor unitário', chave: 'valor_unitario', tipo: 'moeda', largura: 13 },
      { titulo: 'Custo médio', chave: 'custo_medio', tipo: 'moeda', largura: 12 },
      { titulo: 'Preço varejo', chave: 'varejo', tipo: 'moeda', largura: 12 },
      { titulo: 'Preço atacado', chave: 'atacado', tipo: 'moeda', largura: 12 },
      { titulo: 'Valor comprado', chave: 'valor_comprado', tipo: 'moeda', largura: 14 },
      { titulo: 'Valor vendido', chave: 'valor_vendido', tipo: 'moeda', largura: 14 },
      { titulo: 'Mudanças de preço', chave: 'precos_alterados', tipo: 'inteiro', largura: 10 },
      { titulo: 'Fora do sistema', chave: 'precos_fora', tipo: 'inteiro', largura: 10 },
      { titulo: 'Últimas mudanças de preço', chave: 'ultimas_mudancas_texto', largura: 48 },
    ],
    linhas: lista,
  });
  return { workbook, nomeArquivo: `logistica_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

module.exports = { painel, empresas, produto, exportar };
