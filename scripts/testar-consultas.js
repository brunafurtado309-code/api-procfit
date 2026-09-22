// Testa as consultas do financeiro no banco REAL, com o mesmo usuário da API (.env).
// Uso (na pasta do projeto): node scripts/testar-consultas.js
// Só lê dados. Mostra OK ou a mensagem de erro exata de cada consulta.

require('dotenv').config();
const financeiro = require('../src/repositories/financeiro.repository');
const pagar = require('../src/repositories/pagar.repository');
const despachos = require('../src/repositories/despachos.repository');
const admin = require('../src/repositories/admin.repository');
const servicoFinanceiro = require('../src/services/financeiro.service');

const testes = [
  ['Contas a pagar (tela)', () => pagar.painel({ situacao: 'aberto' })],
  ['Contas a pagar: enviados ao banco sem baixa', async () => {
    const { resumo } = await pagar.painel({ situacao: 'enviados' });
    console.log(`       ${resumo.enviado_titulos ?? 0} títulos enviados ao banco e sem baixa`
      + ` (R$ ${Number(resumo.enviado ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}),`
      + ` sendo R$ ${Number(resumo.vencido_enviado ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} já vencidos`);
  }],
  ['Contas a pagar: lista de fornecedores', () => pagar.fornecedores({})],
  ['Contas a pagar ordenado por vencimento', () => pagar.painel({ situacao: 'aberto', ordem: 'vencimento', direcao: 'desc' })],
  ['Contas a receber: títulos por vencimento', () => financeiro.titulos({ ordem: 'vencimento', limite: 5, pagina: 1 })],
  ['Contas a receber: títulos por nota', () => financeiro.titulos({ ordem: 'nota', limite: 5, pagina: 1 })],
  ['Contas a receber: títulos por título', () => financeiro.titulos({ ordem: 'titulo', limite: 5, pagina: 1 })],
  ['Clientes e crédito', () => financeiro.analiseClientes({})],
  ['Contas a receber: baixas por mês', () => financeiro.baixasPorMes({})],
  ['Excel dos recebimentos (gera a planilha de verdade)', async () => {
    const fim = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const { workbook, nomeArquivo } = await servicoFinanceiro.exportarRecebimentos({ inicio, fim });
    const buffer = await workbook.xlsx.writeBuffer();
    console.log(`       ${nomeArquivo} · ${Math.round(buffer.length / 1024)} KB`);
  }],
  ['Contas a receber: recebimentos (30 dias, todas as origens)', async () => {
    const fim = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const lista = await financeiro.recebimentos({ inicio, fim });
    const porOrigem = {};
    for (const r of lista) porOrigem[r.origem] = (porOrigem[r.origem] ?? 0) + 1;
    const semPessoa = lista.filter((r) => r.usuario == null).length;
    console.log(`       ${lista.length} baixas · ${Object.entries(porOrigem).map(([o, n]) => `${n} ${o}`).join(' · ')}`
      + `${semPessoa ? ` · ${semPessoa} sem pessoa identificada` : ''}`);
  }],
  ['Despachos (lista)', () => despachos.lista({})],
  ['Administrativo: recebimentos detalhados (30 dias)', async () => {
    const fim = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const lista = await admin.recebimentos({ inicio, fim });
    const comNota = lista.filter((r) => r.nota != null).length;
    console.log(`       ${lista.length} títulos recebidos, ${comNota} com nota fiscal ligada`);
  }],
  ['Administrativo: usuários e atividade (30 dias)', async () => {
    const fim = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const { usuarios } = await admin.usuarios({ inicio, fim });
    const usaram = usuarios.filter((u) => Number(u.acoes) > 0);
    console.log(`       ${usuarios.length} usuários cadastrados, ${usaram.length} com ações em 30 dias`
      + ` (${usuarios.reduce((t, u) => t + Number(u.acoes || 0), 0)} ações no total)`);
  }],
  ['Caixa: entradas (recebimentos e retornos de despacho)', async () => {
    const fim = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const lista = await pagar.entradasCaixa({ inicio, fim });
    const porOrigem = {};
    for (const e of lista) porOrigem[e.origem] = (porOrigem[e.origem] ?? 0) + 1;
    console.log(`       30 dias: ${Object.entries(porOrigem).map(([o, n]) => `${n} ${o}`).join(' · ') || 'nenhuma entrada'}`);
  }],
  ['Contas a pagar: pessoas que cuidam de caixa', async () => {
    const pessoas = await pagar.pessoasPagamento();
    console.log(`       ${pessoas.map((p) => `${p.usuario} ${p.usuario_nome ?? ''}`.trim()).join(' | ') || 'nenhuma'}`);
  }],
  ['Contas a pagar: pagamentos por pessoa', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const lista = await pagar.pagamentos({ inicio, fim: hoje });
    const identificados = lista.filter((p) => p.usuario != null).length;
    const semBaixa = lista.filter((p) => Number(p.aguardando_baixa) === 1);
    console.log(`       ${semBaixa.length} enviados ao banco e ainda sem baixa`
      + ` (R$ ${semBaixa.reduce((t, p) => t + (Number(p.valor) || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`);
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
