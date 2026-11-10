// Painel da Precificação — aba ANÁLISE: o olhar do gerente sobre preço, margem e giro.
//
// Pergunta que a aba responde: "o que eu faço com o preço de cada produto?"
//   - quanto vendeu e quanto sobrou (lucro bruto e margem), comparado ao período anterior;
//   - por categoria (a categoria é a da aba Produtos);
//   - mais e menos vendidos, curva ABC, giro (vende a cada quantos dias) e o dia que mais vende;
//   - venda por dia, semana, mês e ano;
//   - custo real (com as bonificações), margem desejada e preço sugerido de cada produto;
//   - as DECISÕES: produtos que pedem uma ação, cada um com a sugestão do que fazer.
//
// Regras de conta (validadas no banco em nov/2026 com a Bruna, produtos 1732, 1827 e 411):
//   Imposto   IMPOSTOS de cada venda (caixa e nota). Nos tributados dá 29,25% (ICMS 20% + PIS 1,65%
//             + COFINS 7,6%); nos isentos e nos da fábrica, zero. "Alíquota do produto" = imposto ÷ venda
//             do último ano.
//   Margem    Igual ao PROCFIT: (venda - imposto - custo) ÷ (venda - imposto).
//             Ex.: 1827 vendido a R$ 14,30, imposto R$ 4,19, custo R$ 9,00 → 1,11 ÷ 10,11 = 11%.
//             "Sobre a venda" = (venda - imposto - custo) ÷ venda (a do mercado, usada no preço sugerido).
//   Custo     Do PROCFIT: o da própria venda (caixa). A venda por nota vem sem custo: ela é ESTIMADA
//             com o custo médio de hoje, e a tela diz quanto da venda foi estimado.
//   Custo     O PROCFIT põe a bonificação no custo pelo valor da nota. Custo real = pago nas compras
//   real      ÷ (unidades compradas + bonificadas) dos últimos 120 dias (repository). Sem compra no
//             período, vale o custo do PROCFIT. Ex.: Cerelis 1kg, R$ 21,25 no PROCFIT e R$ 16,95 real.
//   Preço     custo real ÷ (1 - alíquota do produto - margem desejada). A margem desejada é por produto,
//   sugerido  sobre a venda, e só quem tem a permissão "Edita preço" muda (gravada no banco do painel).
//   Período anterior = o mesmo número de dias, logo antes do período escolhido.
//   NÃO usar MARGEM_BRUTA / LUCRO_BRUTO da venda: copiam a margem da tabela de varejo.
//
// Insumo de produção e uso interno ficam fora (não são vendidos), pelo tipo da aba Produtos;
// produto sem tipo confirmado: industrializado = produção própria, insumo do PROCFIT = fora,
// o resto = revenda.
//
// O painel só lê e sugere. Preço se muda no PROCFIT, por quem decide.

const AppError = require('../utils/AppError');
const repo = require('../repositories/precificacao-analise.repository');
const classificacao = require('../repositories/classificacao.repository');
const { PERIODOS } = require('./precificacao.service');

// ---------- Réguas da análise (mudar aqui muda a tela inteira) ----------

const PERIODO_PADRAO = 30;
const CACHE_MINUTOS = 10;           // a base é lida do PROCFIT no máximo uma vez a cada 10 minutos
const TOP_RANKING = 10;             // mais e menos vendidos
const CURVA_A = 0.8;                // curva ABC: A = produtos que somam 80% da venda,
const CURVA_B = 0.95;               //            B = até 95%, C = o resto
const QUEDA_MARGEM = 0.05;          // perdeu margem: caiu 5 pontos ou mais (ex.: de 35% para 30%)
const VENDA_MINIMA_MARGEM = 200;    // ...e vendeu ao menos R$ 200 com custo nos dois períodos
const JANELA_PRECO = 28;            // mudança de preço: compara até 28 dias antes x 28 dias depois
const DIAS_MINIMOS_DEPOIS = 7;      // ...e só depois de 7 dias do novo preço (antes disso é cedo)
const EFEITO_QTD = 0.2;             // ...a venda mudou 20% ou mais
const VENDA_MINIMA_PRECO = 50;      // ...e o produto vendeu ao menos R$ 50 nas duas janelas
const MARGEM_DESEJADA_MAXIMA = 0.6; // ninguém grava margem desejada acima de 60% sobre a venda
const SEM_CATEGORIA = '__sem';
const ALVO_MARGEM = 'produto_margem'; // na tabela de classificação do painel: "tipo" = margem (ex.: "0.15")
const LIMITE_LOTE = 500;

const TIPOS = { revenda: 'Revenda', producao: 'Produção própria' };
const FORA_DA_ANALISE = new Set(['insumo', 'uso_interno']);
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ---------- Datas (texto "AAAA-MM-DD", sempre em UTC para não pular dia) ----------

const DIA_MS = 86400000;
const paraData = (t) => new Date(`${t}T00:00:00Z`);
const paraTexto = (d) => d.toISOString().slice(0, 10);
const somarDias = (t, n) => paraTexto(new Date(paraData(t).getTime() + n * DIA_MS));
const diasEntre = (de, ate) => Math.round((paraData(ate) - paraData(de)) / DIA_MS);
const diaDaSemana = (t) => paraData(t).getUTCDay();
// Segunda-feira da semana do dia
const inicioDaSemana = (t) => somarDias(t, -((diaDaSemana(t) + 6) % 7));
const diaMes = (t) => `${t.slice(8, 10)}/${t.slice(5, 7)}`;

// ---------- Números ----------

const n = (v) => Number(v) || 0;
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const reais = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const variacao = (atual, anterior) => (anterior > 0 ? (atual - anterior) / anterior : null);
const dividir = (a, b) => (b > 0 ? a / b : null);
// Texto de como o preço praticado mudou, para a frase do "perdeu margem"
function comoMudou(v) {
  if (v == null || Math.abs(v) < 0.005) return 'não acompanhou';
  return v > 0 ? `subiu só ${pct(v)}` : `ainda caiu ${pct(-v)}`;
}

// ---------- Contas de venda, imposto, custo e margem ----------

// Soma das linhas de venda de um produto entre duas datas (as duas entram)
//   q, v, i  = quantidade, venda e imposto de tudo
//   qc, vc, ic, c = só da parte que tem custo no PROCFIT (caixa), com o custo dela
function somar(linhas, de, ate) {
  const t = { q: 0, v: 0, i: 0, qc: 0, vc: 0, ic: 0, c: 0, dias: 0 };
  for (const l of linhas) {
    if (l.d < de || l.d > ate) continue;
    t.q += l.q; t.v += l.v; t.i += l.i; t.qc += l.qc; t.vc += l.vc; t.ic += l.ic; t.c += l.c;
    if (l.q > 0) t.dias += 1;
  }
  return t;
}

// Margem do que aconteceu no caixa, com o custo de cada venda (serve para comparar períodos)
const margemCaixa = (t) => dividir(t.vc - t.ic - t.c, t.vc - t.ic);
const custoUnitario = (t) => (t.qc > 0 ? t.c / t.qc : null);
const precoPraticado = (t) => (t.qc > 0 ? t.vc / t.qc : null);

// Resultado de um período no padrão do PROCFIT: venda sem imposto, custo e lucro.
// custoEstimado = custo por unidade para a venda que veio sem custo (nota). Sem ele, a conta usa só o caixa.
function resultado(t, custoEstimado) {
  const semCusto = Math.max(0, t.q - t.qc);
  if (semCusto > 0 && !custoEstimado) {
    return { base: t.vc - t.ic, custo: t.c, venda: t.vc, estimado: 0, parcial: true };
  }
  return {
    base: t.v - t.i,
    custo: t.c + semCusto * (custoEstimado ?? 0),
    venda: t.v,
    estimado: t.v > 0 ? Math.min(1, Math.max(0, (t.v - t.vc) / t.v)) : 0,
    parcial: false,
  };
}
// Mesmo resultado, com o custo real (bonificação descontada) em todas as unidades
const resultadoReal = (t, custoReal) => ({ base: t.v - t.i, custo: t.q * custoReal, venda: t.v });
const lucroDe = (r) => r.base - r.custo;
const margemDe = (r) => dividir(r.base - r.custo, r.base);
const sobreVendaDe = (r) => dividir(r.base - r.custo, r.venda);
const juntarResultado = (alvo, r) => { alvo.base += r.base; alvo.custo += r.custo; alvo.venda += r.venda; };
const resultadoVazio = () => ({ base: 0, custo: 0, venda: 0 });

// Preço que dá a margem desejada (sobre a venda): custo ÷ (1 - imposto - margem)
function precoPara(custo, aliquota, margemDesejada) {
  if (!custo || aliquota == null || margemDesejada == null) return null;
  const divisor = 1 - aliquota - margemDesejada;
  return divisor > 0.05 ? custo / divisor : null;
}

// ---------- Base: lida do PROCFIT e guardada por CACHE_MINUTOS ----------

let cache = null;

function organizar({ hoje, vendas, produtos, mudancas, custosReais }) {
  const vendasPorProduto = new Map();
  let primeiroDia = hoje;
  for (const l of vendas) {
    const codigo = Number(l.p);
    if (!vendasPorProduto.has(codigo)) vendasPorProduto.set(codigo, []);
    vendasPorProduto.get(codigo).push({
      d: l.d, q: n(l.q), v: n(l.v), i: n(l.i), qc: n(l.qc), vc: n(l.vc), ic: n(l.ic), c: n(l.c),
    });
    if (l.d < primeiroDia) primeiroDia = l.d;
  }
  for (const linhas of vendasPorProduto.values()) linhas.sort((a, b) => (a.d < b.d ? -1 : 1));

  const mudancasPorProduto = new Map();
  for (const m of mudancas) {
    const codigo = Number(m.produto);
    if (!mudancasPorProduto.has(codigo)) mudancasPorProduto.set(codigo, []);
    mudancasPorProduto.get(codigo).push({
      quando: m.quando, antes: n(m.antes), depois: n(m.depois), quem: m.quem, fora: Boolean(m.fora_do_sistema),
    });
  }

  // Custo real só existe com compra no período (só bonificação, sem compra, não dá para dividir)
  const custos = new Map();
  for (const c of custosReais ?? []) {
    const comprado = n(c.comprado);
    const bonificado = n(c.bonificado);
    if (!(comprado > 0) || !(n(c.pago) > 0)) continue;
    custos.set(Number(c.produto), {
      custo: n(c.pago) / (comprado + bonificado),
      comprado,
      bonificado,
      valor_bonificado: n(c.valor_bonificado),
    });
  }

  return {
    hoje,
    primeiroDia,
    vendasPorProduto,
    mudancasPorProduto,
    custosReais: custos,
    produtos: new Map(produtos.map((p) => [Number(p.codigo), {
      codigo: Number(p.codigo),
      descricao: p.descricao,
      unidade: p.unidade,
      industrializado: Boolean(p.industrializado),
      insumo: Boolean(p.insumo),
      varejo: p.varejo == null ? null : n(p.varejo),
      custo_medio: n(p.custo_medio) > 0 ? n(p.custo_medio) : null,
      saldo: n(p.saldo),
    }])),
    lidoEm: new Date().toISOString(),
  };
}

function lerBase(forcar) {
  const valido = cache && Date.now() - cache.quando < CACHE_MINUTOS * 60000;
  if (forcar || !valido) {
    const promessa = repo.base().then(organizar);
    cache = { quando: Date.now(), promessa };
    // Se a leitura falhar, não guarda o erro: a próxima chamada tenta de novo
    promessa.catch(() => { if (cache?.promessa === promessa) cache = null; });
  }
  return cache.promessa;
}

// ---------- Filtros da tela ----------

function periodo(valor) {
  if (valor === undefined || valor === null || valor === '') return PERIODO_PADRAO;
  const dias = Number(valor);
  if (!PERIODOS.includes(dias)) throw new AppError(`"dias" deve ser: ${PERIODOS.join(', ')}`);
  return dias;
}

function tipoFiltro(valor) {
  if (!valor) return null;
  if (!TIPOS[valor]) throw new AppError(`"tipo" deve ser: ${Object.keys(TIPOS).join(', ')} (ou vazio para os dois)`);
  return valor;
}

// Tipo usado na análise: o confirmado na aba Produtos ou, sem confirmação, o do cadastro
function tipoDoProduto(p, confirmado) {
  if (confirmado) return confirmado;
  if (p.industrializado) return 'producao';
  if (p.insumo) return 'insumo';
  return 'revenda';
}

// ---------- Séries no tempo (dia, semana, mês, ano) e dia da semana ----------

// porDia: Map dia -> { v, base, custo, custoReal }
function series(porDia, base, de) {
  const ponto = (rotulo, t) => ({
    rotulo,
    venda: r2(t.v),
    lucro: r2(t.base - t.custo),
    lucro_real: r2(t.base - t.custoReal),
    margem: r4(dividir(t.base - t.custo, t.base)),
  });
  const vazio = () => ({ v: 0, base: 0, custo: 0, custoReal: 0 });
  const juntar = (alvo, t) => { alvo.v += t.v; alvo.base += t.base; alvo.custo += t.custo; alvo.custoReal += t.custoReal; };

  // Dia: todos os dias do período, inclusive os sem venda (aparecem zerados)
  const dia = [];
  for (let d = de; d <= base.hoje; d = somarDias(d, 1)) dia.push(ponto(diaMes(d), porDia.get(d) ?? vazio()));

  // Semana (segunda a domingo) dentro do período
  const semanas = new Map();
  for (let d = de; d <= base.hoje; d = somarDias(d, 1)) {
    const s = inicioDaSemana(d);
    if (!semanas.has(s)) semanas.set(s, vazio());
    juntar(semanas.get(s), porDia.get(d) ?? vazio());
  }
  const semana = [...semanas].map(([s, t]) => ponto(`sem. ${diaMes(s < de ? de : s)}`, t));

  // Mês e ano: toda a base (desde 1º de janeiro do ano passado), a partir do primeiro mês com venda
  const meses = new Map();
  const anos = new Map();
  for (const [d, t] of porDia) {
    if (d < base.primeiroDia) continue;
    const m = d.slice(0, 7);
    const a = d.slice(0, 4);
    if (!meses.has(m)) meses.set(m, vazio());
    if (!anos.has(a)) anos.set(a, vazio());
    juntar(meses.get(m), t);
    juntar(anos.get(a), t);
  }
  const mes = [...meses].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([m, t]) => ponto(`${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`, t));
  const ano = [...anos].sort(([a], [b]) => (a < b ? -1 : 1)).map(([a, t]) => ponto(a, t));

  // Média por dia da semana: total do dia / quantas vezes aquele dia aparece no período
  const totais = DIAS_SEMANA.map(() => 0);
  const vezes = DIAS_SEMANA.map(() => 0);
  for (let d = de; d <= base.hoje; d = somarDias(d, 1)) {
    const w = diaDaSemana(d);
    vezes[w] += 1;
    totais[w] += porDia.get(d)?.v ?? 0;
  }
  // Segunda primeiro, domingo por último (como no calendário da loja)
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const diaSemana = ordem.map((w) => ({
    dia: DIAS_SEMANA[w], media: r2(vezes[w] ? totais[w] / vezes[w] : 0), total: r2(totais[w]), vezes: vezes[w],
  }));

  return { dia, semana, mes, ano, dia_semana: diaSemana };
}

// ---------- Mudança de preço: o que aconteceu com a venda depois ----------

// Última mudança do preço de varejo dentro do período, com a venda e o lucro por dia antes e depois.
// Devolve null se não tem mudança no período ou se ainda é cedo para medir.
function efeitoDoPreco(mudancas, linhas, de, hoje, custoEstimado) {
  const noPeriodo = (mudancas ?? []).filter((m) => m.quando.slice(0, 10) >= de && m.antes > 0 && m.depois > 0);
  const m = noPeriodo[noPeriodo.length - 1];
  if (!m) return null;
  const dia = m.quando.slice(0, 10);
  const janela = Math.min(JANELA_PRECO, diasEntre(dia, hoje));
  if (janela < DIAS_MINIMOS_DEPOIS) return { ...m, cedo: true, dias_depois: diasEntre(dia, hoje) };

  // O dia da mudança fica fora das duas janelas (metade do dia com cada preço)
  const antes = somar(linhas, somarDias(dia, -janela), somarDias(dia, -1));
  const depois = somar(linhas, somarDias(dia, 1), somarDias(dia, janela));
  const porDia = (t) => {
    const r = resultado(t, custoEstimado);
    return { qtd: t.q / janela, venda: t.v / janela, lucro: r.base ? lucroDe(r) / janela : null };
  };
  const a = porDia(antes);
  const b = porDia(depois);
  return {
    ...m,
    dia,
    janela,
    subiu: m.depois > m.antes,
    var_preco: r4(variacao(m.depois, m.antes)),
    antes_por_dia: { qtd: r4(a.qtd), venda: r2(a.venda), lucro: r2(a.lucro) },
    depois_por_dia: { qtd: r4(b.qtd), venda: r2(b.venda), lucro: r2(b.lucro) },
    var_qtd: r4(variacao(b.qtd, a.qtd)),
    var_lucro: a.lucro != null && b.lucro != null && a.lucro > 0 ? r4((b.lucro - a.lucro) / a.lucro) : null,
    venda_janelas: antes.v + depois.v,
    lucro_subiu: a.lucro != null && b.lucro != null ? b.lucro > a.lucro : null,
  };
}

// ---------- A análise ----------

async function analise(query, acesso = {}) {
  const dias = periodo(query.dias);
  const tipo = tipoFiltro(query.tipo);
  const categoria = query.categoria ? String(query.categoria) : null;

  const [base, tipos, categorias, margens] = await Promise.all([
    lerBase(query.atualizar === '1'),
    classificacao.listar('produto'),
    classificacao.listar('produto_categoria'),
    classificacao.listar(ALVO_MARGEM),
  ]);

  // Período atual (termina hoje) e o anterior, do mesmo tamanho
  const de = somarDias(base.hoje, -(dias - 1));
  const anteriorDe = somarDias(de, -dias);
  const anteriorAte = somarDias(de, -1);
  const anoAntes = somarDias(de, -365);
  const umAno = somarDias(base.hoje, -364);

  // 1. Uma linha por produto que interessa: vendeu na base ou tem estoque, e não é insumo nem uso interno
  const todos = [];
  for (const p of base.produtos.values()) {
    const linhas = base.vendasPorProduto.get(p.codigo) ?? [];
    if (!linhas.length && !(p.saldo > 0)) continue;
    const tipoProduto = tipoDoProduto(p, tipos.get(p.codigo)?.tipo);
    if (FORA_DA_ANALISE.has(tipoProduto)) continue;
    if (tipo && tipoProduto !== tipo) continue;

    const atual = somar(linhas, de, base.hoje);
    const anterior = somar(linhas, anteriorDe, anteriorAte);
    const antesDoPeriodo = somar(linhas, anoAntes, anteriorAte);
    const ano = somar(linhas, umAno, base.hoje);
    const ultimaVenda = [...linhas].reverse().find((l) => l.q > 0)?.d ?? null;

    // Imposto do produto: o que ele pagou de verdade no último ano
    const aliquota = ano.v > 0 ? Math.max(0, Math.min(0.6, ano.i / ano.v)) : null;

    // Custos: o do PROCFIT (hoje) e o real (com a bonificação descontada)
    const real = base.custosReais.get(p.codigo) ?? null;
    const custoReal = real?.custo ?? null;
    const custoBase = custoReal ?? p.custo_medio;

    const rAtual = resultado(atual, p.custo_medio);
    const rAnterior = resultado(anterior, p.custo_medio);
    const rReal = custoReal ? resultadoReal(atual, custoReal) : rAtual;

    // Dia da semana em que o produto mais vende (no período)
    const porDiaSemana = DIAS_SEMANA.map(() => 0);
    for (const l of linhas) if (l.d >= de && l.d <= base.hoje) porDiaSemana[diaDaSemana(l.d)] += l.v;
    const melhor = Math.max(...porDiaSemana);

    // Margem pela tabela de hoje (preço de varejo sem o imposto do produto)
    const varejoSemImposto = p.varejo > 0 && aliquota != null ? p.varejo * (1 - aliquota) : null;
    const margemTabela = varejoSemImposto && p.custo_medio ? (varejoSemImposto - p.custo_medio) / varejoSemImposto : null;
    const margemTabelaReal = varejoSemImposto && custoReal ? (varejoSemImposto - custoReal) / varejoSemImposto : null;

    // Margem desejada (por produto, gravada no painel) e o preço que ela pede
    const desejada = margens.get(p.codigo);
    const margemDesejada = desejada ? Number(desejada.tipo) : null;
    const precoSugerido = precoPara(custoBase, aliquota, margemDesejada);
    // A margem que o preço de hoje dá, sobre a venda, com o custo real (o "percentual pra ganhar" de hoje)
    const margemDoPreco = p.varejo > 0 && custoBase && aliquota != null ? 1 - aliquota - custoBase / p.varejo : null;

    todos.push({
      codigo: p.codigo,
      descricao: p.descricao,
      unidade: p.unidade,
      tipo: tipoProduto,
      categoria: categorias.get(p.codigo)?.tipo ?? null,
      varejo: p.varejo,
      custo_medio: p.custo_medio,
      custo_real: r4(custoReal),
      bonificacao: real?.bonificado
        ? { comprado: r4(real.comprado), bonificado: r4(real.bonificado), parcela: r4(real.bonificado / real.comprado) }
        : null,
      aliquota: r4(aliquota),
      saldo: r4(p.saldo),
      // Período atual
      qtd: r4(atual.q),
      venda: r2(atual.v),
      imposto: r2(atual.i),
      lucro: r2(lucroDe(rAtual)),
      margem: r4(margemDe(rAtual)),
      margem_sobre_venda: r4(sobreVendaDe(rAtual)),
      lucro_real: r2(lucroDe(rReal)),
      margem_real: r4(margemDe(rReal)),
      estimado: r4(rAtual.estimado),
      sem_custo: rAtual.parcial,
      custo_unitario: r4(custoUnitario(atual)),
      preco_praticado: r4(precoPraticado(atual)),
      // Período anterior
      qtd_anterior: r4(anterior.q),
      venda_anterior: r2(anterior.v),
      margem_anterior: r4(margemDe(rAnterior)),
      custo_unitario_anterior: r4(custoUnitario(anterior)),
      preco_praticado_anterior: r4(precoPraticado(anterior)),
      var_venda: r4(variacao(atual.v, anterior.v)),
      var_qtd: r4(variacao(atual.q, anterior.q)),
      // Tabela de hoje e preço
      margem_tabela: r4(margemTabela),
      margem_tabela_real: r4(margemTabelaReal),
      margem_do_preco: r4(margemDoPreco),
      margem_desejada: margemDesejada,
      margem_desejada_por: desejada?.alterado_por ?? null,
      margem_desejada_em: desejada?.alterado_em ?? null,
      preco_sugerido: r2(precoSugerido),
      diferenca_preco: precoSugerido && p.varejo ? r2(p.varejo - precoSugerido) : null,
      // Giro
      dias_com_venda: atual.dias,
      vende_a_cada: atual.dias ? r2(dias / atual.dias) : null,
      melhor_dia: melhor > 0 ? DIAS_SEMANA[porDiaSemana.indexOf(melhor)] : null,
      ultima_venda: ultimaVenda,
      dias_sem_venda: ultimaVenda ? diasEntre(ultimaVenda, base.hoje) : null,
      vendeu_antes: antesDoPeriodo.q > 0,
      ultima_mudanca: (base.mudancasPorProduto.get(p.codigo) ?? []).slice(-1)[0] ?? null,
      // Guardados só para as contas abaixo (não vão para a tela)
      _linhas: linhas,
      _atual: atual,
      _anterior: anterior,
      _r: rAtual,
      _rAnterior: rAnterior,
      _rReal: rReal,
      _custoBase: custoBase,
      _aliquota: aliquota,
    });
  }

  // 2. Categorias: calculadas antes do filtro de categoria, para a tela poder trocar de uma para outra
  const porCategoria = new Map();
  for (const p of todos) {
    const nome = p.categoria ?? SEM_CATEGORIA;
    if (!porCategoria.has(nome)) {
      porCategoria.set(nome, {
        venda: 0, vendaAnterior: 0, r: resultadoVazio(), rAnterior: resultadoVazio(), rReal: resultadoVazio(),
        produtos: 0, vendidos: 0,
      });
    }
    const c = porCategoria.get(nome);
    c.produtos += 1;
    if (p._atual.q > 0) c.vendidos += 1;
    c.venda += p._atual.v;
    c.vendaAnterior += p._anterior.v;
    juntarResultado(c.r, p._r);
    juntarResultado(c.rAnterior, p._rAnterior);
    juntarResultado(c.rReal, p._rReal);
  }
  const vendaTotal = [...porCategoria.values()].reduce((t, c) => t + c.venda, 0);
  const listaCategorias = [...porCategoria].map(([nome, c]) => ({
    categoria: nome === SEM_CATEGORIA ? null : nome,
    produtos: c.produtos,
    vendidos: c.vendidos,
    venda: r2(c.venda),
    participacao: vendaTotal > 0 ? r4(c.venda / vendaTotal) : null,
    lucro: r2(lucroDe(c.r)),
    margem: r4(margemDe(c.r)),
    margem_anterior: r4(margemDe(c.rAnterior)),
    lucro_real: r2(lucroDe(c.rReal)),
    margem_real: r4(margemDe(c.rReal)),
    var_venda: r4(variacao(c.venda, c.vendaAnterior)),
  })).sort((a, b) => b.venda - a.venda);

  // 3. Filtro de categoria
  const lista = categoria
    ? todos.filter((p) => (categoria === SEM_CATEGORIA ? !p.categoria : p.categoria === categoria))
    : todos;

  // 4. Totais do período e venda por dia (dos produtos da lista)
  const total = {
    venda: 0, vendaAnterior: 0, imposto: 0, vendaComCusto: 0,
    r: resultadoVazio(), rAnterior: resultadoVazio(), rReal: resultadoVazio(),
  };
  const porDia = new Map();
  for (const p of lista) {
    total.venda += p._atual.v;
    total.vendaAnterior += p._anterior.v;
    total.imposto += p._atual.i;
    total.vendaComCusto += p._atual.vc;
    juntarResultado(total.r, p._r);
    juntarResultado(total.rAnterior, p._rAnterior);
    juntarResultado(total.rReal, p._rReal);
    const custoReal = p.custo_real;
    for (const l of p._linhas) {
      if (!porDia.has(l.d)) porDia.set(l.d, { v: 0, base: 0, custo: 0, custoReal: 0 });
      const t = porDia.get(l.d);
      const r = resultado(l, p.custo_medio);
      t.v += l.v;
      t.base += r.base;
      t.custo += r.custo;
      t.custoReal += custoReal ? l.q * custoReal : r.custo;
    }
  }
  const tempo = series(porDia, base, de);
  const melhorDia = [...tempo.dia_semana].sort((a, b) => b.media - a.media)[0];

  // 5. Curva ABC pela venda do período
  const vendidos = lista.filter((p) => p.venda > 0).sort((a, b) => b.venda - a.venda);
  const somaVendidos = vendidos.reduce((t, p) => t + p.venda, 0);
  let acumulado = 0;
  for (const p of vendidos) {
    const fatiaAntes = somaVendidos ? acumulado / somaVendidos : 0;
    acumulado += p.venda;
    p.curva = fatiaAntes < CURVA_A ? 'A' : fatiaAntes < CURVA_B ? 'B' : 'C';
  }
  const curvas = { A: 0, B: 0, C: 0 };
  for (const p of vendidos) curvas[p.curva] += 1;

  // 6. Decisões: cada produto que pede uma ação, com o que fazer
  const decisoes = {
    abaixo_custo: [],
    so_com_bonificacao: [],
    perderam_margem: [],
    abaixo_desejada: [],
    subiu_vendeu_menos: [],
    baixou_vendeu_mais: [],
    parados: [],
  };

  for (const p of lista) {
    const aliquota = p._aliquota;
    const custoBase = p._custoBase;

    // a) O preço de varejo, sem o imposto, não paga o custo (real, se tiver)
    if (p.varejo > 0 && custoBase && aliquota != null && p.varejo * (1 - aliquota) < custoBase
        && (p.venda > 0 || p.saldo > 0)) {
      const semImposto = p.varejo * (1 - aliquota);
      const empate = custoBase / (1 - aliquota);
      decisoes.abaixo_custo.push({
        codigo: p.codigo,
        prejuizo_unidade: r2(custoBase - semImposto),
        preco_minimo: r2(empate),
        valor: p.venda,
        acao: `Vendido a ${reais(p.varejo)}, sobram ${reais(semImposto)} depois do imposto (${pct(aliquota)}), `
          + `e o custo${p.custo_real ? ' real' : ''} é ${reais(custoBase)}: perde ${reais(custoBase - semImposto)} por unidade. `
          + `Só para empatar, o preço precisa ser ${reais(empate)}. Confira antes se o custo está certo.`,
      });
    }

    // b) Só dá lucro por causa da bonificação: pelo custo do PROCFIT dá prejuízo, pelo real dá lucro
    if (p.margem_tabela != null && p.margem_tabela < 0 && p.margem_tabela_real != null && p.margem_tabela_real > 0
        && (p.venda > 0 || p.saldo > 0)) {
      const semBonificacao = p.custo_medio / (1 - aliquota);
      decisoes.so_com_bonificacao.push({
        codigo: p.codigo,
        preco_sem_bonificacao: r2(semBonificacao),
        valor: p.venda,
        acao: `Pelo custo do PROCFIT (${reais(p.custo_medio)}) dá prejuízo; com a bonificação`
          + `${p.bonificacao ? ` (${Math.round(p.bonificacao.parcela * 100)} unidades grátis a cada 100 compradas)` : ''} `
          + `o custo real é ${reais(p.custo_real)} e sobra ${pct(p.margem_tabela_real)}. `
          + `Se o fornecedor parar de bonificar, o preço precisa ir para pelo menos ${reais(semBonificacao)}.`,
      });
    }

    // O efeito da última mudança de preço (usado em c, e, f)
    const efeito = efeitoDoPreco(base.mudancasPorProduto.get(p.codigo), p._linhas, de, base.hoje, p.custo_medio);
    // Baixou o preço de propósito e passou a lucrar mais: a margem menor foi escolha, não problema
    const baixouEGanhou = efeito && !efeito.cedo && !efeito.subiu && efeito.lucro_subiu === true;

    // c) Perdeu margem: a margem do caixa caiu QUEDA_MARGEM ou mais em relação ao período anterior
    const mAt = margemCaixa(p._atual);
    const mAnt = margemCaixa(p._anterior);
    if (mAt != null && mAnt != null && p._atual.vc >= VENDA_MINIMA_MARGEM && p._anterior.vc >= VENDA_MINIMA_MARGEM
        && mAnt - mAt >= QUEDA_MARGEM && !baixouEGanhou) {
      const varCusto = variacao(custoUnitario(p._atual), custoUnitario(p._anterior));
      const varPreco = variacao(precoPraticado(p._atual), precoPraticado(p._anterior));
      // Preço cheio que devolve a margem anterior: custo ÷ (1 - margem) dá o preço sem imposto
      const semImposto = mAnt < 0.95 && custoUnitario(p._atual) ? custoUnitario(p._atual) / (1 - mAnt) : null;
      const precoSugerido = semImposto && aliquota != null && aliquota < 0.95 ? semImposto / (1 - aliquota) : null;
      let motivo;
      if (varCusto != null && varCusto > 0.02 && (varPreco == null || varPreco < varCusto)) {
        motivo = `O custo subiu ${pct(varCusto)} e o preço praticado ${comoMudou(varPreco)}.`;
      } else if (varPreco != null && varPreco < -0.02) {
        motivo = `O preço praticado caiu ${pct(-varPreco)} (desconto ou preço reduzido).`;
      } else {
        motivo = 'Custo e preço mudaram pouco: veja os descontos dados no caixa.';
      }
      const lucroPerdido = (mAnt - mAt) * (p._atual.vc - p._atual.ic);
      decisoes.perderam_margem.push({
        codigo: p.codigo,
        margem_caixa: r4(mAt),
        margem_caixa_anterior: r4(mAnt),
        var_custo: r4(varCusto),
        var_preco: r4(varPreco),
        lucro_perdido: r2(lucroPerdido),
        preco_sugerido: r2(precoSugerido),
        valor: r2(lucroPerdido),
        acao: `${motivo} ${precoSugerido ? `Para voltar a ${pct(mAnt)} de margem, o preço precisa ser ${reais(precoSugerido)}.` : ''}`.trim(),
      });
    }

    // d) Preço de hoje abaixo do que a margem desejada pede
    if (p.preco_sugerido && p.varejo > 0 && p.varejo < p.preco_sugerido * 0.99) {
      const falta = p.preco_sugerido - p.varejo;
      decisoes.abaixo_desejada.push({
        codigo: p.codigo,
        falta: r2(falta),
        valor: r2(falta * Math.max(0, p._atual.q)),
        acao: `Para ganhar ${pct(p.margem_desejada)} sobre a venda, o preço é ${reais(p.preco_sugerido)} `
          + `(hoje ${reais(p.varejo)}, ${pct(p.margem_do_preco ?? 0)}). `
          + `${p.curva === 'A' ? 'É curva A: suba aos poucos e acompanhe a venda.' : 'Pode reajustar.'}`,
      });
    }

    // e) e f) Mudou o preço de varejo no período: o que aconteceu com a venda
    if (efeito && !efeito.cedo && efeito.venda_janelas >= VENDA_MINIMA_PRECO) {
      const linha = {
        codigo: p.codigo,
        dia: efeito.dia,
        antes: efeito.antes,
        depois: efeito.depois,
        quem: efeito.quem,
        janela: efeito.janela,
        var_preco: efeito.var_preco,
        var_qtd: efeito.var_qtd,
        var_lucro: efeito.var_lucro,
        antes_por_dia: efeito.antes_por_dia,
        depois_por_dia: efeito.depois_por_dia,
      };
      const qtdAntes = efeito.antes_por_dia.qtd;
      if (efeito.subiu && qtdAntes > 0 && efeito.var_qtd <= -EFEITO_QTD) {
        decisoes.subiu_vendeu_menos.push({
          ...linha,
          valor: r2((efeito.antes_por_dia.venda - efeito.depois_por_dia.venda) * efeito.janela),
          acao: efeito.lucro_subiu
            ? 'Vende menos, mas o lucro por dia subiu: pode manter o preço novo, de olho na concorrência.'
            : `Perdeu venda e lucro. Volte para perto de ${reais(efeito.antes)} ou teste um meio-termo `
              + `(${reais((efeito.antes + efeito.depois) / 2)}).`,
        });
      }
      if (!efeito.subiu && (qtdAntes > 0 ? efeito.var_qtd >= EFEITO_QTD : efeito.depois_por_dia.qtd > 0)) {
        decisoes.baixou_vendeu_mais.push({
          ...linha,
          valor: r2((efeito.depois_por_dia.venda - efeito.antes_por_dia.venda) * efeito.janela),
          acao: efeito.lucro_subiu === false
            ? `Vende mais, mas lucra menos por dia. Suba um pouco, para perto de ${reais((efeito.antes + efeito.depois) / 2)}.`
            : 'Vende mais e lucra mais: mantenha o preço e garanta estoque (compre mais).',
        });
      }
    }

    // g) Parado: não vendeu nada no período, mas vendia antes ou tem estoque
    if (!(p._atual.q > 0) && (p.vendeu_antes || (p.saldo > 0 && p.varejo > 0))) {
      const valorEstoque = p.saldo > 0 && p.custo_medio ? p.saldo * p.custo_medio : 0;
      decisoes.parados.push({
        codigo: p.codigo,
        valor_estoque: r2(valorEstoque),
        valor: r2(valorEstoque),
        acao: p.saldo > 0
          ? `Tem ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(p.saldo)} em estoque parado`
            + `${valorEstoque ? ` (${reais(valorEstoque)} no custo)` : ''}: faça promoção ou exponha melhor, e pare de comprar até girar.`
          : 'Sem estoque e sem venda: confira se saiu de linha ou se faltou comprar.',
      });
    }
  }
  // Os de maior impacto primeiro
  for (const itens of Object.values(decisoes)) itens.sort((a, b) => n(b.valor) - n(a.valor));

  // 7. Rankings
  const maisVendidos = vendidos.slice(0, TOP_RANKING).map((p) => p.codigo);
  const menosVendidos = [...vendidos].reverse().slice(0, TOP_RANKING).map((p) => p.codigo);

  // Lista para a tela, sem os campos internos (os que começam com "_")
  const produtos = lista.map((p) => {
    const limpo = Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('_')));
    return { ...limpo, curva: p.curva ?? null };
  });
  produtos.sort((a, b) => (b.venda - a.venda) || String(a.descricao).localeCompare(String(b.descricao)));

  const nomesCategorias = listaCategorias.map((c) => c.categoria).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return {
    dias,
    hoje: base.hoje,
    de,
    anterior: { de: anteriorDe, ate: anteriorAte },
    lido_em: base.lidoEm,
    filtros: { tipo, categoria },
    pode_editar: Boolean(acesso.podeEditar),
    tipos: TIPOS,
    categorias: nomesCategorias,
    reguas: {
      queda_margem: QUEDA_MARGEM, janela_preco: JANELA_PRECO, dias_minimos_depois: DIAS_MINIMOS_DEPOIS,
      efeito_qtd: EFEITO_QTD, curva_a: CURVA_A, curva_b: CURVA_B, dias_custo_real: repo.DIAS_CUSTO_REAL,
      margem_desejada_maxima: MARGEM_DESEJADA_MAXIMA,
    },
    resumo: {
      venda: r2(total.venda),
      venda_anterior: r2(total.vendaAnterior),
      var_venda: r4(variacao(total.venda, total.vendaAnterior)),
      imposto: r2(total.imposto),
      lucro: r2(lucroDe(total.r)),
      margem: r4(margemDe(total.r)),
      margem_sobre_venda: r4(sobreVendaDe(total.r)),
      margem_anterior: r4(margemDe(total.rAnterior)),
      lucro_real: r2(lucroDe(total.rReal)),
      margem_real: r4(margemDe(total.rReal)),
      // Quanto da venda teve o custo estimado (veio por nota, sem custo no PROCFIT)
      estimado: total.venda > 0 ? r4(Math.min(1, Math.max(0, (total.venda - total.vendaComCusto) / total.venda))) : null,
      produtos_vendidos: vendidos.length,
      produtos: lista.length,
      com_custo_real: lista.filter((p) => p.custo_real).length,
      com_bonificacao: lista.filter((p) => p.bonificacao).length,
      curvas,
      melhor_dia: melhorDia && melhorDia.media > 0 ? melhorDia : null,
    },
    tempo,
    por_categoria: listaCategorias,
    mais_vendidos: maisVendidos,
    menos_vendidos: menosVendidos,
    decisoes,
    produtos,
  };
}

// ---------- Margem desejada (só com a permissão "Edita preço") ----------

// Um ou vários produtos com a mesma margem desejada (fração sobre a venda: 0.15 = 15%).
// null ou vazio tira a margem. Fica no histórico da classificação: quem mudou, de quanto para quanto.
async function definirMargens(query, params, corpo, usuario) {
  const lista = corpo?.produtos;
  if (!Array.isArray(lista) || !lista.length) throw new AppError('Escolha ao menos um produto');
  if (lista.length > LIMITE_LOTE) throw new AppError(`No máximo ${LIMITE_LOTE} produtos de uma vez`);
  const codigos = [...new Set(lista.map((c) => {
    const numero = Number(c);
    if (!Number.isInteger(numero) || numero <= 0) throw new AppError('Código do produto inválido');
    return numero;
  }))];

  let margem = corpo?.margem;
  if (margem === '' || margem === undefined) margem = null;
  if (margem !== null) {
    margem = Number(margem);
    if (!Number.isFinite(margem) || margem < 0 || margem > MARGEM_DESEJADA_MAXIMA) {
      throw new AppError(`A margem desejada vai de 0% a ${MARGEM_DESEJADA_MAXIMA * 100}%`);
    }
    margem = String(Math.round(margem * 10000) / 10000);
  }
  return classificacao.definir(ALVO_MARGEM, codigos, margem, usuario || 'chave mestra');
}

module.exports = { analise, definirMargens, SEM_CATEGORIA };
