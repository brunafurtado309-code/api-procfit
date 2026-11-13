// Auditoria do painel (nov/2026): procura divergências sozinha, a cada hora, e acende alertas.
// Só a conta principal vê os alertas (botão "Dúvidas" > aba Alertas). A assistente explica cada um.
//
// Regras FIXAS, sem IA (confiáveis e sem custo). Cada verificação reaproveita uma consulta que as
// telas já usam e que já foi conferida no banco — não há consulta nova no PROCFIT:
//   PREÇO E CUSTO (Precificação, período padrão)
//     preco_abaixo_custo     preço de varejo, sem o imposto, não paga o custo (o real, quando tem)
//     preco_salto            mudança de preço de 50% ou mais nos últimos 3 dias (digitação errada?)
//     preco_fora_sistema     preço mudado por fora do PROCFIT nos últimos 7 dias (direto no banco)
//     atacado_acima_varejo   a última mudança do atacado deixou ele mais caro que o varejo
//   NOTAS E PEDIDOS
//     nota_duplicada         mesmo pedido em duas notas, ou mesmo cliente + dia + valor (mês atual)
//     devolucao_cancelada    nota de devolução cancelada (mês atual)
//     cancelado_com_nota     pedido cancelado com nota válida ou título em aberto (últimos 15 dias)
//     parado_sem_faturar     pedido processado há mais de 7 dias sem nota nem cupom (últimos 15 dias)
//   FINANCEIRO
//     pago_com_titulo_aberto pago no caixa, mas o título continua em aberto (últimos 15 dias)
//     nota_sem_cobranca      nota emitida sem cupom e sem título a receber (últimos 15 dias)
//   TELAS QUE NÃO BATEM (mês atual)
//     resumo_x_vendedores    venda líquida do Resumo x soma da venda por vendedor
//     notas_x_faturado       notas do vendedor no Resumo x faturado dele em Vendas > Vendedores
//
// Cada alerta tem uma chave fixa: rodando de novo, ele não duplica. Situação:
//   aberto     encontrado e ainda não resolvido
//   ignorado   a Bruna marcou que não é problema: não volta a acender
//   resolvido  sumiu numa nova verificação (só para as regras de "estado", e só dentro do período
//              olhado; os de "evento" — salto de preço, mudança por fora, devolução cancelada —
//              ficam abertos até serem ignorados)
// Guardado no banco do painel (Postgres), nas tabelas alertas e auditoria_execucoes.
//
// Render grátis: o servidor "dorme" sem uso e o relógio para. Por isso a verificação também roda
// quando a tela de alertas é aberta e a última tem mais de 1 hora, e há o botão "Verificar agora".

const { db } = require('../config/usuariosDb');

const UMA_HORA = 60 * 60 * 1000;
const DIAS_PEDIDOS = 15;
const SALTO_PRECO = 0.5;
const DIAS_SALTO = 3;
const DIAS_FORA = 7;
const TOLERANCIA = 1; // R$: diferenças menores são arredondamento

const GRUPOS = {
  preco: 'Preço e custo',
  notas: 'Notas e pedidos',
  financeiro: 'Financeiro',
  telas: 'Telas que não batem',
};

// ---------- Datas e formatos ----------
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const inicioDoMes = (iso) => `${iso.slice(0, 8)}01`;
const num = (v) => Number(v) || 0;
const reais = (v) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => `${(num(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const dataHoraBR = (t) => (t ? `${dataBR(t)} ${String(t).slice(11, 16)}` : '');

// ---------- Tabelas ----------
let tabelasProntas = null;
async function banco() {
  const pool = await db();
  if (!tabelasProntas) {
    tabelasProntas = pool.query(`
      CREATE TABLE IF NOT EXISTS alertas (
        id            SERIAL PRIMARY KEY,
        chave         TEXT NOT NULL UNIQUE,
        regra         TEXT NOT NULL,
        grupo         TEXT NOT NULL,
        titulo        TEXT NOT NULL,
        detalhe       TEXT NOT NULL,
        valor         NUMERIC,
        dia           TEXT,
        dados         JSONB,
        status        TEXT NOT NULL DEFAULT 'aberto',
        visto         BOOLEAN NOT NULL DEFAULT false,
        primeira_vez  TIMESTAMPTZ NOT NULL DEFAULT now(),
        ultima_vez    TIMESTAMPTZ NOT NULL DEFAULT now(),
        mudou_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
        mudou_por     TEXT
      );
      CREATE TABLE IF NOT EXISTS auditoria_execucoes (
        id          SERIAL PRIMARY KEY,
        inicio      TIMESTAMPTZ NOT NULL DEFAULT now(),
        fim         TIMESTAMPTZ,
        novos       INTEGER NOT NULL DEFAULT 0,
        resolvidos  INTEGER NOT NULL DEFAULT 0,
        regras      JSONB
      );
    `).catch((err) => { tabelasProntas = null; throw err; });
  }
  await tabelasProntas;
  return pool;
}

// ---------- Nomes das lojas ----------
async function nomesDasLojas() {
  try {
    const lojas = await require('../repositories/lojas.repository').lojas();
    return new Map(lojas.map((l) => [Number(l.codigo), l.nome]));
  } catch (_) {
    return new Map();
  }
}
const nomeLoja = (lojas, codigo) => (codigo == null ? '' : lojas.get(Number(codigo)) || `loja ${codigo}`);

// ---------- Verificações ----------
// Cada fonte devolve { regra: [itens] } para várias regras de uma vez (uma consulta só).
// Item: { chave, titulo, detalhe, valor?, dia?, dados? }

async function fontePrecificacao() {
  const analise = require('./precificacao-analise.service');
  const r = await analise.analise({});
  const porCodigo = new Map(r.produtos.map((p) => [p.codigo, p]));
  const nome = (codigo) => porCodigo.get(codigo)?.descricao || `produto ${codigo}`;
  const hoje = r.hoje || hojeISO();

  const abaixo = (r.decisoes.abaixo_custo || []).map((d) => ({
    chave: `preco_abaixo_custo:${d.codigo}`,
    titulo: `${nome(d.codigo)} — preço não paga o custo`,
    detalhe: d.acao,
    valor: d.prejuizo_unidade,
    dados: { codigo: d.codigo, preco_minimo: d.preco_minimo },
  }));

  const saltos = [];
  const foras = [];
  const atacado = [];
  for (const p of r.produtos) {
    for (const m of p.mudancas_recentes || []) {
      const dia = String(m.quando || '').slice(0, 10);
      const quem = m.quem ? ` por ${m.quem}` : '';
      const texto = `${m.nome_tabela}: ${reais(m.antes)} → ${reais(m.depois)} em ${dataHoraBR(m.quando)}${quem}`;
      const variacao = m.antes > 0 ? m.depois / m.antes - 1 : null;
      if (variacao != null && Math.abs(variacao) >= SALTO_PRECO && dia >= somarDias(hoje, -DIAS_SALTO)) {
        saltos.push({
          chave: `preco_salto:${p.codigo}:${m.tabela}:${m.quando}`,
          titulo: `${p.descricao} — preço ${variacao > 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(variacao))}`,
          detalhe: `${texto}. Mudança grande de uma vez: confira se não foi erro de digitação.`,
          valor: m.depois,
          dia,
          dados: { codigo: p.codigo, ...m },
        });
      }
      if (m.fora && dia >= somarDias(hoje, -DIAS_FORA)) {
        foras.push({
          chave: `preco_fora_sistema:${p.codigo}:${m.tabela}:${m.quando}`,
          titulo: `${p.descricao} — preço mudado por fora do PROCFIT`,
          detalhe: `${texto}. A mudança não foi feita pela tela do PROCFIT (foi direto no banco ou por outro programa).`,
          valor: m.depois,
          dia,
          dados: { codigo: p.codigo, ...m },
        });
      }
    }
    // A mudança de atacado mais nova (a lista vem da mais nova para a mais antiga)
    const ultimaAtacado = (p.mudancas_recentes || []).find((m) => m.tabela !== 1);
    if (ultimaAtacado && p.varejo > 0 && ultimaAtacado.depois > p.varejo + 0.009) {
      atacado.push({
        chave: `atacado_acima_varejo:${p.codigo}`,
        titulo: `${p.descricao} — atacado mais caro que o varejo`,
        detalhe: `Atacado ${reais(ultimaAtacado.depois)} (mudado em ${dataHoraBR(ultimaAtacado.quando)}) e varejo ${reais(p.varejo)}. O atacado costuma ser o mais barato.`,
        valor: ultimaAtacado.depois - p.varejo,
        dados: { codigo: p.codigo, atacado: ultimaAtacado.depois, varejo: p.varejo },
      });
    }
  }
  return { preco_abaixo_custo: abaixo, preco_salto: saltos, preco_fora_sistema: foras, atacado_acima_varejo: atacado };
}

async function fonteVendedores(periodo, lojas) {
  const vendasVendedores = require('./vendas-vendedores.service');
  const r = await vendasVendedores.controle({ inicio: periodo.inicio, fim: periodo.fim });
  if (r.erros?.duplicadas && r.erros?.pedidos) throw new Error(r.erros.duplicadas);

  // Notas que parecem duplicadas: uma linha por grupo suspeito
  const grupos = new Map();
  for (const d of r.duplicadas || []) {
    const k = `${d.motivo}|${d.grupo}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(d);
  }
  const duplicadas = [...grupos.entries()].map(([k, notas]) => {
    const n = notas[0];
    const motivo = n.motivo === 'pedido' ? `o mesmo pedido ${n.pedido} está em ${notas.length} notas` : `mesmo cliente, mesmo dia e mesmo valor em ${notas.length} notas`;
    return {
      chave: `nota_duplicada:${k}`,
      titulo: `Notas ${notas.map((x) => x.nota).join(' e ')} parecem duplicadas`,
      detalhe: `${n.cliente || `Cliente ${n.cod_cliente}`}, ${dataBR(n.dia)}, ${reais(n.valor)} cada (${nomeLoja(lojas, n.empresa)}, vendedor ${n.vendedor || n.cod_vendedor}): ${motivo}. Pode ser uma compra repetida de verdade — confira.`,
      valor: notas.reduce((t, x) => t + num(x.valor), 0) - num(n.valor),
      dia: n.dia,
      dados: { notas: notas.map((x) => x.nota), pedido: n.pedido, cliente: n.cod_cliente },
    };
  });

  const devolucoes = r.erros?.pedidos ? null : (r.devolucoesCanceladas || []).map((d) => ({
    chave: `devolucao_cancelada:${d.nota_devolucao}:${d.empresa}`,
    titulo: `Nota de devolução ${d.nota_devolucao} foi cancelada`,
    detalhe: `Devolução da nota ${d.nota_origem} (${d.cliente || `cliente ${d.cod_cliente}`}, ${reais(d.valor)}), cancelada em ${dataHoraBR(d.cancelado_em)}${d.com_protocolo ? '' : ', sem protocolo da SEFAZ'}. Confira se a mercadoria voltou ou não.`,
    valor: d.valor,
    dia: d.devolucao_dia,
    dados: d,
  }));

  // Telas: notas do vendedor no Resumo x faturado dele em Vendas > Vendedores
  const faturado = new Map((r.vendedores || []).map((v) => [String(v.cod_vendedor ?? ''), v]));
  return { duplicadas: r.erros?.duplicadas ? null : duplicadas, devolucoes, faturado: r.erros?.notas ? null : faturado };
}

async function fonteVendas(periodo) {
  const vendas = require('./vendas.service');
  const filtros = { inicio: periodo.inicio, fim: periodo.fim };
  // Uma depois da outra (não ocupa duas conexões do banco ao mesmo tempo)
  const resumo = await vendas.resumo(filtros);
  const porVendedor = await vendas.porVendedor(filtros);
  return { resumo, porVendedor: porVendedor.vendedores || [] };
}

async function fonteFaturamento(lojas) {
  const faturamento = require('./faturamento.service');
  const fim = hojeISO();
  const inicio = somarDias(fim, -(DIAS_PEDIDOS - 1));
  const { lista } = await faturamento.analise({ inicio, fim });
  const quem = (p) => `${p.cliente || `cliente ${p.cod_cliente}`}, ${nomeLoja(lojas, p.empresa)}, vendedor ${p.vendedor || p.cod_vendedor}`;
  const pedido = (regra, p, titulo, detalhe, valor) => ({
    chave: `${regra}:${p.pedido}`, titulo, detalhe: `${quem(p)}. ${detalhe}`, valor, dia: p.dia,
    dados: { pedido: p.pedido, nota: p.nota, cupom: p.cupom, valor: p.valor, pendente: p.pendente },
  });
  const so = (flag) => (lista || []).filter((p) => Number(p[flag]) === 1);
  return {
    janela: inicio,
    pago_com_titulo_aberto: so('pago_com_titulo_aberto').map((p) => pedido('pago_com_titulo_aberto', p,
      `Pedido ${p.pedido} pago no caixa, mas o título está em aberto`,
      `Foi pago no cupom ${p.cupom}, mas ainda há ${reais(p.pendente)} em aberto no contas a receber. Dar baixa no título ou conferir o pagamento.`,
      p.pendente)),
    nota_sem_cobranca: so('nota_sem_cobranca').map((p) => pedido('nota_sem_cobranca', p,
      `Nota ${p.nota} sem cobrança`,
      `Pedido ${p.pedido}, ${reais(p.valor)}: a nota foi emitida, mas não tem cupom nem título a receber. Ninguém vai cobrar esse valor.`,
      p.valor)),
    cancelado_com_nota: so('cancelado_com_nota').map((p) => pedido('cancelado_com_nota', p,
      `Pedido ${p.pedido} cancelado, mas com nota ou título em aberto`,
      `${p.nota ? `A nota ${p.nota} continua válida` : 'Não tem nota'}${num(p.pendente) > 0 ? ` e há ${reais(p.pendente)} em aberto` : ''}. Cancelar a nota/título ou reativar o pedido.`,
      p.valor)),
    parado_sem_faturar: so('parado_sem_faturar').map((p) => pedido('parado_sem_faturar', p,
      `Pedido ${p.pedido} parado há mais de 7 dias`,
      `Processado em ${dataBR(p.dia)}, ${reais(p.valor)}, e ainda sem nota nem cupom. Faturar ou cancelar.`,
      p.valor)),
  };
}

function comparacoesDeTelas(periodo, vendas, faturado) {
  const mes = periodo.inicio.slice(0, 7);
  const itens = { resumo_x_vendedores: null, notas_x_faturado: null };
  if (vendas) {
    const total = num(vendas.resumo?.venda_liquida);
    const soma = (vendas.porVendedor || []).reduce((t, v) => t + num(v.liquido), 0);
    itens.resumo_x_vendedores = Math.abs(total - soma) > TOLERANCIA ? [{
      chave: `resumo_x_vendedores:${mes}`,
      titulo: 'Total do Resumo não bate com a soma dos vendedores',
      detalhe: `Em ${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)}: venda líquida do Resumo ${reais(total)} e soma da "Venda por vendedor" ${reais(soma)} (diferença de ${reais(total - soma)}).`,
      valor: Math.abs(total - soma),
      dia: periodo.inicio,
      dados: { total, soma },
    }] : [];
  }
  if (vendas && faturado) {
    itens.notas_x_faturado = [];
    for (const v of vendas.porVendedor || []) {
      const f = faturado.get(String(v.vendedor ?? ''));
      const notas = num(v.notas_valor);
      const fat = num(f?.valor);
      if (Math.abs(notas - fat) <= TOLERANCIA) continue;
      itens.notas_x_faturado.push({
        chave: `notas_x_faturado:${mes}:${v.vendedor}`,
        titulo: `${v.nome}: notas do Resumo diferentes do Faturado`,
        detalhe: `No mês: ${reais(notas)} em notas no Resumo de Vendas e ${reais(fat)} faturado em Vendas > Vendedores (diferença de ${reais(notas - fat)}). As duas telas deviam mostrar o mesmo valor de notas.`,
        valor: Math.abs(notas - fat),
        dia: periodo.inicio,
        dados: { vendedor: v.vendedor, notas, faturado: fat },
      });
    }
  }
  return itens;
}

// Regras: grupo, e se é "evento" (não se resolve sozinho)
const REGRAS = {
  preco_abaixo_custo: { grupo: 'preco' },
  preco_salto: { grupo: 'preco', evento: true },
  preco_fora_sistema: { grupo: 'preco', evento: true },
  atacado_acima_varejo: { grupo: 'preco' },
  nota_duplicada: { grupo: 'notas' },
  devolucao_cancelada: { grupo: 'notas', evento: true },
  cancelado_com_nota: { grupo: 'notas' },
  parado_sem_faturar: { grupo: 'notas' },
  pago_com_titulo_aberto: { grupo: 'financeiro' },
  nota_sem_cobranca: { grupo: 'financeiro' },
  resumo_x_vendedores: { grupo: 'telas' },
  notas_x_faturado: { grupo: 'telas' },
};

// Roda tudo; devolve { regra: { itens, janela } } ou { regra: { erro } }
async function verificar() {
  const hoje = hojeISO();
  const periodo = { inicio: inicioDoMes(hoje), fim: hoje };
  const lojas = await nomesDasLojas();
  const resultado = {};
  const falhou = (regras, err) => {
    console.error('Auditoria:', regras.join(', '), '-', err.message);
    for (const r of regras) resultado[r] = { erro: err.status ? err.message : 'Não foi possível consultar agora.' };
  };

  // Uma fonte de cada vez: não ocupa várias conexões do banco ao mesmo tempo
  try {
    const p = await fontePrecificacao();
    for (const [regra, itens] of Object.entries(p)) resultado[regra] = { itens };
  } catch (err) { falhou(['preco_abaixo_custo', 'preco_salto', 'preco_fora_sistema', 'atacado_acima_varejo'], err); }

  let faturado = null;
  try {
    const v = await fonteVendedores(periodo, lojas);
    if (v.duplicadas) resultado.nota_duplicada = { itens: v.duplicadas, janela: periodo.inicio };
    else resultado.nota_duplicada = { erro: 'Não foi possível consultar agora.' };
    if (v.devolucoes) resultado.devolucao_cancelada = { itens: v.devolucoes, janela: periodo.inicio };
    else resultado.devolucao_cancelada = { erro: 'Não foi possível consultar agora.' };
    faturado = v.faturado;
  } catch (err) { falhou(['nota_duplicada', 'devolucao_cancelada'], err); }

  try {
    const f = await fonteFaturamento(lojas);
    for (const regra of ['pago_com_titulo_aberto', 'nota_sem_cobranca', 'cancelado_com_nota', 'parado_sem_faturar']) {
      resultado[regra] = { itens: f[regra], janela: f.janela };
    }
  } catch (err) { falhou(['pago_com_titulo_aberto', 'nota_sem_cobranca', 'cancelado_com_nota', 'parado_sem_faturar'], err); }

  let vendas = null;
  try { vendas = await fonteVendas(periodo); } catch (err) { falhou(['resumo_x_vendedores'], err); }
  const telas = comparacoesDeTelas(periodo, vendas, faturado);
  for (const [regra, itens] of Object.entries(telas)) {
    if (itens) resultado[regra] = { itens, janela: periodo.inicio };
    else if (!resultado[regra]) resultado[regra] = { erro: 'Não foi possível comparar agora (uma das telas não carregou).' };
  }
  return resultado;
}

// Grava: novos entram abertos, os que voltaram reabrem, os que sumiram (só regras de estado,
// dentro do período olhado) ficam resolvidos. Ignorados continuam ignorados.
async function gravar(resultado) {
  const pool = await banco();
  const { rows: existentes } = await pool.query('SELECT id, chave, regra, status, dia FROM alertas');
  const porChave = new Map(existentes.map((a) => [a.chave, a]));
  let novos = 0;
  let resolvidos = 0;
  const vistosAgora = new Set();

  for (const [regra, r] of Object.entries(resultado)) {
    if (!r.itens) continue;
    const def = REGRAS[regra];
    for (const item of r.itens) {
      vistosAgora.add(item.chave);
      const ja = porChave.get(item.chave);
      const campos = [item.titulo, item.detalhe, item.valor ?? null, item.dia ?? null, JSON.stringify(item.dados ?? {})];
      if (!ja) {
        await pool.query(
          `INSERT INTO alertas (chave, regra, grupo, titulo, detalhe, valor, dia, dados) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.chave, regra, def.grupo, ...campos]
        );
        novos += 1;
      } else if (ja.status === 'resolvido') {
        await pool.query(
          `UPDATE alertas SET titulo = $2, detalhe = $3, valor = $4, dia = $5, dados = $6, status = 'aberto', visto = false,
                  ultima_vez = now(), mudou_em = now(), mudou_por = 'auditoria' WHERE id = $1`,
          [ja.id, ...campos]
        );
        novos += 1;
      } else {
        await pool.query(`UPDATE alertas SET titulo = $2, detalhe = $3, valor = $4, dia = $5, dados = $6, ultima_vez = now() WHERE id = $1`, [ja.id, ...campos]);
      }
    }
    // Sumiu: resolve (regra de estado, verificação deu certo, e o alerta está dentro do período olhado)
    if (def.evento) continue;
    for (const a of existentes) {
      if (a.regra !== regra || a.status !== 'aberto' || vistosAgora.has(a.chave)) continue;
      if (r.janela && a.dia && a.dia < r.janela) continue;
      await pool.query(`UPDATE alertas SET status = 'resolvido', mudou_em = now(), mudou_por = 'auditoria' WHERE id = $1`, [a.id]);
      resolvidos += 1;
    }
  }
  return { novos, resolvidos };
}

let rodando = null;
async function rodar() {
  if (rodando) return rodando;
  rodando = (async () => {
    const pool = await banco();
    const { rows } = await pool.query('INSERT INTO auditoria_execucoes (novos) VALUES (0) RETURNING id');
    const id = rows[0].id;
    try {
      const resultado = await verificar();
      const { novos, resolvidos } = await gravar(resultado);
      const regras = Object.fromEntries(Object.entries(resultado).map(([k, r]) => [k, r.erro ? { erro: r.erro } : { encontrados: r.itens.length }]));
      await pool.query('UPDATE auditoria_execucoes SET fim = now(), novos = $2, resolvidos = $3, regras = $4 WHERE id = $1',
        [id, novos, resolvidos, JSON.stringify(regras)]);
      return { novos, resolvidos, regras };
    } catch (err) {
      await pool.query('UPDATE auditoria_execucoes SET fim = now(), regras = $2 WHERE id = $1', [id, JSON.stringify({ geral: { erro: err.message } })]);
      throw err;
    }
  })();
  try {
    return await rodando;
  } finally {
    rodando = null;
  }
}

async function ultimaExecucao(pool) {
  const { rows } = await pool.query('SELECT id, inicio, fim, novos, resolvidos, regras FROM auditoria_execucoes WHERE fim IS NOT NULL ORDER BY id DESC LIMIT 1');
  return rows[0] ?? null;
}

// Roda em segundo plano se a última verificação tem mais de 1 hora
async function rodarSeAtrasada() {
  if (rodando) return;
  const pool = await banco();
  const ultima = await ultimaExecucao(pool);
  if (!ultima || Date.now() - new Date(ultima.fim).getTime() > UMA_HORA) {
    rodar().catch((err) => console.error('Auditoria (segundo plano):', err.message));
  }
}

// ---------- Para a tela ----------
async function listar({ status } = {}) {
  const pool = await banco();
  rodarSeAtrasada().catch(() => {});
  const situacao = ['aberto', 'ignorado', 'resolvido'].includes(status) ? status : 'aberto';
  const { rows } = await pool.query(
    `SELECT id, regra, grupo, titulo, detalhe, valor, dia, status, visto, primeira_vez, ultima_vez, mudou_em, mudou_por
       FROM alertas WHERE status = $1
      ORDER BY visto ASC, primeira_vez DESC, valor DESC NULLS LAST
      LIMIT 1000`,
    [situacao]
  );
  const { rows: contagem } = await pool.query(
    `SELECT status, COUNT(*)::int AS total, SUM(CASE WHEN NOT visto THEN 1 ELSE 0 END)::int AS novos FROM alertas GROUP BY status`
  );
  const ultima = await ultimaExecucao(pool);
  return {
    grupos: GRUPOS,
    status: situacao,
    alertas: rows,
    contagem: Object.fromEntries(contagem.map((c) => [c.status, { total: c.total, novos: c.novos }])),
    ultima,
    rodando: Boolean(rodando),
  };
}

// Só o número de alertas novos (para a bolinha do botão)
async function novos() {
  const pool = await banco();
  rodarSeAtrasada().catch(() => {});
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS novos FROM alertas WHERE status = 'aberto' AND NOT visto`);
  return { novos: rows[0].novos };
}

async function marcarVistos() {
  const pool = await banco();
  await pool.query(`UPDATE alertas SET visto = true WHERE status = 'aberto' AND NOT visto`);
  return { ok: true };
}

async function mudarStatus(id, status, quem) {
  id = Number(id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Alerta inválido.'), { status: 400 });
  if (!['aberto', 'ignorado'].includes(status)) throw Object.assign(new Error('Situação inválida.'), { status: 400 });
  const pool = await banco();
  const { rows } = await pool.query(
    `UPDATE alertas SET status = $2, visto = true, mudou_em = now(), mudou_por = $3 WHERE id = $1 RETURNING id, status`,
    [id, status, quem || null]
  );
  if (!rows[0]) throw Object.assign(new Error('Alerta não encontrado.'), { status: 404 });
  return rows[0];
}

// Relógio: a cada hora, enquanto o servidor estiver acordado (começa 2 minutos depois de subir)
function iniciarRelogio() {
  if (!process.env.DATABASE_URL || process.env.AUDITORIA_DESLIGADA === '1') return;
  const tentar = () => rodarSeAtrasada().catch((err) => console.error('Auditoria (relógio):', err.message));
  setTimeout(tentar, 2 * 60 * 1000).unref();
  setInterval(tentar, 10 * 60 * 1000).unref(); // confere a cada 10 min; só roda se passou 1 hora
}

module.exports = { listar, novos, marcarVistos, mudarStatus, rodar, iniciarRelogio, GRUPOS, _interno: { verificar, gravar, comparacoesDeTelas } };
