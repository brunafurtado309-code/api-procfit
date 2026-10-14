// Regras da tabela de preços: a lista e a planilha (sempre com os preços de agora).

const repo = require('../repositories/precos.repository');
const excel = require('../utils/excel');

const lista = () => repo.varejo();

async function exportar() {
  const linhas = await repo.varejo();
  // Horário de Brasília (o servidor do Render roda em outro fuso)
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const workbook = excel.novaPlanilha();
  excel.adicionarTabela(workbook, 'Preços', {
    titulo: 'Tabela de preços (varejo) | Belo Norte',
    subtitulo: `${linhas.length} produtos · preços de ${agora}`,
    colunas: [
      { titulo: 'Código', chave: 'codigo', tipo: 'codigo', largura: 10 },
      { titulo: 'Produto', chave: 'produto', largura: 55 },
      { titulo: 'Valor varejo', chave: 'preco', tipo: 'moeda', largura: 15 },
    ],
    linhas,
  });
  const dia = agora.slice(0, 10).split('/').reverse().join('-');
  return { workbook, nomeArquivo: `tabela_de_precos_${dia}.xlsx` };
}

module.exports = { lista, exportar };
