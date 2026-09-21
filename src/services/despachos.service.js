// Regras da aba Despachos: valida filtros, resume os acertos e exporta para Excel.

const AppError = require('../utils/AppError');
const repo = require('../repositories/despachos.repository');
const excel = require('../utils/excel');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const SITUACOES = ['CONFERIDO', 'DIFERENCA', 'SEM_PARCELAS', 'SEM_NOTAS', 'DESCOBERTO'];
const SITUACAO_TEXTO = {
  CONFERIDO: 'Ok', DIFERENCA: 'Conferir', SEM_PARCELAS: 'Não processado', SEM_NOTAS: 'Sem notas',
  DESCOBERTO: 'Falta receber',
};
const temDescoberto = (a) => Number(a.a_descoberto) > 0.01;

function data(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!DATA_ISO.test(valor)) throw new AppError(`"${nome}" deve estar no formato AAAA-MM-DD`);
  return valor;
}

function montarFiltros(query) {
  const situacao = query.situacao ? String(query.situacao).toUpperCase() : null;
  if (situacao && !SITUACOES.includes(situacao)) {
    throw new AppError(`"situacao" deve ser: ${SITUACOES.join(', ')}`);
  }
  return {
    inicio: data(query.inicio, 'inicio'),
    fim: data(query.fim, 'fim'),
    busca: (query.busca ?? '').trim().slice(0, 60) || null,
    situacao,
  };
}

// Indicadores sobre a lista inteira do período (antes do filtro de situação)
function resumir(acertos) {
  const soma = (campo) => acertos.reduce((total, a) => total + (Number(a[campo]) || 0), 0);
  const contar = (situacao) => acertos.filter((a) => a.situacao === situacao).length;
  return {
    acertos: acertos.length,
    notas: soma('notas'),
    total_notas: soma('total_notas'),
    total_informado: soma('total_informado'),
    a_descoberto: soma('a_descoberto'),
    com_descoberto: acertos.filter(temDescoberto).length,
    total_parcelas: soma('total_parcelas'),
    diferenca: soma('diferenca'),
    conferidos: contar('CONFERIDO'),
    com_diferenca: contar('DIFERENCA'),
    sem_parcelas: contar('SEM_PARCELAS') + contar('SEM_NOTAS'),
  };
}

function filtrarSituacao(acertos, situacao) {
  if (!situacao) return acertos;
  if (situacao === 'DESCOBERTO') return acertos.filter(temDescoberto);
  if (situacao === 'SEM_PARCELAS') return acertos.filter((a) => a.situacao === 'SEM_PARCELAS' || a.situacao === 'SEM_NOTAS');
  return acertos.filter((a) => a.situacao === situacao);
}

async function lista(query) {
  const filtros = montarFiltros(query);
  const todos = await repo.lista(filtros);
  return { resumo: resumir(todos), lista: filtrarSituacao(todos, filtros.situacao) };
}

async function detalhe(query, params) {
  const numero = Number(params.acerto);
  if (!Number.isInteger(numero) || numero <= 0) throw new AppError('Número do acerto inválido');
  const dados = await repo.detalhe(numero);
  if (!dados) throw new AppError(`Acerto ${numero} não encontrado`, 404);
  return dados;
}

// Excel: a mesma lista da tela (período, pesquisa e situação)
async function exportar(query) {
  const filtros = montarFiltros(query);
  const acertos = filtrarSituacao(await repo.lista(filtros), filtros.situacao);
  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : 'o início');

  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Despachos', {
    titulo: 'Despachos | Belo Norte',
    subtitulo: `${acertos.length} despachos · recebimento de ${dataBR(filtros.inicio)} até ${filtros.fim ? dataBR(filtros.fim) : 'hoje'}`
      + `${filtros.situacao ? ` · ${SITUACAO_TEXTO[filtros.situacao]}` : ''}`
      + `${filtros.busca ? ` · pesquisa "${filtros.busca}"` : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`,
    colunas: [
      { titulo: 'Acerto', chave: 'acerto', tipo: 'codigo', largura: 9 },
      { titulo: 'Recebimento', chave: 'data_recebimento', tipo: 'data', largura: 12 },
      { titulo: 'Digitado em', chave: 'digitado_em', largura: 17 },
      { titulo: 'Lançado por', valor: (a) => a.usuario_nome ?? (a.usuario != null ? `usuário ${a.usuario}` : ''), largura: 22 },
      { titulo: 'Carga', chave: 'carga', tipo: 'codigo', largura: 9 },
      { titulo: 'Rota', chave: 'rota', largura: 18 },
      { titulo: 'Notas', chave: 'notas', tipo: 'inteiro', largura: 8, somar: true },
      { titulo: 'Total das notas', chave: 'total_notas', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Recebido', chave: 'total_informado', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Falta receber', chave: 'a_descoberto', tipo: 'moeda', largura: 14, somar: true },
      { titulo: 'Títulos gerados', chave: 'total_parcelas', tipo: 'moeda', largura: 15, somar: true },
      { titulo: 'Situação', valor: (a) => SITUACAO_TEXTO[
        a.situacao === 'CONFERIDO' || a.situacao === 'DIFERENCA'
          ? (temDescoberto(a) ? 'DESCOBERTO' : a.situacao) : a.situacao] ?? a.situacao, largura: 15 },
    ],
    linhas: acertos,
    totais: true,
  });

  const hoje = new Date().toISOString().slice(0, 10);
  return { workbook, nomeArquivo: `despachos_${hoje}.xlsx` };
}

module.exports = { lista, detalhe, exportar };
