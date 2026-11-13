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
  + `${moedaBR(m.antes)} → ${moedaBR(m.depois)}${m.quem ? ` por ${m.quem}` : ''}`
  + `${m.fora_do_sistema ? ' (fora do sistema)' : ''}`;

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
  // Quem alterou vem do próprio log (ver logistica.repository.js)
  ficha.historico = ficha.historico.map((h) => ({ ...h, nome_tabela: nomeTabela(h.tabela) }));
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

// ---------- Transferências (Logística > Transferências) ----------
// Regras de onde vem cada número: repositories/transferencias.repository.js
const transferenciasRepo = require('../repositories/transferencias.repository');

function situacaoDaTransferencia(t) {
  if (t.cancelada) return 'cancelada';
  if (Number(t.recebimentos) > 0) return 'recebida';
  if (Number(t.qtd_notas) > Number(t.notas_canceladas)) return 'em_transito';
  return 'sem_nota';
}
const SITUACOES_TRANSFERENCIA = {
  recebida: 'Recebida',
  em_transito: 'Em trânsito (com nota, sem recebimento)',
  sem_nota: 'Sem nota',
  cancelada: 'Cancelada',
};

async function transferencias(query) {
  const base = montarFiltros(query);
  const filtros = { inicio: base.inicio, fim: base.fim, origem: empresa(query.origem), destino: empresa(query.destino) };
  if (base.busca) filtros.busca = base.busca;
  const r = await transferenciasRepo.listar(filtros);
  const lista = r.transferencias.map((t) => ({ ...t, situacao: situacaoDaTransferencia(t) }));
  const conta = (s) => lista.filter((t) => t.situacao === s).length;
  return {
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    situacoes: SITUACOES_TRANSFERENCIA,
    resumo: {
      transferencias: lista.length,
      recebidas: conta('recebida'),
      em_transito: conta('em_transito'),
      sem_nota: conta('sem_nota'),
      canceladas: conta('cancelada'),
      quantidade: lista.filter((t) => !t.cancelada).reduce((s, t) => s + (Number(t.quantidade) || 0), 0),
      notas: lista.reduce((s, t) => s + (Number(t.qtd_notas) || 0), 0),
    },
    transferencias: lista,
    rotas: r.rotas,
    produtos: r.produtos,
    limite: lista.length >= r.limite ? r.limite : null,
  };
}

async function transferencia(query, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Transferência inválida');
  const d = await transferenciasRepo.detalhe(id);
  // Diferença só quando enviado e recebido estão na mesma unidade (ou sem unidade nos dois)
  const mesmaUnidade = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();
  d.produtos = d.produtos.map((p) => {
    const recebeu = p.recebida != null;
    const diferenca = recebeu && mesmaUnidade(p.unidade, p.unidade_recebida) ? Number(p.recebida) - Number(p.enviada) : null;
    return { ...p, diferenca: diferenca != null && Math.abs(diferenca) > 0.0001 ? diferenca : (diferenca === null ? null : 0) };
  });
  return { id, ...d };
}

// ---------- Notas de entrada (Logística > Notas de entrada) ----------
// Regras: repositories/notas-entrada.repository.js
const notasEntradaRepo = require('../repositories/notas-entrada.repository');
const SITUACOES_NOTA = ['entrada', 'pendente', 'todas'];

async function notasEntrada(query) {
  const base = montarFiltros(query);
  const situacao = SITUACOES_NOTA.includes(query.situacao) ? query.situacao : 'entrada';
  const filtros = { inicio: base.inicio, fim: base.fim, empresa: base.empresa, situacao };
  if (base.busca) filtros.busca = base.busca;
  const r = await notasEntradaRepo.listar(filtros);
  const notas = r.notas;
  const soma = (lista, campo) => lista.reduce((t, x) => t + (Number(x[campo]) || 0), 0);
  const entraram = notas.filter((x) => x.deu_entrada);
  const dias = entraram.map((x) => x.dias_ate_entrada).filter((d) => d != null);
  return {
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    situacao,
    resumo: {
      notas: notas.length,
      valor: soma(notas, 'valor'),
      com_entrada: entraram.length,
      aguardando: notas.length - entraram.length,
      compras: notas.filter((x) => !x.transferencia).length,
      transferencias: notas.filter((x) => x.transferencia).length,
      canceladas: notas.filter((x) => x.cancelada).length,
      fornecedores: new Set(notas.map((x) => x.cod_fornecedor)).size,
      media_dias_ate_entrada: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null,
    },
    notas,
    fornecedores: r.fornecedores,
    limite: notas.length >= r.limite ? r.limite : null,
  };
}

async function notaEntrada(query, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Nota inválida');
  return { id, itens: await notasEntradaRepo.itens(id) };
}

module.exports = { painel, empresas, produto, exportar, transferencias, transferencia, notasEntrada, notaEntrada };
