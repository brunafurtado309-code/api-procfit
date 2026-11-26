// Logística > Estoque por empresa (nov/2026): regras de compras em cima do saldo de cada empresa.
//
// Duas visões da mesma conta:
//   - por empresa: uma coluna por empresa (as empresas vêm do banco: loja nova aparece sozinha);
//   - rede toda: o total de todas as empresas.
// Para cada produto e empresa:
//   venda/dia  = vendido nos últimos DIAS / DIAS
//   cobertura  = saldo / venda por dia (por quantos dias o estoque dura)
// Alertas (os mesmos números que o comprador usa para decidir):
//   negativo   = alguma empresa com saldo < 0 (quase sempre: entrou em outra empresa e não houve transferência)
//   parado     = sobra na rede sem venda, ou cobertura da rede acima de COBERTURA_ALTA dias
//   baixo      = cobertura da rede abaixo de COBERTURA_BAIXA dias
//   transferir = uma empresa precisa e outra tem sobra do mesmo produto (antes de comprar, transferir)
// A loja escolhida no menu (empresa) mostra só a coluna dela e os produtos que ela tem, mas o total
// da rede e a sugestão de transferência continuam olhando todas as empresas.

const AppError = require('../utils/AppError');
const repo = require('../repositories/estoque-empresas.repository');
const excel = require('../utils/excel');

const DIAS = 30;
const COBERTURA_BAIXA = 7;   // dias
const COBERTURA_ALTA = 180;  // dias
const COBERTURA_ALVO = 15;   // quem precisa deve ficar com estoque para ~15 dias
const SOBRA_MINIMA = 30;     // quem doa fica com pelo menos 30 dias de venda dele
const ALERTAS = ['negativo', 'parado', 'baixo', 'transferir'];

const num = (v) => Number(v) || 0;
const arred = (v, casas = 2) => Math.round(num(v) * 10 ** casas) / 10 ** casas;

function inteiroOpcional(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) throw new AppError(`"${nome}" deve ser um número inteiro`);
  return n;
}

function montarFiltros(query) {
  const busca = String(query.busca ?? '').trim().slice(0, 60) || null;
  const alerta = query.alerta ? String(query.alerta) : null;
  if (alerta && !ALERTAS.includes(alerta)) throw new AppError(`"alerta" deve ser: ${ALERTAS.join(', ')}`);
  return { busca, alerta, empresa: inteiroOpcional(query.empresa, 'empresa'), dias: DIAS };
}

// Números de uma empresa (ou da rede): venda por dia e cobertura
function medir(saldo, vendido) {
  const vendaDia = vendido > 0 ? vendido / DIAS : 0;
  return {
    saldo: arred(saldo, 3),
    vendido: arred(vendido, 3),
    venda_dia: arred(vendaDia, 2),
    cobertura: vendaDia > 0 && saldo > 0 ? arred(saldo / vendaDia, 1) : null,
  };
}

// Antes de comprar, transferir: quem está negativo ou com pouca cobertura recebe de quem tem sobra.
// Devolve as transferências sugeridas e quanto ainda falta (sugestão de compra).
function sugerir(porEmpresa, nomes) {
  const precisam = [];
  const sobram = [];
  for (const [empresa, m] of Object.entries(porEmpresa)) {
    const alvo = Math.ceil(m.venda_dia * COBERTURA_ALVO);
    if (m.saldo < 0 || (m.venda_dia > 0 && (m.cobertura ?? 0) < COBERTURA_BAIXA)) {
      const falta = Math.ceil(Math.max(0, alvo - m.saldo));
      if (falta > 0) precisam.push({ empresa, falta });
    } else if (m.saldo > 0) {
      const disponivel = Math.floor(m.saldo - m.venda_dia * SOBRA_MINIMA);
      if (disponivel > 0) sobram.push({ empresa, disponivel });
    }
  }
  precisam.sort((a, b) => b.falta - a.falta);
  sobram.sort((a, b) => b.disponivel - a.disponivel);
  const transferencias = [];
  for (const p of precisam) {
    for (const s of sobram) {
      if (p.falta <= 0) break;
      if (s.disponivel <= 0) continue;
      const qtd = Math.min(p.falta, s.disponivel);
      transferencias.push({ de: Number(s.empresa), de_nome: nomes[s.empresa], para: Number(p.empresa), para_nome: nomes[p.empresa], quantidade: qtd });
      p.falta -= qtd;
      s.disponivel -= qtd;
    }
  }
  const comprar = precisam.reduce((t, p) => t + p.falta, 0);
  return { transferencias, comprar };
}

// Junta as linhas (produto × empresa) num produto com as empresas dentro
function montar(linhas, filtros) {
  const nomes = {};
  const produtos = new Map();
  for (const l of linhas) {
    const empresa = String(l.empresa);
    nomes[empresa] = l.empresa_nome || `Empresa ${empresa}`;
    if (!produtos.has(l.produto)) {
      produtos.set(l.produto, { produto: l.produto, descricao: l.descricao, bruto: {} });
    }
    produtos.get(l.produto).bruto[empresa] = { saldo: num(l.saldo), vendido: num(l.vendido) };
  }

  const lista = [];
  for (const p of produtos.values()) {
    const porEmpresa = {};
    let saldoRede = 0;
    let vendidoRede = 0;
    for (const [empresa, b] of Object.entries(p.bruto)) {
      porEmpresa[empresa] = medir(b.saldo, b.vendido);
      saldoRede += b.saldo;
      vendidoRede += b.vendido;
    }
    const rede = medir(saldoRede, vendidoRede);
    const negativas = Object.entries(porEmpresa).filter(([, m]) => m.saldo < 0).map(([e]) => Number(e));
    const { transferencias, comprar } = sugerir(porEmpresa, nomes);
    const alertas = [];
    if (negativas.length) alertas.push('negativo');
    if (rede.saldo > 0 && (rede.venda_dia === 0 || (rede.cobertura ?? 0) > COBERTURA_ALTA)) alertas.push('parado');
    if (rede.venda_dia > 0 && (rede.saldo <= 0 || (rede.cobertura ?? Infinity) < COBERTURA_BAIXA)) alertas.push('baixo');
    if (transferencias.length) alertas.push('transferir');
    lista.push({
      produto: p.produto, descricao: p.descricao, empresas: porEmpresa, rede,
      empresas_negativas: negativas, transferencias, comprar_sugerido: comprar, alertas,
    });
  }

  // Loja escolhida no menu: só os produtos que ela tem (saldo ou venda); o total continua da rede
  const daLoja = filtros.empresa == null ? lista : lista.filter((p) => p.empresas[String(filtros.empresa)]);
  const resumo = {
    produtos: daLoja.length,
    ...Object.fromEntries(ALERTAS.map((a) => [a, daLoja.filter((p) => p.alertas.includes(a)).length])),
  };
  const filtrada = filtros.alerta ? daLoja.filter((p) => p.alertas.includes(filtros.alerta)) : daLoja;
  filtrada.sort((a, b) => b.alertas.length - a.alertas.length || String(a.descricao ?? '').localeCompare(String(b.descricao ?? ''), 'pt-BR'));

  // Colunas: as empresas que aparecem (ou só a escolhida no menu), em ordem de código
  const empresas = Object.keys(nomes)
    .filter((e) => filtros.empresa == null || Number(e) === filtros.empresa)
    .map((e) => ({ empresa: Number(e), nome: nomes[e] }))
    .sort((a, b) => a.empresa - b.empresa);

  return {
    dias: DIAS, regras: { cobertura_baixa: COBERTURA_BAIXA, cobertura_alta: COBERTURA_ALTA, cobertura_alvo: COBERTURA_ALVO },
    empresas, resumo, produtos: filtrada,
  };
}

async function estoque(query) {
  const filtros = montarFiltros(query);
  return montar(await repo.estoque(filtros), filtros);
}

const ALERTA_TEXTO = { negativo: 'Saldo negativo', parado: 'Parado', baixo: 'Cobertura baixa', transferir: 'Transferir' };
const textoTransferencias = (p) => p.transferencias
  .map((t) => `${t.quantidade} de ${t.de_nome} para ${t.para_nome}`).join(' · ');

// Excel: aba "Rede toda" (uma linha por produto) e aba "Por empresa" (uma linha por produto e empresa)
async function exportar(query) {
  const filtros = montarFiltros(query);
  const dados = montar(await repo.estoque(filtros), filtros);
  const geradoEm = new Date().toLocaleString('pt-BR');
  const workbook = excel.novaPlanilha();
  const recorte = [filtros.busca ? `pesquisa "${filtros.busca}"` : null,
    filtros.alerta ? ALERTA_TEXTO[filtros.alerta] : null,
    filtros.empresa != null ? dados.empresas[0]?.nome : 'todas as empresas'].filter(Boolean).join(' · ');

  excel.adicionarTabela(workbook, 'Rede toda', {
    titulo: 'Estoque da rede | Belo Norte',
    subtitulo: `${dados.produtos.length} produtos · ${recorte} · venda dos últimos ${DIAS} dias · gerado em ${geradoEm}`,
    colunas: [
      { titulo: 'Produto', chave: 'produto', tipo: 'codigo', largura: 10 },
      { titulo: 'Descrição', chave: 'descricao', largura: 42 },
      { titulo: 'Saldo da rede', valor: (p) => p.rede.saldo, tipo: 'inteiro', largura: 12 },
      { titulo: `Vendido ${DIAS} dias`, valor: (p) => p.rede.vendido, tipo: 'inteiro', largura: 12 },
      { titulo: 'Venda por dia', valor: (p) => p.rede.venda_dia, tipo: 'inteiro', largura: 11 },
      { titulo: 'Cobertura (dias)', valor: (p) => p.rede.cobertura, tipo: 'inteiro', largura: 11 },
      { titulo: 'Empresas negativas', valor: (p) => p.empresas_negativas.length, tipo: 'inteiro', largura: 10 },
      { titulo: 'Transferir', valor: textoTransferencias, largura: 50 },
      { titulo: 'Comprar (sugestão)', chave: 'comprar_sugerido', tipo: 'inteiro', largura: 12 },
      { titulo: 'Alertas', valor: (p) => p.alertas.map((a) => ALERTA_TEXTO[a]).join(', '), largura: 30 },
    ],
    linhas: dados.produtos,
  });

  const porEmpresa = dados.produtos.flatMap((p) => dados.empresas
    .filter((e) => p.empresas[String(e.empresa)])
    .map((e) => ({ produto: p.produto, descricao: p.descricao, empresa: e.empresa, nome: e.nome, ...p.empresas[String(e.empresa)] })));
  excel.adicionarTabela(workbook, 'Por empresa', {
    titulo: 'Estoque por empresa | Belo Norte',
    subtitulo: `${porEmpresa.length} linhas (produto × empresa) · ${recorte} · gerado em ${geradoEm}`,
    colunas: [
      { titulo: 'Produto', chave: 'produto', tipo: 'codigo', largura: 10 },
      { titulo: 'Descrição', chave: 'descricao', largura: 42 },
      { titulo: 'Empresa', chave: 'empresa', tipo: 'codigo', largura: 9 },
      { titulo: 'Nome da empresa', chave: 'nome', largura: 30 },
      { titulo: 'Saldo', chave: 'saldo', tipo: 'inteiro', largura: 11 },
      { titulo: `Vendido ${DIAS} dias`, chave: 'vendido', tipo: 'inteiro', largura: 12 },
      { titulo: 'Venda por dia', chave: 'venda_dia', tipo: 'inteiro', largura: 11 },
      { titulo: 'Cobertura (dias)', chave: 'cobertura', tipo: 'inteiro', largura: 11 },
    ],
    linhas: porEmpresa,
  });

  return { workbook, nomeArquivo: `estoque-por-empresa_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

module.exports = { estoque, exportar };
