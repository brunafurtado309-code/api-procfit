// Montagem de planilhas Excel (.xlsx) com ExcelJS.
// Valores vão como número/data de verdade (dá para somar e filtrar no Excel).

const ExcelJS = require('exceljs');

// Cores do padrão visual (DESIGN.md): verde principal e texto suave
const COR_VERDE = 'FF1E7A4C';
const COR_VERDE_ESCURO = 'FF0F3D27';
const COR_SUAVE = 'FF56675C';

const FORMATOS = {
  moeda: '"R$" #,##0.00;[Red]-"R$" #,##0.00',
  inteiro: '#,##0',
  percentual: '0.0"%"',
  data: 'dd/mm/yyyy',
  codigo: '0', // números de nota, cupom, pedido e códigos: sem separador de milhar
};
const NUMERICOS = ['moeda', 'inteiro', 'percentual', 'codigo'];

// 'AAAA-MM-DD' -> Date (em UTC, para o Excel não mudar o dia)
function paraData(iso) {
  if (!iso) return null;
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : valor;
}

function converter(valor, tipo) {
  if (tipo === 'data') return paraData(valor);
  if (NUMERICOS.includes(tipo)) return paraNumero(valor);
  return valor ?? null;
}

function novaPlanilha() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Painel de vendas - Belo Norte';
  workbook.created = new Date();
  return workbook;
}

function escreverTitulo(ws, titulo, subtitulo) {
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: COR_VERDE_ESCURO } };
  if (subtitulo) {
    ws.getCell('A2').value = subtitulo;
    ws.getCell('A2').font = { color: { argb: COR_SUAVE } };
  }
}

// colunas: [{ titulo, chave, tipo, largura, somar, valor(linha) }]
function adicionarTabela(workbook, nomeAba, { titulo, subtitulo, colunas, linhas, totais = false }) {
  const ws = workbook.addWorksheet(nomeAba);
  ws.columns = colunas.map((c) => ({ key: c.chave || c.titulo, width: c.largura || 14 }));

  let linhaCabecalho = 1;
  if (titulo) {
    escreverTitulo(ws, titulo, subtitulo);
    linhaCabecalho = subtitulo ? 4 : 3;
  }

  // Cabeçalho
  const cabecalho = ws.getRow(linhaCabecalho);
  colunas.forEach((c, i) => {
    const cell = cabecalho.getCell(i + 1);
    cell.value = c.titulo;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_VERDE } };
    cell.alignment = {
      vertical: 'middle',
      wrapText: true,
      horizontal: NUMERICOS.includes(c.tipo) ? 'right' : 'left',
    };
  });
  cabecalho.height = 22;

  // Linhas
  linhas.forEach((linha, indice) => {
    const row = ws.getRow(linhaCabecalho + 1 + indice);
    colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const bruto = c.valor ? c.valor(linha) : linha[c.chave];
      cell.value = converter(bruto, c.tipo);
      if (FORMATOS[c.tipo]) cell.numFmt = FORMATOS[c.tipo];
    });
  });

  const primeira = linhaCabecalho + 1;
  const ultima = linhaCabecalho + linhas.length;

  // Total com SUBTOTAL: soma só o que estiver visível quando você filtrar
  if (totais && linhas.length > 0) {
    const row = ws.getRow(ultima + 1);
    row.getCell(1).value = 'Total';
    colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { bold: true };
      cell.border = { top: { style: 'medium', color: { argb: COR_VERDE } } };
      if (!c.somar) return;
      const letra = ws.getColumn(i + 1).letter;
      const soma = linhas.reduce((s, l) => s + (Number(c.valor ? c.valor(l) : l[c.chave]) || 0), 0);
      cell.value = {
        formula: `SUBTOTAL(9,${letra}${primeira}:${letra}${ultima})`,
        result: Math.round(soma * 100) / 100,
      };
      if (FORMATOS[c.tipo]) cell.numFmt = FORMATOS[c.tipo];
    });
  }

  ws.views = [{ state: 'frozen', ySplit: linhaCabecalho }];
  if (linhas.length > 0) {
    ws.autoFilter = {
      from: { row: linhaCabecalho, column: 1 },
      to: { row: linhaCabecalho, column: colunas.length },
    };
  }
  return ws;
}

// Aba de resumo: pares [rótulo, valor, tipo, observação]
function adicionarResumo(workbook, nomeAba, { titulo, subtitulo, itens }) {
  const ws = workbook.addWorksheet(nomeAba);
  ws.columns = [{ width: 28 }, { width: 20 }, { width: 44 }];
  escreverTitulo(ws, titulo, subtitulo);

  itens.forEach(([rotulo, valor, tipo, observacao], indice) => {
    const row = ws.getRow(4 + indice);
    row.getCell(1).value = rotulo;
    row.getCell(1).font = { bold: true };
    const cell = row.getCell(2);
    cell.value = converter(valor, tipo);
    if (FORMATOS[tipo]) cell.numFmt = FORMATOS[tipo];
    if (observacao) {
      row.getCell(3).value = observacao;
      row.getCell(3).font = { color: { argb: COR_SUAVE } };
    }
  });
  return ws;
}

// Nome de arquivo sem acentos e sem caracteres especiais
function nomeSeguro(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

module.exports = { novaPlanilha, adicionarTabela, adicionarResumo, nomeSeguro };
