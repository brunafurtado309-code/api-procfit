// Regras do módulo administrativo: valida os filtros e exporta para Excel.

const AppError = require('../utils/AppError');
const repo = require('../repositories/admin.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const UM_DIA = 24 * 60 * 60 * 1000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

// Período de/até (padrão: últimos 30 dias, no máximo 1 ano)
function montarFiltros(query) {
  let inicio = data(query.inicio, 'inicio');
  let fim = data(query.fim, 'fim');
  if (!fim) fim = iso(new Date());
  if (!inicio) inicio = iso(new Date(new Date(`${fim}T12:00:00`).getTime() - 29 * UM_DIA));
  if (inicio > fim) throw new AppError('A data inicial não pode ser depois da final');
  const dias = Math.round((new Date(`${fim}T12:00:00`) - new Date(`${inicio}T12:00:00`)) / UM_DIA) + 1;
  if (dias > 366) throw new AppError('Escolha um período de no máximo 1 ano');
  const filtros = { inicio, fim };
  if (query.usuario !== undefined && query.usuario !== '') {
    const usuario = Number(query.usuario);
    if (!Number.isInteger(usuario) || usuario < 0) throw new AppError('"usuario" deve ser um número');
    filtros.usuario = usuario;
  }
  return filtros;
}

const usuarios = (query) => repo.usuarios(montarFiltros(query));
const recebimentos = (query) => repo.recebimentos(montarFiltros(query));

// Colunas da planilha de recebimentos (uma linha por título baixado)
const COLUNAS_RECEBIMENTOS = [
  { titulo: 'Dia do recebimento', chave: 'dia', tipo: 'data', largura: 13 },
  { titulo: 'Lançado às', chave: 'hora_lancamento', largura: 9 },
  { titulo: 'Quem lançou', chave: 'usuario_nome', largura: 28 },
  { titulo: 'Lote', chave: 'lote', tipo: 'codigo', largura: 9 },
  { titulo: 'Título', chave: 'titulo', largura: 16 },
  { titulo: 'Nota fiscal', chave: 'nota', tipo: 'codigo', largura: 11 },
  { titulo: 'Pedido', chave: 'pedido', tipo: 'codigo', largura: 10 },
  { titulo: 'Cód. cliente', chave: 'cod_cliente', tipo: 'codigo', largura: 11 },
  { titulo: 'Cliente', chave: 'cliente', largura: 40 },
  { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
  { titulo: 'Forma', chave: 'forma', largura: 14 },
  { titulo: 'Conta bancária', chave: 'conta_bancaria', tipo: 'codigo', largura: 11 },
  { titulo: 'Valor do título', chave: 'valor_titulo', tipo: 'moeda', largura: 14, somar: true },
  { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda', largura: 14, somar: true },
];

async function atividade(query) {
  const filtros = montarFiltros(query);
  if (filtros.usuario == null) throw new AppError('Informe o usuário');
  return repo.atividade(filtros);
}

async function exportar(query) {
  const filtros = montarFiltros(query);
  const dataBR = (d) => d.split('-').reverse().join('/');
  const periodo = `de ${dataBR(filtros.inicio)} até ${dataBR(filtros.fim)}`;
  const workbook = excel.novaPlanilha();

  if (query.tipo === 'recebimentos') {
    const lista = await repo.recebimentos(filtros);
    excel.adicionarTabela(workbook, 'Recebimentos', {
      titulo: 'Recebimentos lançados no PROCFIT | Belo Norte',
      subtitulo: `${lista.length} títulos recebidos · ${periodo}`
        + `${filtros.usuario != null ? ` · usuário ${filtros.usuario}` : ''}`
        + ` · gerado em ${new Date().toLocaleString('pt-BR')}`,
      colunas: COLUNAS_RECEBIMENTOS,
      linhas: lista,
      totais: true,
    });
    return {
      workbook,
      nomeArquivo: `recebimentos${filtros.usuario != null ? `-usuario-${filtros.usuario}` : ''}`
        + `_${filtros.inicio}_a_${filtros.fim}.xlsx`,
    };
  }

  if (filtros.usuario != null) {
    const { lancamentos } = await repo.atividade(filtros);
    excel.adicionarTabela(workbook, 'Atividade', {
      titulo: 'Atividade do usuário no PROCFIT | Belo Norte',
      subtitulo: `Usuário ${filtros.usuario} · ${lancamentos.length} ações · ${periodo}`
        + ` · gerado em ${new Date().toLocaleString('pt-BR')}`,
      colunas: [
        { titulo: 'Dia', chave: 'dia', tipo: 'data', largura: 12 },
        { titulo: 'Hora', chave: 'hora', largura: 8 },
        { titulo: 'Área', chave: 'area', largura: 14 },
        { titulo: 'O que fez', chave: 'acao', largura: 34 },
        { titulo: 'Documento', chave: 'referencia', largura: 16 },
      ],
      linhas: lancamentos,
    });
    // Segunda aba: os recebimentos dessa pessoa, título a título
    const recebidos = await repo.recebimentos(filtros);
    if (recebidos.length) {
      excel.adicionarTabela(workbook, 'Recebimentos', {
        titulo: 'Recebimentos lançados por esta pessoa | Belo Norte',
        subtitulo: `${recebidos.length} títulos recebidos · ${periodo}`,
        colunas: COLUNAS_RECEBIMENTOS,
        linhas: recebidos,
        totais: true,
      });
    }
    return { workbook, nomeArquivo: `atividade-usuario-${filtros.usuario}_${filtros.inicio}_a_${filtros.fim}.xlsx` };
  }

  const { usuarios: lista } = await repo.usuarios(filtros);
  excel.adicionarTabela(workbook, 'Usuários', {
    titulo: 'Usuários do PROCFIT e atividade | Belo Norte',
    subtitulo: `${lista.length} usuários · ${periodo} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Código', chave: 'usuario', tipo: 'codigo', largura: 9 },
      { titulo: 'Nome', chave: 'nome', largura: 34 },
      { titulo: 'Login', chave: 'login', largura: 22 },
      { titulo: 'Ativo', valor: (u) => (u.ativo === 'S' ? 'Sim' : 'Não'), largura: 8 },
      { titulo: 'Ações no período', chave: 'acoes', tipo: 'inteiro', largura: 12, somar: true },
      { titulo: 'Áreas', chave: 'areas', tipo: 'inteiro', largura: 8 },
      { titulo: 'Cancelamentos', chave: 'cancelamentos', tipo: 'inteiro', largura: 12, somar: true },
      { titulo: 'Fora do horário', chave: 'fora_horario', tipo: 'inteiro', largura: 12, somar: true },
      { titulo: 'Última atividade', chave: 'ultima_atividade', largura: 18 },
    ],
    linhas: lista,
    totais: true,
  });
  return { workbook, nomeArquivo: `usuarios-procfit_${filtros.inicio}_a_${filtros.fim}.xlsx` };
}

module.exports = { usuarios, atividade, recebimentos, exportar };
