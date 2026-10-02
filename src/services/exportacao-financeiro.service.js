// Exportação do financeiro para Excel.
//
// Regra principal: o Excel sai com EXATAMENTE o que está filtrado na tela.
// Por isso usa o mesmo montarFiltros da lista e a mesma consulta do repository;
// a única diferença é que traz todas as linhas de uma vez, sem paginação.

const financeiro = require('./financeiro.service');
const repo = require('../repositories/financeiro.repository');
const excel = require('../utils/excel');

const LIMITE_EXPORTACAO = 100000;

const dataBR = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '');
const moedaBR = (valor) =>
  Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const SITUACAO_TEXTO = { ABERTO: 'Em aberto', PARCIAL: 'Baixa parcial', QUITADO: 'Quitado' };
const SITUACAO_FILTRO = {
  aberto: 'Em aberto (inclui baixa parcial)',
  parcial: 'Só baixa parcial',
  quitado: 'Só títulos baixados',
  todos: 'Todos',
};
const NOMES_ORDEM = {
  vencimento: 'Vencimento', nota: 'Nota', titulo: 'Título', devedor: 'Devedor', forma: 'Forma',
  valor: 'Valor', recebido: 'Recebido', pendente: 'Pendente', nota_valor: 'Valor da nota',
  nota_recebido: 'Pago da nota', nota_pendente: 'A pagar da nota',
};
const MODALIDADES = {
  0: 'Carteira', 1: 'Boleto', 2: 'Depósito', 3: 'Cheque', 4: 'Dinheiro',
  6: 'Cartão crédito', 11: 'PIX', 12: 'Cartão débito',
};

// ===== Colunas =====
const COL_TITULOS = [
  { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
  { titulo: 'Dias de atraso', valor: (t) => (t.dias_atraso > 0 ? t.dias_atraso : 0), tipo: 'inteiro', largura: 10 },
  { titulo: 'Situação', valor: (t) => SITUACAO_TEXTO[t.situacao] ?? t.situacao, largura: 13 },
  { titulo: 'Nº da nota', chave: 'nota', tipo: 'codigo', largura: 12 },
  { titulo: 'Nº do pedido', chave: 'pedido', tipo: 'codigo', largura: 12 },
  { titulo: 'Título', chave: 'titulo', largura: 16 },
  { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 11 },
  { titulo: 'Cliente', chave: 'cliente', largura: 42 },
  { titulo: 'Quem deve', valor: (t) => (t.tipo_devedor === 'ADQUIRENTE'
      ? `Adquirente${t.adquirente ? ` (${t.adquirente})` : ''}` : 'Cliente'), largura: 20 },
  { titulo: 'Forma', chave: 'modalidade', largura: 15 },
  { titulo: 'Origem', chave: 'origem', largura: 18 },
  { titulo: 'Emissão', chave: 'emissao', tipo: 'data', largura: 12 },
  { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 15, somar: true },
  { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda', largura: 15, somar: true },
  { titulo: 'Pendente', chave: 'pendente', tipo: 'moeda', largura: 15, somar: true },
  { titulo: 'Juros e multa', chave: 'juros_multa', tipo: 'moeda', largura: 13, somar: true },
  { titulo: 'Descontos', chave: 'descontos', tipo: 'moeda', largura: 13, somar: true },
  { titulo: 'Último recebimento', chave: 'ultimo_recebimento', tipo: 'data', largura: 14 },
];

const COL_CLIENTES = [
  { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 11 },
  { titulo: 'Cliente', chave: 'cliente', largura: 42 },
  { titulo: 'Títulos', chave: 'titulos', tipo: 'inteiro', largura: 9, somar: true },
  { titulo: 'Vencimento mais antigo', chave: 'vencimento_mais_antigo', tipo: 'data', largura: 14 },
  { titulo: 'Maior atraso (dias)', chave: 'maior_atraso', tipo: 'inteiro', largura: 12 },
  { titulo: 'Vencido', chave: 'vencido', tipo: 'moeda', largura: 15, somar: true },
  { titulo: 'Pendente', chave: 'pendente', tipo: 'moeda', largura: 15, somar: true },
  { titulo: 'Último recebimento', chave: 'ultimo_recebimento', tipo: 'data', largura: 14 },
];

// ===== Filtros usados, em português, para a aba "Filtros" =====
// Assim quem abrir o arquivo sabe exatamente o que foi exportado.
function descreverFiltros(f, visao) {
  const itens = [];
  const add = (rotulo, valor) => itens.push({ filtro: rotulo, valor });

  add('Visão', visao === 'clientes' ? 'Resumo por cliente' : 'Lista de títulos');
  add('Situação', SITUACAO_FILTRO[f.situacao] ?? f.situacao);
  if (f.atraso === 'vencidos') add('Vencimento', 'Só vencidos');
  if (f.atraso === 'a_vencer') add('Vencimento', 'Só a vencer');
  if (f.atraso_min !== null || f.atraso_max !== null) {
    add('Dias de atraso', f.atraso_max !== null
      ? `de ${f.atraso_min ?? 0} a ${f.atraso_max} dias`
      : `mais de ${f.atraso_min - 1} dias`);
  }
  if (f.inicio || f.fim) {
    add('Vencimento entre', `${f.inicio ? dataBR(f.inicio) : 'o início'} e ${f.fim ? dataBR(f.fim) : 'hoje em diante'}`);
  }
  if (f.modalidade !== null) add('Forma', MODALIDADES[f.modalidade] ?? `Modalidade ${f.modalidade}`);
  if (f.devedor) add('Quem deve', f.devedor === 'adquirente' ? 'Só adquirentes (cartão)' : 'Só clientes');
  if (f.origem) add('Origem', f.origem === 'nota' ? 'Só com nota fiscal' : 'Só sem nota');
  if (f.busca) add('Pesquisa', f.busca);
  if (f.f_cliente) add('Devedor contém', f.f_cliente);
  if (f.f_nota) add('Nota começa com', f.f_nota);
  if (f.f_pedido) add('Pedido começa com', f.f_pedido);
  if (f.f_titulo) add('Título contém', f.f_titulo);
  if (f.f_valor_min !== null) add('Pendente a partir de', moedaBR(f.f_valor_min));
  if (f.f_valor_max !== null) add('Pendente até', moedaBR(f.f_valor_max));
  if (f.ordem && visao !== 'clientes') {
    add('Ordenado por', `${NOMES_ORDEM[f.ordem] ?? f.ordem}, ${f.direcao === 'desc' ? 'decrescente' : 'crescente'}`);
  }
  return itens;
}

// Parte do nome do arquivo: o nome filtrado, se houver (ex.: "atacadao")
function sufixoArquivo(f, visao) {
  const texto = f.f_cliente || f.busca || (visao === 'clientes' ? 'por-cliente' : '');
  const seguro = excel.nomeSeguro(texto);
  return seguro ? `_${seguro}` : '';
}

// ===== Excel para conciliar com o banco =====
// Uma aba de instruções, um resumo por mês de vencimento e uma aba por mês com os títulos
// pendentes e colunas EM BRANCO para anotar o que foi achado no extrato.
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (chave) => (chave === 'sem-data' ? 'Sem vencimento'
  : `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(0, 4)}`);
const formaComParcela = (t) => (t.modalidade === 'Boleto' && Number(t.parcela_total) > 1
  ? `Boleto ${t.parcela_num}/${t.parcela_total}` : (t.modalidade ?? ''));
const quemDeve = (t) => (t.tipo_devedor === 'ADQUIRENTE'
  ? `Adquirente${t.adquirente ? ` (${t.adquirente})` : ''}` : 'Cliente');

const COL_CONCILIACAO = [
  { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
  { titulo: 'Dias de atraso', valor: (t) => (t.dias_atraso > 0 ? t.dias_atraso : 0), tipo: 'inteiro', largura: 9 },
  { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 10 },
  { titulo: 'Cliente', chave: 'cliente', largura: 36 },
  { titulo: 'CPF/CNPJ', chave: 'documento', largura: 18 },
  { titulo: 'Quem deve', valor: quemDeve, largura: 16 },
  { titulo: 'Nº da nota', chave: 'nota', tipo: 'codigo', largura: 10 },
  { titulo: 'Nº do pedido', chave: 'pedido', tipo: 'codigo', largura: 10 },
  { titulo: 'Título', chave: 'titulo', largura: 13 },
  { titulo: 'Forma', valor: formaComParcela, largura: 15 },
  { titulo: 'Origem', chave: 'origem', largura: 20 },
  { titulo: 'Emissão', chave: 'emissao', tipo: 'data', largura: 12 },
  { titulo: 'Valor do título', chave: 'valor', tipo: 'moeda', largura: 14, somar: true },
  { titulo: 'Já recebido', chave: 'recebido', tipo: 'moeda', largura: 13, somar: true },
  { titulo: 'Pendente (procurar no banco)', chave: 'pendente', tipo: 'moeda', largura: 16, somar: true },
  // Colunas para preencher durante a conciliação
  { titulo: 'Data no extrato', valor: () => null, largura: 13 },
  { titulo: 'Valor no extrato', valor: () => null, tipo: 'moeda', largura: 14 },
  { titulo: 'Banco / conta', valor: () => null, largura: 16 },
  { titulo: 'Baixado no PROCFIT? (S/N)', valor: () => null, largura: 12 },
  { titulo: 'Observação', valor: () => null, largura: 30 },
];

function montarConciliacao(workbook, lista, filtros, hoje) {
  const porMes = new Map();
  for (const t of lista) {
    const chave = t.vencimento ? String(t.vencimento).slice(0, 7) : 'sem-data';
    if (!porMes.has(chave)) porMes.set(chave, []);
    porMes.get(chave).push(t);
  }
  const meses = [...porMes.keys()].sort();

  excel.adicionarTabela(workbook, 'Como usar', {
    titulo: 'Conciliação do contas a receber com o banco',
    subtitulo: `gerado em ${hoje.toLocaleString('pt-BR')}`,
    colunas: [{ titulo: 'Passo a passo', chave: 'texto', largura: 110 }],
    linhas: [
      'Cada aba "Venc ..." traz os títulos PENDENTES que vencem naquele mês, em ordem de vencimento.',
      'Para cada título, procure no extrato do banco um crédito com o valor da coluna "Pendente (procurar no banco)".',
      'Use o CPF/CNPJ e o nome do cliente para confirmar: o PIX costuma mostrar o documento de quem pagou.',
      'Achou? Preencha "Data no extrato", "Valor no extrato" e "Banco / conta". Depois faça a baixa no PROCFIT e marque "S".',
      'Não achou? Deixe em branco: é título realmente em aberto (cobrança) ou pagamento ainda não identificado.',
      'Os títulos de adquirentes (cartão) são pagos pela maquininha, em lote: confira pelo extrato da adquirente.',
      'Os totais no fim de cada aba somam só as linhas visíveis quando você usa o filtro do Excel.',
    ].map((texto) => ({ texto })),
  });

  // Resumo: mês de vencimento x forma x quem deve
  const resumo = [];
  for (const mes of meses) {
    const grupos = new Map();
    for (const t of porMes.get(mes)) {
      const chave = `${t.modalidade ?? ''}|${quemDeve(t)}`;
      const g = grupos.get(chave) ?? { mes: nomeMes(mes), forma: t.modalidade ?? '', quem: quemDeve(t), titulos: 0, pendente: 0 };
      g.titulos += 1;
      g.pendente += Number(t.pendente) || 0;
      grupos.set(chave, g);
    }
    resumo.push(...[...grupos.values()].sort((a, b) => b.pendente - a.pendente));
  }
  excel.adicionarTabela(workbook, 'Resumo por mês', {
    titulo: 'Pendente por mês de vencimento',
    subtitulo: `${lista.length} títulos pendentes · ${meses.length} ${meses.length === 1 ? 'mês' : 'meses'}`,
    colunas: [
      { titulo: 'Mês de vencimento', chave: 'mes', largura: 16 },
      { titulo: 'Forma', chave: 'forma', largura: 16 },
      { titulo: 'Quem deve', chave: 'quem', largura: 22 },
      { titulo: 'Títulos', chave: 'titulos', tipo: 'inteiro', largura: 9, somar: true },
      { titulo: 'Pendente', chave: 'pendente', tipo: 'moeda', largura: 16, somar: true },
    ],
    linhas: resumo,
    totais: true,
  });

  // Uma aba por mês
  for (const mes of meses) {
    const linhas = porMes.get(mes).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento))
      || String(a.cliente ?? '').localeCompare(String(b.cliente ?? ''), 'pt-BR'));
    const total = linhas.reduce((s, t) => s + (Number(t.pendente) || 0), 0);
    excel.adicionarTabela(workbook, mes === 'sem-data' ? 'Sem vencimento' : `Venc ${mes.slice(5, 7)}-${mes.slice(0, 4)}`, {
      titulo: `Títulos pendentes com vencimento em ${nomeMes(mes)}`,
      subtitulo: `${linhas.length} títulos · pendente ${moedaBR(total)}`,
      colunas: COL_CONCILIACAO,
      linhas,
      totais: true,
    });
  }

  excel.adicionarTabela(workbook, 'Filtros', {
    titulo: 'Filtros usados nesta exportação',
    colunas: [
      { titulo: 'Filtro', chave: 'filtro', largura: 24 },
      { titulo: 'Valor', chave: 'valor', largura: 50 },
    ],
    linhas: descreverFiltros(filtros, 'titulos'),
  });
}

async function exportarTitulos(query) {
  if (query.visao === 'conciliacao') {
    // Sempre os títulos com saldo (em aberto ou baixa parcial), com os demais filtros da tela
    const filtros = {
      ...financeiro.montarFiltros({ ...query, situacao: 'aberto', limite: '', pagina: '' }),
      pagina: 1, limite: LIMITE_EXPORTACAO,
    };
    const { lista } = await repo.titulos(filtros);
    const hoje = new Date();
    const workbook = excel.novaPlanilha();
    workbook.creator = 'Painel financeiro - Belo Norte';
    montarConciliacao(workbook, lista, filtros, hoje);
    return {
      workbook,
      nomeArquivo: `conciliacao-receber${sufixoArquivo(filtros, 'titulos')}_${hoje.toISOString().slice(0, 10)}.xlsx`,
    };
  }

  const visao = query.visao === 'clientes' ? 'clientes' : 'titulos';

  // Mesmos filtros da tela, mas sem paginação
  const filtros = { ...financeiro.montarFiltros({ ...query, limite: '', pagina: '' }), pagina: 1, limite: LIMITE_EXPORTACAO };

  let linhas;
  let colunas;
  let resumoLinha;
  if (visao === 'clientes') {
    linhas = await repo.porCliente(filtros);
    colunas = COL_CLIENTES;
    resumoLinha = `${linhas.length} ${linhas.length === 1 ? 'cliente' : 'clientes'}`;
  } else {
    const { total, lista } = await repo.titulos(filtros);
    linhas = lista;
    colunas = COL_TITULOS;
    resumoLinha = `${total.total} ${total.total === 1 ? 'título' : 'títulos'} · pendente ${moedaBR(total.pendente ?? 0)}`;
    if (total.total > LIMITE_EXPORTACAO) {
      resumoLinha += ` · ATENÇÃO: só as primeiras ${LIMITE_EXPORTACAO} linhas foram exportadas`;
    }
  }

  const hoje = new Date();
  const workbook = excel.novaPlanilha();
  workbook.creator = 'Painel financeiro - Belo Norte';

  excel.adicionarTabela(workbook, visao === 'clientes' ? 'Clientes' : 'Títulos', {
    titulo: 'Contas a receber | Belo Norte',
    subtitulo: `${resumoLinha} · gerado em ${hoje.toLocaleString('pt-BR')}`,
    colunas,
    linhas,
    totais: true,
  });

  excel.adicionarTabela(workbook, 'Filtros', {
    titulo: 'Filtros usados nesta exportação',
    colunas: [
      { titulo: 'Filtro', chave: 'filtro', largura: 24 },
      { titulo: 'Valor', chave: 'valor', largura: 50 },
    ],
    linhas: descreverFiltros(filtros, visao),
  });

  const dataArquivo = hoje.toISOString().slice(0, 10);
  return {
    workbook,
    nomeArquivo: `contas-a-receber${sufixoArquivo(filtros, visao)}_${dataArquivo}.xlsx`,
  };
}

module.exports = { exportarTitulos };
