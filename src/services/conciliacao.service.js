// Regra de negócio da Conciliação: define o período do mês e chama o banco.
// (O confronto título x arquivo acontece na tela, em public/js/conciliacao-motor.js,
//  porque o arquivo do banco/Rede é escolhido pela própria usuária no navegador.)
const repository = require('../repositories/conciliacao.repository');

function periodoDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return {
    inicio: new Date(Date.UTC(ano, m - 1, 1)), // primeiro dia do mês
    fim: new Date(Date.UTC(ano, m, 1))         // primeiro dia do mês seguinte
  };
}

async function listarTitulos(mes) {
  const { inicio, fim } = periodoDoMes(mes);
  return repository.executarConsulta('conciliacao-titulos.sql', inicio, fim);
}

async function listarPedidosSemNota(mes) {
  const { inicio, fim } = periodoDoMes(mes);
  return repository.executarConsulta('conciliacao-pedidos-sem-nota.sql', inicio, fim);
}

module.exports = { listarTitulos, listarPedidosSemNota };
