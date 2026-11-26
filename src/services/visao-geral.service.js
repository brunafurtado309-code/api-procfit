// Visão geral do financeiro (nov/2026): a primeira tela do módulo, para quem chega e precisa
// entender em um minuto como está o dinheiro da empresa.
//
// Não tem SQL próprio de saldo: junta as consultas das telas de detalhe (contas a receber,
// contas a pagar, despachos e pedidos), então o número daqui sempre bate com o da tela que o
// detalha. Cada parte é buscada AO MESMO TEMPO; se uma falhar, só o bloco dela fica com aviso.
//
// Regras de negócio decididas com a Bruna:
// - Saldo = a receber de clientes (tudo) + cartão a vencer − a pagar (tudo).
//   O cartão VENCIDO não entra: quase sempre é dinheiro que já caiu no banco sem baixa.
// - Baixa "em dia" = pelo menos 80% do que venceu no mês já baixado (mesma régua da tela de pagar).
//   O mês atual não conta: ainda está vencendo.

const AppError = require('../utils/AppError');
const receber = require('../repositories/financeiro.repository');
const pagar = require('../repositories/pagar.repository');
const despachos = require('../repositories/despachos.repository');

const SEMANAS = 8;
const BAIXA_MINIMA = 0.8;
const DIAS_DESPACHO_PARADO = 3;
const FUSO = 'America/Fortaleza';

function empresaOpcional(valor) {
  if (valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) throw new AppError('"empresa" deve ser um número inteiro');
  return numero;
}

const num = (v) => Number(v) || 0;
const arred = (v) => Math.round(num(v) * 100) / 100;

// Segundas-feiras das próximas semanas (AAAA-MM-DD), a partir de hoje no fuso da empresa.
// Mesma conta do SQL: a semana começa na segunda.
function proximasSemanas(quantas) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: FUSO }); // AAAA-MM-DD
  const [a, m, d] = hoje.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() - ((data.getUTCDay() + 6) % 7)); // volta até a segunda
  return Array.from({ length: quantas }, (_, i) => {
    const semana = new Date(data);
    semana.setUTCDate(semana.getUTCDate() + 7 * i);
    return semana.toISOString().slice(0, 10);
  });
}

// Meses (já fechados) com menos de 80% do vencido baixado
function mesesComBaixaAtrasada(lista) {
  const mesAtual = new Date().toLocaleDateString('en-CA', { timeZone: FUSO }).slice(0, 7);
  return (lista ?? [])
    .filter((m) => m.mes < mesAtual && num(m.ja_venceu) > 0)
    .map((m) => ({ mes: m.mes, baixado: 1 - num(m.vencido_sem_baixa) / num(m.ja_venceu), sem_baixa: num(m.vencido_sem_baixa) }))
    .filter((m) => m.baixado < BAIXA_MINIMA);
}

// Resultado de uma parte: os dados, ou o motivo de não ter vindo
function parte(resultado, nome) {
  if (resultado.status === 'fulfilled') return { dados: resultado.value, erro: null };
  console.error(`Visão geral: ${nome} falhou:`, resultado.reason);
  return { dados: null, erro: `Não foi possível carregar ${nome}.` };
}

function posicaoDoDevedor(linhas, tipo) {
  const l = (linhas ?? []).find((x) => x.tipo_devedor === tipo) ?? {};
  return {
    aberto: arred(l.aberto), titulos: num(l.titulos), vencido: arred(l.vencido), vencido_titulos: num(l.vencido_titulos),
    a_vencer: arred(l.a_vencer), antigo: arred(l.antigo), antigo_titulos: num(l.antigo_titulos), devedores: num(l.devedores),
  };
}

// Um item de "Saúde dos números". nivel: ok | atencao | critico
function alerta({ id, texto, valor = null, quantidade = null, detalhe = '', nivel, link, erro = null }) {
  return { id, texto, valor: valor === null ? null : arred(valor), quantidade, detalhe, nivel: erro ? 'sem_dados' : nivel, link, erro };
}

async function painel(query) {
  const empresa = empresaOpcional(query.empresa);
  const filtros = { empresa, semanas: SEMANAS };

  const [rReceber, rPagar, rBaixasReceber, rPedidos, rDespachos] = await Promise.allSettled([
    receber.visaoGeral(filtros),
    pagar.visaoGeral(filtros),
    receber.baixasPorMes({ empresa, devedor: 'cliente' }),
    receber.pedidosPendentes({ empresa }),
    despachos.pendentes({ empresa, fim: null, busca: null }),
  ]);
  const pReceber = parte(rReceber, 'o contas a receber');
  const pPagar = parte(rPagar, 'o contas a pagar');
  const pBaixas = parte(rBaixasReceber, 'as baixas do contas a receber');
  const pPedidos = parte(rPedidos, 'os pedidos sem título');
  const pDespachos = parte(rDespachos, 'os despachos');

  // ----- Posição de hoje -----
  const clientes = posicaoDoDevedor(pReceber.dados?.porDevedor, 'CLIENTE');
  const cartao = posicaoDoDevedor(pReceber.dados?.porDevedor, 'ADQUIRENTE');
  const r = pPagar.dados?.resumo ?? {};
  const aPagar = {
    aberto: arred(r.aberto), titulos: num(r.titulos), vencido: arred(r.vencido), a_vencer: arred(r.a_vencer),
    fornecedores: num(r.fornecedores),
  };
  const posicao = {
    clientes,
    cartao,
    pagar: aPagar,
    saldo: pReceber.erro || pPagar.erro ? null : arred(clientes.aberto + cartao.a_vencer - aPagar.aberto),
    erro: pReceber.erro ?? pPagar.erro,
  };

  // ----- Entradas × saídas por semana -----
  const chaves = proximasSemanas(SEMANAS);
  const porSemana = new Map(chaves.map((s) => [s, { semana: s, clientes: 0, cartao: 0, saidas: 0 }]));
  for (const l of pReceber.dados?.semanas ?? []) {
    const s = porSemana.get(l.semana);
    if (!s) continue;
    if (l.tipo_devedor === 'ADQUIRENTE') s.cartao += num(l.valor);
    else s.clientes += num(l.valor);
  }
  for (const l of pPagar.dados?.semanas ?? []) {
    const s = porSemana.get(l.semana);
    if (s) s.saidas += num(l.valor);
  }
  let acumulado = 0;
  const semanas = chaves.map((chave) => {
    const s = porSemana.get(chave);
    const entradas = s.clientes + s.cartao;
    acumulado += entradas - s.saidas;
    return {
      semana: chave, clientes: arred(s.clientes), cartao: arred(s.cartao), entradas: arred(entradas),
      saidas: arred(s.saidas), saldo: arred(entradas - s.saidas), acumulado: arred(acumulado),
    };
  });

  // ----- Saúde dos números -----
  const baixasReceber = mesesComBaixaAtrasada(pBaixas.dados);
  const baixasPagar = mesesComBaixaAtrasada(pPagar.dados?.baixas);
  const pedidos = pPedidos.dados ?? {};
  const emRota = pDespachos.dados ?? [];
  const limiteParado = Date.now() - DIAS_DESPACHO_PARADO * 86400000;
  const parados = emRota.filter((c) => new Date(c.saida_data).getTime() < limiteParado);
  const listaMeses = (meses) => meses.map((m) => `${m.mes.slice(5)}/${m.mes.slice(0, 4)}`).join(', ');

  const saude = [
    alerta({
      id: 'cartao_vencido', texto: 'Cartão vencido sem baixa (provável pago e não baixado)',
      valor: cartao.vencido, quantidade: cartao.vencido_titulos, detalhe: 'conciliar com o extrato da adquirente',
      nivel: cartao.vencido > 0 ? 'critico' : 'ok', link: 'financeiro.html#cartao', erro: pReceber.erro,
    }),
    alerta({
      id: 'clientes_90', texto: 'Clientes vencidos há mais de 90 dias',
      valor: clientes.antigo, quantidade: clientes.antigo_titulos, detalhe: 'revisar: pago e não baixado, cancelar ou cobrar',
      nivel: clientes.antigo > 0 ? 'critico' : 'ok', link: 'financeiro.html#titulos', erro: pReceber.erro,
    }),
    alerta({
      id: 'baixas_receber', texto: 'Baixas atrasadas no contas a receber',
      valor: baixasReceber.reduce((t, m) => t + m.sem_baixa, 0), quantidade: baixasReceber.length,
      detalhe: baixasReceber.length ? `meses com menos de 80% baixado: ${listaMeses(baixasReceber)}` : 'últimos meses com as baixas em dia',
      nivel: baixasReceber.length ? 'atencao' : 'ok', link: 'financeiro.html#titulos', erro: pBaixas.erro,
    }),
    alerta({
      id: 'baixas_pagar', texto: 'Baixas atrasadas no contas a pagar',
      valor: baixasPagar.reduce((t, m) => t + m.sem_baixa, 0), quantidade: baixasPagar.length,
      detalhe: baixasPagar.length ? `meses com menos de 80% baixado: ${listaMeses(baixasPagar)}` : 'últimos meses com as baixas em dia',
      nivel: baixasPagar.length ? 'atencao' : 'ok', link: 'pagar.html#pagar', erro: pPagar.erro,
    }),
    alerta({
      id: 'enviados_banco', texto: 'Pagamentos enviados ao banco e sem baixa',
      valor: r.enviado, quantidade: num(r.enviado_titulos), detalhe: 'provavelmente pagos: falta baixar no PROCFIT',
      nivel: num(r.enviado) > 0 ? 'atencao' : 'ok', link: 'pagar.html#pagar', erro: pPagar.erro,
    }),
    alerta({
      id: 'pedidos_sem_titulo', texto: 'Pedidos não pagos ainda sem título',
      valor: pedidos.valor_sem_titulo, quantidade: num(pedidos.sem_titulo),
      detalhe: num(pedidos.sem_titulo_parados) ? `${num(pedidos.sem_titulo_parados)} parados há mais de 7 dias` : `últimos ${num(pedidos.dias) || 90} dias`,
      nivel: num(pedidos.sem_titulo_parados) > 0 ? 'atencao' : 'ok', link: 'faturamento.html', erro: pPedidos.erro,
    }),
    alerta({
      id: 'despachos_em_rota', texto: 'Despachos sem acerto',
      valor: emRota.reduce((t, c) => t + num(c.valor), 0), quantidade: emRota.length,
      detalhe: parados.length ? `${parados.length} na rua há mais de ${DIAS_DESPACHO_PARADO} dias` : 'nenhum parado',
      nivel: parados.length ? 'atencao' : 'ok', link: 'despachos.html', erro: pDespachos.erro,
    }),
  ];

  // ----- Prazos médios -----
  const pmr = pReceber.dados?.prazo?.prazo_medio;
  const pmp = pPagar.dados?.prazo?.prazo_medio;
  const prazos = {
    recebimento: pmr == null ? null : Math.round(num(pmr)),
    pagamento: pmp == null ? null : Math.round(num(pmp)),
    diferenca: pmr == null || pmp == null ? null : Math.round(num(pmr)) - Math.round(num(pmp)),
    erro: pReceber.erro ?? pPagar.erro,
  };

  return { atualizado_em: new Date().toISOString(), semanas_previstas: SEMANAS, posicao, semanas, saude, prazos };
}

module.exports = { painel };
