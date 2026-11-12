// Vendas > Vendedores: junta, por vendedor, o faturado em nota (mesma conta da sub-tela
// Faturamento > Faturados por vendedor) com orçamentos, cancelados, devoluções canceladas e
// notas duplicadas (vendas-vendedores.repository.js).
//
// Proteção do resto da API, igual à do Faturamento:
//  - a mesma consulta pedida de novo em até 1 minuto vem guardada, sem ir ao banco;
//  - pedida enquanto ainda roda, espera a que já está em andamento;
//  - no máximo 4 consultas diferentes desta tela ao mesmo tempo (2 por abertura): a quinta recebe "aguarde".
// As duas partes rodam separadas: se uma falhar ou passar do tempo, a outra aparece mesmo assim.

const AppError = require('../utils/AppError');
const faturamento = require('./faturamento.service');

const GUARDAR_MS = 60 * 1000;
const MAX_SIMULTANEAS = 4; // 2 telas ao mesmo tempo (cada uma faz 2 consultas)
const guardadas = new Map();
const emAndamento = new Map();

// qual: 'controle' (orçamentos, cancelados, devoluções canceladas) ou 'duplicadas'
async function consultarControle(qual, filtros) {
  const chave = `${qual}:${JSON.stringify(filtros)}`;
  const guardada = guardadas.get(chave);
  if (guardada && Date.now() - guardada.quando < GUARDAR_MS) return guardada.dados;
  if (emAndamento.has(chave)) return emAndamento.get(chave);
  if (emAndamento.size >= MAX_SIMULTANEAS) {
    throw new AppError('Esta tela já está buscando outras informações no banco. Aguarde alguns segundos e clique em Atualizar.', 503);
  }
  const consulta = (async () => {
    const repo = require('../repositories/vendas-vendedores.repository');
    const dados = await repo[qual](filtros);
    guardadas.set(chave, { quando: Date.now(), dados });
    while (guardadas.size > 30) guardadas.delete(guardadas.keys().next().value);
    return dados;
  })();
  emAndamento.set(chave, consulta);
  try {
    return await consulta;
  } finally {
    emAndamento.delete(chave);
  }
}

async function controle(query) {
  const filtros = faturamento.montarFiltros(query);
  const base = { inicio: filtros.inicio, fim: filtros.fim, empresa: filtros.empresa ?? null };
  const [notas, pedidos, duplicadas] = await Promise.allSettled([
    faturamento.notasVendedor({ inicio: base.inicio, fim: base.fim, empresa: query.empresa }),
    consultarControle('controle', base),
    consultarControle('duplicadas', base),
  ]);
  const motivo = (r) => (r.status === 'rejected' ? (r.reason?.status ? r.reason.message : 'Não foi possível carregar agora.') : null);
  if (notas.status === 'rejected' && !notas.reason?.status) console.error('Vendas > Vendedores (notas):', notas.reason);
  if (pedidos.status === 'rejected' && !pedidos.reason?.status) console.error('Vendas > Vendedores (pedidos):', pedidos.reason);
  if (duplicadas.status === 'rejected' && !duplicadas.reason?.status) console.error('Vendas > Vendedores (duplicadas):', duplicadas.reason);
  const notasDuplicadas = duplicadas.status === 'fulfilled' ? duplicadas.value : [];

  // Uma linha por vendedor, com tudo junto
  const linhas = new Map();
  const linha = (cod, nome) => {
    const k = String(cod ?? '');
    if (!linhas.has(k)) {
      linhas.set(k, {
        cod_vendedor: cod, vendedor: nome ?? null, notas: 0, valor: 0, devolvido: 0, liquido: 0,
        notas_devolvidas: 0, orcamentos: 0, valor_orcamentos: 0, cancelados: 0, valor_cancelados: 0,
        duplicadas: 0, devolucoes_canceladas: 0,
      });
    }
    const l = linhas.get(k);
    if (!l.vendedor && nome) l.vendedor = nome;
    return l;
  };
  if (notas.status === 'fulfilled') {
    for (const v of notas.value.vendedores) {
      Object.assign(linha(v.cod_vendedor, v.vendedor), {
        notas: v.notas, valor: v.valor, devolvido: v.devolvido, liquido: v.liquido, notas_devolvidas: v.notas_devolvidas,
      });
    }
  }
  const p = pedidos.status === 'fulfilled' ? pedidos.value : null;
  if (p) {
    for (const v of p.porVendedor) {
      Object.assign(linha(v.cod_vendedor, v.vendedor), {
        orcamentos: v.orcamentos, valor_orcamentos: v.valor_orcamentos,
        cancelados: v.cancelados, valor_cancelados: v.valor_cancelados,
      });
    }
    for (const d of p.devolucoesCanceladas) linha(d.cod_vendedor, d.vendedor).devolucoes_canceladas += 1;
  }
  for (const d of notasDuplicadas) linha(d.cod_vendedor, d.vendedor).duplicadas += 1;

  return {
    periodo: base,
    vendedores: [...linhas.values()].sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0)),
    orcamentos: p?.orcamentos ?? [],
    totalOrcamentos: p?.totalOrcamentos ?? 0,
    cancelados: p?.cancelados ?? [],
    totalCancelados: p?.totalCancelados ?? 0,
    devolucoesCanceladas: p?.devolucoesCanceladas ?? [],
    duplicadas: notasDuplicadas,
    limite: p?.limite ?? null,
    // Parte que não carregou (a tela mostra o aviso só nela)
    erros: { notas: motivo(notas), pedidos: motivo(pedidos), duplicadas: motivo(duplicadas) },
  };
}

module.exports = { controle };
