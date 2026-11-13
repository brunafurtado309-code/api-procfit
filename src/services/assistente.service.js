// Assistente do painel (nov/2026): um chat que tira dúvidas sobre QUALQUER tela —
// de onde vem cada número, qual é a conta e qual é a linha de raciocínio.
//
// Como ele sabe as regras: na primeira pergunta, junta os comentários do começo de cada arquivo de
// services/ e repositories/ (é ali que as regras conferidas no banco estão escritas) e a lista de
// rotas da API. Assim o assistente se atualiza sozinho quando o código muda: regra nova = comentário novo.
//
// Como ele vê os números: tem três ferramentas, todas SÓ DE LEITURA:
//   consultar_api      chama as rotas GET da própria API com o login de quem perguntou
//                      (cada pessoa só vê os dados das telas liberadas para ela)
//   ler_codigo         lê um arquivo do código (services, repositories, controllers, routes, telas)
//   procurar_no_codigo procura uma palavra no código (ex.: "preco_minimo")
// A tela aberta também vai junto: endereço, loja escolhida e o texto que está aparecendo.
//
// IA: Claude, da Anthropic, pela chave ANTHROPIC_API_KEY (no Render/.env). Sem a chave, o chat não
// liga, mas o botão "Como esta tela calcula" continua mostrando as regras da tela (sem custo).
// Os números enviados para responder vão para a Anthropic (decidido com a Bruna em nov/2026).
//
// NOME (nov/2026): para quem usa, o assistente tem nome próprio (ASSISTENTE_NOME no Render; padrão "Bel")
// e não fala da tecnologia por trás. As mensagens de erro que aparecem na tela também não citam a IA
// nem o fornecedor (o detalhe fica só no registro do servidor). Se perguntarem, ele diz que é um
// assistente virtual do painel — nunca finge ser uma pessoa.

const fs = require('fs');
const path = require('path');
const AppError = require('../utils/AppError');

const RAIZ = path.join(__dirname, '..'); // pasta src
const MODELO = () => process.env.ASSISTENTE_MODELO || 'claude-sonnet-5-5';
const MAX_VOLTAS = 8;             // quantas vezes ele pode usar ferramentas numa mesma pergunta
const MAX_RESPOSTA_API = 30000;   // caracteres do resultado de uma consulta que vão para a IA
const MAX_LINHAS_CODIGO = 300;    // linhas por leitura de arquivo
const MAX_TEXTO_TELA = 8000;      // caracteres do que está aparecendo na tela
const MAX_HISTORICO = 12;         // mensagens anteriores da conversa
const PASTAS_DE_CODIGO = ['services', 'repositories', 'controllers', 'routes', 'sql', 'middlewares', 'public/js', 'public'];

const iaLigada = () => Boolean(process.env.ANTHROPIC_API_KEY);
const nomeDoAssistente = () => String(process.env.ASSISTENTE_NOME || 'Bel').trim().slice(0, 30) || 'Bel';

// ---------- Conhecimento: regras escritas no código ----------

// Comentário do começo do arquivo (linhas que começam com //)
function comentarioInicial(texto) {
  const linhas = [];
  for (const linha of texto.split('\n')) {
    const t = linha.trim();
    if (t.startsWith('//')) linhas.push(t.replace(/^\/\/ ?/, ''));
    else if (t === '' && linhas.length === 0) continue;
    else break;
  }
  return linhas.join('\n').trim();
}

function arquivosDe(pasta, extensoes) {
  const dir = path.join(RAIZ, pasta);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => extensoes.some((e) => n.endsWith(e)))
    .sort()
    .map((n) => `${pasta}/${n}`);
}

// Rotas montadas no server.js: '/vendas' -> { arquivo: 'routes/vendas.routes.js', setor: 'vendas' }
function montagens() {
  const server = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const requires = {};
  for (const m of server.matchAll(/const (\w+) = require\('\.\/routes\/([\w.-]+)'\)/g)) requires[m[1]] = `routes/${m[2]}.js`;
  const lista = [];
  for (const m of server.matchAll(/app\.use\('([^']+)',\s*(?:exigirChave\((?:'([^']*)')?\)|exigirMestra\(\)),\s*(\w+)\)/g)) {
    if (requires[m[3]]) lista.push({ prefixo: m[1], setor: m[2] || null, arquivo: requires[m[3]] });
  }
  return lista;
}

// Lista das rotas GET (as que o assistente pode consultar), com o comentário da linha
function catalogoDeRotas() {
  const linhas = [];
  for (const { prefixo, setor, arquivo } of montagens()) {
    if (prefixo === '/usuarios') continue;
    const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    for (const m of texto.matchAll(/router\.get\('([^']*)'[^\n]*?(?:\/\/\s*(.*))?$/gm)) {
      if (/excel/i.test(m[1])) continue;
      const rota = (prefixo + (m[1] === '/' ? '' : m[1])).replace(/\/+$/, '') || prefixo;
      linhas.push(`GET ${rota}  [tela: ${setor || 'qualquer'}]${m[2] ? `  — ${m[2].trim()}` : ''}`);
    }
  }
  return linhas.join('\n');
}

let conhecimento = null;
function montarConhecimento() {
  if (conhecimento) return conhecimento;
  const partes = [];
  for (const arquivo of [...arquivosDe('repositories', ['.js']), ...arquivosDe('services', ['.js'])]) {
    if (/usuarios|assistente/.test(arquivo)) continue; // a auditoria entra (as regras dos alertas)
    const c = comentarioInicial(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
    if (c.length > 80) partes.push(`### ${arquivo}\n${c}`);
  }
  conhecimento = {
    regras: partes.join('\n\n'),
    rotas: catalogoDeRotas(),
  };
  return conhecimento;
}

// ---------- Ajuda sem IA: as regras da tela aberta ----------

// Tela -> arquivos com as regras dela
const ARQUIVOS_DA_TELA = {
  'index.html': ['vendas', 'vendas-vendedores', 'faturamento-vendedores'],
  'financeiro.html': ['financeiro', 'pagar', 'despachos', 'clientes-credito', 'pedidos'],
  'recebimentos.html': ['financeiro'],
  'pagar.html': ['pagar'],
  'despachos.html': ['despachos'],
  'clientes.html': ['clientes-credito', 'financeiro'],
  'conciliacao.html': ['conciliacao', 'extratos'],
  'faturamento.html': ['faturamento', 'pedidos'],
  'faturamento-vendedores.html': ['faturamento-vendedores'],
  'faturamento-canceladas.html': ['notas-canceladas'],
  'logistica.html': ['logistica'],
  'logistica-transferencias.html': ['transferencias'],
  'logistica-notas.html': ['notas-entrada'],
  'precificacao.html': ['precificacao-analise', 'precificacao', 'classificacao'],
  'precos.html': ['precos'],
  'movimentos.html': ['movimentos'],
  'admin.html': ['admin'],
};

function ajudaDaTela(tela) {
  const pagina = String(tela || '').split('/').pop().split(/[?#]/)[0] || 'inicio.html';
  const nomes = ARQUIVOS_DA_TELA[pagina] || [];
  const secoes = [];
  for (const nome of nomes) {
    for (const pasta of ['repositories', 'services']) {
      const arquivo = path.join(RAIZ, pasta, `${nome}.${pasta === 'services' ? 'service' : 'repository'}.js`);
      if (!fs.existsSync(arquivo)) continue;
      const texto = comentarioInicial(fs.readFileSync(arquivo, 'utf8'));
      if (texto.length > 80) secoes.push({ titulo: `${nome} (${pasta === 'services' ? 'contas' : 'de onde vêm os dados'})`, texto });
    }
  }
  return { ia: iaLigada(), nome: nomeDoAssistente(), tela: pagina, secoes };
}

// ---------- Ferramentas ----------

const FERRAMENTAS = [
  {
    name: 'consultar_api',
    description: 'Chama uma rota GET da API do painel (os mesmos dados que as telas mostram), com o acesso de quem perguntou. '
      + 'Use para buscar os números reais antes de explicar uma conta. Passe o caminho com os filtros, ex.: '
      + '/precificacao/analise/produto/10059 ou /vendas/por-vendedor?inicio=2026-11-01&fim=2026-11-13&empresa=3. '
      + 'Para saber quais filtros uma rota aceita, leia o controller/service dela com ler_codigo.',
    input_schema: {
      type: 'object',
      properties: { caminho: { type: 'string', description: 'Caminho começando com /, com os filtros na URL' } },
      required: ['caminho'],
    },
  },
  {
    name: 'ler_codigo',
    description: 'Lê um arquivo do código do painel para conferir uma regra ou uma conta exatamente como está feita. '
      + 'Pastas: services, repositories, controllers, routes, sql, middlewares, public/js, public. '
      + `Devolve no máximo ${MAX_LINHAS_CODIGO} linhas por vez (use de_linha para continuar).`,
    input_schema: {
      type: 'object',
      properties: {
        arquivo: { type: 'string', description: 'Ex.: services/precificacao-analise.service.js' },
        de_linha: { type: 'integer', description: 'Primeira linha (começa em 1)' },
      },
      required: ['arquivo'],
    },
  },
  {
    name: 'procurar_no_codigo',
    description: 'Procura uma palavra ou trecho em todo o código do painel e devolve arquivo:linha de cada ocorrência '
      + '(até 40). Use para achar onde um campo ou uma conta é feita (ex.: "preco_minimo", "IMPOSTOS").',
    input_schema: {
      type: 'object',
      properties: { termo: { type: 'string' } },
      required: ['termo'],
    },
  },
];

// Caminho seguro dentro de src, só nas pastas liberadas e nunca a configuração (conexões)
function arquivoPermitido(relativo) {
  const limpo = String(relativo || '').replace(/^\/+/, '').replace(/^src\//, '');
  const absoluto = path.resolve(RAIZ, limpo);
  if (!absoluto.startsWith(RAIZ + path.sep)) return null;
  const rel = path.relative(RAIZ, absoluto).split(path.sep).join('/');
  const pasta = PASTAS_DE_CODIGO.find((p) => rel.startsWith(p + '/'));
  if (!pasta || rel.startsWith('config/') || /assistente/.test(rel) || !/\.(js|sql|html)$/.test(rel)) return null;
  if (pasta === 'public' && rel.split('/').length > 2) return null; // public/*.html; o resto só em public/js
  return fs.existsSync(absoluto) ? absoluto : null;
}

function lerCodigo({ arquivo, de_linha }) {
  const absoluto = arquivoPermitido(arquivo);
  if (!absoluto) return `Arquivo não encontrado ou fora das pastas liberadas: ${arquivo}`;
  const linhas = fs.readFileSync(absoluto, 'utf8').split('\n');
  const inicio = Math.max(1, Number(de_linha) || 1);
  const fim = Math.min(linhas.length, inicio + MAX_LINHAS_CODIGO - 1);
  const trecho = linhas.slice(inicio - 1, fim).map((l, i) => `${inicio + i}: ${l}`).join('\n');
  return `${arquivo} (linhas ${inicio}-${fim} de ${linhas.length})\n${trecho}`;
}

function todosOsArquivos() {
  const lista = [];
  for (const pasta of PASTAS_DE_CODIGO) {
    for (const rel of arquivosDe(pasta, ['.js', '.sql', '.html'])) if (arquivoPermitido(rel) && !/assistente/.test(rel)) lista.push(rel);
  }
  return lista;
}

function procurarNoCodigo({ termo }) {
  const t = String(termo || '').trim().toLowerCase();
  if (t.length < 3) return 'Informe pelo menos 3 letras.';
  const achados = [];
  for (const rel of todosOsArquivos()) {
    const linhas = fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n');
    linhas.forEach((l, i) => {
      if (achados.length < 40 && l.toLowerCase().includes(t)) achados.push(`${rel}:${i + 1}: ${l.trim().slice(0, 160)}`);
    });
    if (achados.length >= 40) break;
  }
  return achados.length ? achados.join('\n') : `Nada encontrado para "${termo}".`;
}

// Resultado grande: listas cortadas em 40 itens (com o total), e o texto todo limitado
function enxugar(valor, profundidade = 0) {
  if (Array.isArray(valor)) {
    const itens = valor.slice(0, 40).map((v) => enxugar(v, profundidade + 1));
    if (valor.length > 40) itens.push(`… mais ${valor.length - 40} itens (total ${valor.length}); use filtros para ver outros`);
    return itens;
  }
  if (valor && typeof valor === 'object' && profundidade < 8) {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = enxugar(v, profundidade + 1);
    return saida;
  }
  return valor;
}

async function consultarApi({ caminho }, credencial) {
  const c = String(caminho || '').trim();
  if (!c.startsWith('/') || c.startsWith('//')) return 'O caminho precisa começar com /.';
  if (/^\/(auth|usuarios|painel)\b/.test(c) || /excel/i.test(c)) return 'Essa rota não pode ser consultada pelo assistente.';
  const porta = process.env.PORT || 3000;
  try {
    const resposta = await fetch(`http://127.0.0.1:${porta}${c}`, {
      headers: { 'x-api-key': credencial },
      signal: AbortSignal.timeout(60000),
    });
    const texto = await resposta.text();
    let corpo;
    try { corpo = JSON.parse(texto); } catch (_) { corpo = texto.slice(0, 500); }
    if (!resposta.ok) return `Erro ${resposta.status}: ${typeof corpo === 'object' ? corpo.erro || JSON.stringify(corpo) : corpo}`;
    const json = JSON.stringify(enxugar(corpo));
    return json.length > MAX_RESPOSTA_API
      ? `${json.slice(0, MAX_RESPOSTA_API)}\n… (resultado cortado: ${json.length} caracteres; use filtros mais específicos)`
      : json;
  } catch (err) {
    return `Não foi possível consultar ${c}: ${err.message}`;
  }
}

async function usarFerramenta(nome, entrada, credencial) {
  if (nome === 'consultar_api') return consultarApi(entrada, credencial);
  if (nome === 'ler_codigo') return lerCodigo(entrada);
  if (nome === 'procurar_no_codigo') return procurarNoCodigo(entrada);
  return `Ferramenta desconhecida: ${nome}`;
}

// ---------- Conversa ----------

function instrucoes() {
  const { regras, rotas } = montarConhecimento();
  const nome = nomeDoAssistente();
  return `Você é ${nome}, a assistente virtual do Painel de gestão da Belo Norte (distribuidora de açaí e alimentos, Fortaleza/CE).
O painel é uma API própria que lê o banco do sistema PROCFIT (SQL Server, só leitura) e mostra telas de Vendas,
Financeiro, Faturamento, Logística, Precificação, Tabela de preços, Entradas e saídas e Administrativo.

Seu trabalho: tirar dúvidas de quem usa o painel sobre como cada número é calculado, de onde ele vem
(qual tabela do PROCFIT) e qual é a linha de raciocínio de cada tela — por exemplo, por que duas telas mostram
valores diferentes, como sai o preço sugerido, o que é uma porcentagem ou uma etiqueta.

Sua identidade:
- Seu nome é ${nome}. Apresente-se assim quando fizer sentido.
- Não cite o nome do modelo de IA, da empresa que o fornece nem de qualquer tecnologia por trás de você.
  Se perguntarem qual IA você é, quem te fez ou como você funciona, diga que é ${nome}, a assistente virtual
  do painel da Belo Norte, e que os detalhes técnicos ficam com a equipe de TI.
- Se perguntarem se você é uma pessoa, diga com sinceridade que é uma assistente virtual.

Como responder:
- Português do Brasil, simples e direto, para quem não é programador. Comece pela resposta; depois explique.
- Mostre a conta passo a passo com os números reais (ex.: R$ 86,30 ÷ (1 − 0,2925) = R$ 121,98).
- Antes de afirmar uma regra, apoie-se no conhecimento abaixo e, se faltar detalhe, LEIA O CÓDIGO com as ferramentas.
  Não invente regra nem número. Se não der para saber, diga o que falta.
- Quando a pergunta for sobre um produto, cliente, vendedor ou valor da tela, busque os números com consultar_api.
  Use a loja e o período da tela aberta quando fizer sentido.
- Respostas curtas: parágrafos curtos e listas com "- ". Use **negrito** só no essencial. Não use tabelas nem títulos.
- Não fale de nomes de arquivos, rotas ou código, a não ser que a pessoa peça; fale de telas, colunas e do PROCFIT.
- Você só lê: não altera nada no sistema. Se pedirem para mudar algo, explique onde a pessoa faz isso.
- Se a pessoa não tiver acesso a uma tela (erro 403), diga que essa tela não está liberada para ela.
- AUDITORIA: você também é auditora. Ao responder, confira se os números batem entre si (soma das partes = total,
  a mesma informação igual em telas diferentes, preço x custo, pedido x nota x título). Se algo divergir, diga
  claramente no começo da resposta: o que está diferente, quanto, onde conferir e o que provavelmente causou.
  Nunca esconda uma divergência para a resposta ficar mais simples.
- Os alertas de divergência encontrados sozinhos a cada hora estão em /auditoria (só a conta principal vê).
  Quando perguntarem sobre um alerta, explique a regra que o acendeu, os números e o que fazer para resolver.

== REGRAS DO PAINEL (escritas no código, conferidas no banco) ==
${regras}

== ROTAS QUE VOCÊ PODE CONSULTAR (consultar_api) ==
${rotas}`;
}

function contextoDaTela(tela, quem) {
  const t = tela || {};
  const visivel = String(t.texto || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, MAX_TEXTO_TELA);
  return [
    `Quem pergunta: ${quem.nome || 'usuário do painel'}. Telas liberadas: ${(quem.setores || []).join(', ') || 'nenhuma'}.`,
    `Hoje: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}.`,
    `Tela aberta: ${t.titulo || '?'} (${t.endereco || '?'}).`,
    `Loja escolhida no menu: ${t.loja ? `${t.lojaNome || ''} (código ${t.loja})` : 'todas as lojas'}.`,
    t.selecao ? `Trecho que a pessoa marcou na tela: "${String(t.selecao).slice(0, 1000)}"` : '',
    visivel ? `O que está aparecendo na tela agora (texto):\n"""\n${visivel}\n"""` : '',
  ].filter(Boolean).join('\n');
}

async function chamarClaude(mensagens) {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELO(),
      max_tokens: 2000,
      // As regras são grandes e iguais em toda pergunta: ficam guardadas (cache) e custam menos
      system: [{ type: 'text', text: instrucoes(), cache_control: { type: 'ephemeral' } }],
      tools: FERRAMENTAS,
      messages: mensagens,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    // O detalhe (chave errada, sem crédito...) fica só no registro do servidor (Render > Logs)
    console.error('Assistente: erro da Anthropic', resposta.status, corpo?.error?.message);
    if (resposta.status === 429) throw new AppError('Muitas perguntas ao mesmo tempo. Espere um minuto e tente de novo.', 429);
    if (resposta.status === 401 || resposta.status === 403 || /credit/i.test(corpo?.error?.message || '')) {
      throw new AppError('O assistente está indisponível agora. Avise a equipe de TI.', 503);
    }
    throw new AppError('O assistente não respondeu agora. Tente de novo em instantes.', 502);
  }
  return corpo;
}

// pergunta: texto; historico: [{ papel: 'pessoa'|'assistente', texto }]; tela: contexto da tela aberta
async function perguntar({ pergunta, historico, tela }, quem, credencial) {
  if (!iaLigada()) throw new AppError('O chat ainda não foi ligado. Veja as regras da tela em "Como esta tela calcula".', 503);
  pergunta = String(pergunta || '').trim();
  if (pergunta.length < 2) throw new AppError('Escreva a sua dúvida.');
  if (pergunta.length > 2000) throw new AppError('A pergunta pode ter no máximo 2.000 caracteres.');

  const anteriores = (Array.isArray(historico) ? historico : [])
    .slice(-MAX_HISTORICO)
    .filter((m) => m && typeof m.texto === 'string' && m.texto.trim())
    .map((m) => ({ role: m.papel === 'assistente' ? 'assistant' : 'user', content: m.texto.slice(0, 4000) }));
  // A conversa precisa começar com a pessoa e alternar os papéis
  while (anteriores.length && anteriores[0].role !== 'user') anteriores.shift();
  const mensagens = [];
  for (const m of anteriores) {
    if (mensagens.length && mensagens[mensagens.length - 1].role === m.role) mensagens[mensagens.length - 1].content += `\n\n${m.content}`;
    else mensagens.push(m);
  }
  if (mensagens.length && mensagens[mensagens.length - 1].role === 'user') mensagens.pop();
  mensagens.push({ role: 'user', content: `${contextoDaTela(tela, quem)}\n\nPergunta: ${pergunta}` });

  const consultas = [];
  for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
    const r = await chamarClaude(mensagens);
    mensagens.push({ role: 'assistant', content: r.content });
    const pedidos = (r.content || []).filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !pedidos.length) {
      const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { resposta: texto || 'Não consegui montar uma resposta. Tente perguntar de outro jeito.', consultas };
    }
    const resultados = [];
    for (const p of pedidos) {
      consultas.push(p.name === 'consultar_api' ? 'consultou os dados da tela' : 'conferiu a regra no código');
      resultados.push({ type: 'tool_result', tool_use_id: p.id, content: String(await usarFerramenta(p.name, p.input || {}, credencial)) });
    }
    mensagens.push({ role: 'user', content: resultados });
  }
  return {
    resposta: 'A pergunta precisou de muitas consultas e eu parei para não demorar demais. Tente uma pergunta mais específica (um produto, um vendedor, uma coluna).',
    consultas,
  };
}

module.exports = { perguntar, ajudaDaTela, iaLigada, _interno: { montarConhecimento, lerCodigo, procurarNoCodigo, arquivoPermitido, montagens } };
