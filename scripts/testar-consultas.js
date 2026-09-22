// Testa as consultas do financeiro no banco REAL, com o mesmo usuário da API (.env).
// Uso (na pasta do projeto): node scripts/testar-consultas.js
// Só lê dados. Mostra OK ou a mensagem de erro exata de cada consulta.

require('dotenv').config();
const financeiro = require('../src/repositories/financeiro.repository');
const pagar = require('../src/repositories/pagar.repository');
const despachos = require('../src/repositories/despachos.repository');

const testes = [
  ['Contas a pagar (tela)', () => pagar.painel({ situacao: 'aberto' })],
  ['Contas a pagar ordenado por vencimento', () => pagar.painel({ situacao: 'aberto', ordem: 'vencimento', direcao: 'desc' })],
  ['Contas a receber: títulos por vencimento', () => financeiro.titulos({ ordem: 'vencimento', limite: 5, pagina: 1 })],
  ['Contas a receber: títulos por nota', () => financeiro.titulos({ ordem: 'nota', limite: 5, pagina: 1 })],
  ['Contas a receber: títulos por título', () => financeiro.titulos({ ordem: 'titulo', limite: 5, pagina: 1 })],
  ['Clientes e crédito', () => financeiro.analiseClientes({})],
  ['Despachos (lista)', () => despachos.lista({})],
  ['Contas a pagar: pagamentos por pessoa', async () => {
    const lista = await pagar.pagamentos({ dias: 90 });
    const identificados = lista.filter((p) => p.usuario != null).length;
    console.log(`       ${lista.length} pagamentos em 90 dias, ${identificados} com a pessoa identificada`
      + ` (${lista.length ? Math.round((identificados / lista.length) * 100) : 0}%)`);
  }],
];

(async () => {
  let falhas = 0;
  for (const [nome, executar] of testes) {
    try {
      await executar();
      console.log(`OK     ${nome}`);
    } catch (erro) {
      falhas += 1;
      console.log(`ERRO   ${nome}: ${erro.message}`);
    }
  }
  console.log(falhas ? `\n${falhas} consulta(s) com erro.` : '\nTodas as consultas funcionaram.');
  process.exit(falhas ? 1 : 0);
})();
