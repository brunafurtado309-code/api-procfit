/* =========================================================================
   TELA DE CONCILIAÇÃO — api-procfit (src/public/js/conciliacao.js)
   Objetivo: sanear a carteira. Cada título/pedido termina com um destino:
   está certo, falta baixar, corrigir forma, investigar, cobrar ou cancelar.
   ========================================================================= */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dt = d => d ? d.toLocaleDateString('pt-BR') : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const DIA = 86400000;

  // arquivos: [{ nome, origem, entradas }] — vários extratos (uma conta cada) e o arquivo da Rede
  const estado = { titulos: [], entradas: [], arquivos: [], pedidosBanco: null, resultado: null, aba: 'faltaBaixar', fonte: 'api' };

  /* =====================================================================
     ACESSO — usa a mesma chave do painel.
     A tela descobre sozinha como a API espera receber a chave,
     testando na rota /acessos (que já existe no server.js).
     ===================================================================== */
  const MODOS = [
    { header: 'x-api-key' }, { header: 'x-chave' }, { header: 'x-chave-acesso' }, { header: 'x-access-key' },
    { header: 'chave' }, { header: 'Authorization', prefixo: 'Bearer ' }, { header: 'Authorization', prefixo: '' },
    { query: 'chave' }, { query: 'key' }, { query: 'token' }
  ];
  const Acesso = { chave: null, modo: null };
  const CHAVE_SESSAO = 'conciliacao:acesso';

  function montar(caminho, modo, chave) {
    const opcoes = { headers: {} };
    let url = caminho;
    if (modo.header) opcoes.headers[modo.header] = (modo.prefixo || '') + chave;
    else url += (url.includes('?') ? '&' : '?') + modo.query + '=' + encodeURIComponent(chave);
    return { url, opcoes };
  }
  async function testarChave(chave) {
    for (let i = 0; i < MODOS.length; i++) {
      try {
        const { url, opcoes } = montar('/acessos', MODOS[i], chave);
        const r = await fetch(url, opcoes);
        if (r.ok) return i;
      } catch (e) { /* tenta o próximo */ }
    }
    return null;
  }
  // Procura a chave que o painel já guardou no navegador
  function chavesGuardadas() {
    const achadas = [];
    for (const st of [sessionStorage, localStorage]) {
      try {
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i);
          if (!/chave|token|acesso|senha|key/i.test(k) || k === CHAVE_SESSAO) continue;
          let v = st.getItem(k);
          try {
            const j = JSON.parse(v);
            if (typeof j === 'string') v = j;
            else if (j && typeof j === 'object') v = j.chave || j.token || j.key || null;
          } catch (e) { /* não é JSON */ }
          if (typeof v === 'string' && v && v.length < 300 && !/\s/.test(v)) achadas.push(v);
        }
      } catch (e) { /* storage indisponível */ }
    }
    return [...new Set(achadas)];
  }
  function guardarAcesso() { try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(Acesso)); } catch (e) {} }
  function lerAcesso() { try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)); } catch (e) { return null; } }

  async function api(caminho) {
    const { url, opcoes } = montar(caminho, MODOS[Acesso.modo], Acesso.chave);
    const r = await fetch(url, opcoes);
    if (r.status === 401 || r.status === 403) {
      const semPermissao = r.status === 403;
      try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) {}
      mostrarEntrada(semPermissao ? 'Essa chave não abre o setor financeiro. Use a chave do financeiro.' : 'A chave não foi aceita. Entre de novo.');
      throw new Error('acesso');
    }
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(dados.erro || dados.mensagem || 'Erro ' + r.status); e.status = r.status; throw e; }
    return dados;
  }

  // POST ou DELETE com a mesma chave de acesso
  async function apiEnviar(caminho, metodo, corpo) {
    const { url, opcoes } = montar(caminho, MODOS[Acesso.modo], Acesso.chave);
    const r = await fetch(url, {
      ...opcoes, method: metodo,
      headers: { ...opcoes.headers, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || dados.mensagem || 'Erro ' + r.status);
    return dados;
  }

  function mostrarEntrada(msg) {
    $('entrada').hidden = false; $('conteudo').hidden = true; $('controles').hidden = true;
    $('avisoEntrada').innerHTML = msg ? `<p class="aviso erro">${esc(msg)}</p>` : '';
    $('chave').focus();
  }
  function mostrarTela() {
    $('entrada').hidden = true; $('conteudo').hidden = false; $('controles').hidden = false;
  }

  async function iniciarAcesso() {
    const salvo = lerAcesso();
    if (salvo && salvo.chave && salvo.modo != null) { Object.assign(Acesso, salvo); return true; }
    for (const chave of chavesGuardadas()) {
      const modo = await testarChave(chave);
      if (modo != null) { Acesso.chave = chave; Acesso.modo = modo; guardarAcesso(); return true; }
    }
    return false;
  }

  /* ---------------- situações ---------------- */
  const STATUS = {
    conciliado: ['Conciliado', 's-ok'],
    diferenca: ['Conciliado com diferença', 's-sug'],
    sem_baixa: ['Entrou no banco, falta baixar', 's-sug'],
    sugerido: ['Para confirmar', 's-sug'],
    baixado_sem_entrada: ['Baixado sem dinheiro no arquivo', 's-ruim'],
    vencido: ['Em aberto — vencido', 's-ruim'],
    a_vencer: ['Em aberto — a vencer', 's-neutro'],
    caixa_interno: ['Baixado no caixa interno', 's-neutro'],
    outro_arquivo: ['Conferir no outro arquivo', 's-neutro'],
    pago_outro_mes: ['Pago em outro mês', 's-neutro'],
    sem_titulo: ['Entrada sem título', 's-ruim'],
    venda_sem_titulo: ['Venda de balcão (sem título)', 's-neutro'],
    agrupado: ['Somado no dia', 's-neutro']
  };
  const DECISOES = ['', 'Cobrar', 'Cancelar', 'Baixar', 'Corrigir forma', 'Investigar', 'Aguardando'];

  /* ---------------- leitura de datas e valores ---------------- */
  function lerData(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * DIA)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], m[2] - 1, +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], m[2] - 1, +m[3]);
    return null;
  }
  function lerValor(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    let s = String(v).replace(/R\$|\s/g, '');
    const neg = /^-|\(.*\)|D$/i.test(s);
    s = s.replace(/[^\d,.]/g, '');
    const v1 = s.lastIndexOf(','), p1 = s.lastIndexOf('.');
    if (v1 >= 0 && p1 >= 0) {                       // tem os dois: o último é o separador dos centavos
      s = v1 > p1 ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (v1 >= 0) {                           // só vírgula: 1.234 nunca, então é centavos (ou milhar tipo 4,480)
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (p1 >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) { // só ponto em formato de milhar: 1.234
      s = s.replace(/\./g, '');
    }
    const n = Math.abs(parseFloat(s) || 0);
    return neg ? -n : n;
  }

  /* ---------------- leitura de planilhas ---------------- */
  function lerPlanilha(arquivo) {
    return arquivo.arrayBuffer().then(buf => {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // O extrato do Itaú vem dizendo que vai só até a linha 13, mas continua até o fim do mês.
      // Aqui medimos o tamanho real, olhando a última célula preenchida.
      let maxL = 0, maxC = 0;
      for (const k in ws) {
        if (k[0] === '!') continue;
        const c = XLSX.utils.decode_cell(k);
        if (c.r > maxL) maxL = c.r; if (c.c > maxC) maxC = c.c;
      }
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxL, c: maxC } });
      return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    });
  }
  function acharCabecalho(linhas, testes) {
    for (let i = 0; i < Math.min(linhas.length, 40); i++) {
      const cab = linhas[i].map(norm);
      if (testes.every(re => cab.some(c => re.test(c)))) return i;
    }
    return -1;
  }
  function coluna(cab, ...padroes) {
    for (const re of padroes) { const i = cab.findIndex(c => re.test(c)); if (i >= 0) return i; }
    return -1;
  }

  // Conta bancária escrita no topo do arquivo (ex.: "Conta: 0099105-9"), para não somar a mesma conta duas vezes
  function lerConta(linhas) {
    for (const l of linhas.slice(0, 15)) {
      if (/^conta:?$/.test(norm(l[0]))) { const c = String(l[1] || '').replace(/\D/g, '').replace(/^0+/, ''); if (c) return c; }
    }
    return '';
  }

  // Lançamentos do extrato que chegam SOMADOS no dia (vários pagamentos num valor só).
  // Não dá para casar com um título sozinho: o detalhe vem do relatório de boletos ou da Rede.
  function agrupadoDoExtrato(desc, nome, doc) {
    const d = norm(desc);
    if (/boletos? recebidos?|recebimento rede|pix qrs|^recebimentos?$|cielo|stone|getnet/.test(d)) return true;
    return !String(nome || '').trim() && !String(doc || '').trim();   // sem nome e sem CPF/CNPJ: é lançamento agrupado
  }

  function lerArquivoPagamentos(linhas, tipoEscolhido, nomeArquivo) {
    const i = acharCabecalho(linhas, [/data/, /valor/]);
    if (i < 0) throw new Error('Não achei as colunas de data e valor no arquivo. Confira se é o extrato do banco, o relatório de boletos ou o da Rede.');
    const cab = linhas[i].map(norm);
    const pareceBoletos = cab.some(c => /nosso numero/.test(c)) && cab.some(c => /valor pago/.test(c));
    const pareceRede = cab.some(c => /nsu|autoriza|bandeira|adquirente/.test(c));
    const origem = tipoEscolhido !== 'auto' ? tipoEscolhido : pareceBoletos ? 'boletos' : pareceRede ? 'rede' : 'banco';

    const c = origem === 'rede' ? {
      data: coluna(cab, /data.*(pagamento|credito|recebimento|prevista)/, /data da venda/, /^data/),
      valor: coluna(cab, /valor.*bruto/, /valor da venda atualizado/, /valor.*(parcela|venda)/, /^valor/),
      nome: -1, doc: -1,
      desc: coluna(cab, /bandeira/),
      modalidade: coluna(cab, /^modalidade/),
      status: coluna(cab, /status/),
      chave: coluna(cab, /nsu/, /autoriza/, /^cv/)
    } : origem === 'boletos' ? {
      data: coluna(cab, /data pagamento/, /data (de )?credito/),
      valor: coluna(cab, /valor pago/),
      nome: coluna(cab, /^pagador/),
      doc: coluna(cab, /cpf|cnpj/),
      desc: coluna(cab, /seu numero/),
      status: coluna(cab, /status|situacao/),
      chave: coluna(cab, /nosso numero/)
    } : {
      data: coluna(cab, /^data/),
      valor: coluna(cab, /^valor/),
      nome: coluna(cab, /razao|favorecido|pagador|^nome/),
      doc: coluna(cab, /cpf|cnpj/),
      desc: coluna(cab, /lancamento|historico|descricao/),
      chave: coluna(cab, /documento|nosso/)
    };
    const txt = (l, j) => j >= 0 ? String(l[j] == null ? '' : l[j]).trim() : '';

    const entradas = []; const vistos = {}; let ignoradas = 0;
    for (const l of linhas.slice(i + 1)) {
      const data = lerData(l[c.data]); const valor = lerValor(l[c.valor]);
      if (!data || !(valor > 0)) continue;                                          // só créditos
      let desc = txt(l, c.desc);
      if (origem === 'banco' && /saldo|aplic|rend|resgate|s a l d o/.test(norm(desc))) continue; // ruído do extrato
      if (origem === 'rede' && c.status >= 0 && !/aprovad|pago|paga/.test(norm(txt(l, c.status)))) { ignoradas++; continue; } // negada, expirada, desfeita...
      if (origem === 'boletos' && c.status >= 0 && !/paga|pago|liquidad/.test(norm(txt(l, c.status)))) { ignoradas++; continue; } // boleto não pago
      const nome = txt(l, c.nome), doc = txt(l, c.doc), chave = txt(l, c.chave);
      const pix = origem === 'rede' && /pix/.test(norm(txt(l, c.modalidade)));
      if (origem === 'rede') desc = [pix ? 'PIX' : '', desc].filter(Boolean).join(' ');
      if (origem === 'boletos') desc = 'Boleto' + (desc ? ' ' + desc : '');
      const base = `${data.toISOString().slice(0, 10)}|${valor.toFixed(2)}|${desc}|${doc}|${chave}`;
      vistos[base] = (vistos[base] || 0) + 1;
      entradas.push({
        id: nomeArquivo + '|' + base + '|' + vistos[base], arquivo: nomeArquivo, data, valor, desc, doc, nome, chave, origem, pix,
        agrupado: origem === 'banco' && agrupadoDoExtrato(desc, nome, doc)
      });
    }
    return { entradas, origem, conta: lerConta(linhas), ignoradas };
  }

  function montarTitulo(r) {
    const g = k => r[k] !== undefined ? r[k] : r[k.toUpperCase()];
    const valor = lerValor(g('valor')); const pago = lerValor(g('valor_pago'));
    const nf = g('nota_fiscal'); const nfTxt = nf == null ? '' : String(nf).trim();
    // O banco já manda o pendente (com juros e descontos) e se o título é faturado; a planilha pode não mandar
    const pendenteBanco = g('pendente');
    const pendente = pendenteBanco != null && pendenteBanco !== '' ? Math.max(0, lerValor(pendenteBanco)) : Math.max(0, valor - pago);
    const faturadoBanco = g('faturado');
    const faturado = faturadoBanco != null && faturadoBanco !== '' ? (faturadoBanco === true || Number(faturadoBanco) === 1) : !!(nfTxt && nfTxt !== '0');
    return {
      id: g('id_titulo'), pedido: g('pedido') ?? '', nf: nfTxt, parcela: g('parcela') ?? '', origem: g('origem') ?? '',
      cod: g('cod_cliente') ?? '', nome: g('nome_cliente') ?? '', doc: g('cpf_cnpj') ?? '',
      venc: lerData(g('vencimento')), valor, pago, pendente: Math.round(pendente * 100) / 100,
      dtPag: lerData(g('data_pagamento')), conta: g('conta_caixa') ?? '', forma: g('forma_pagamento') ?? '',
      nossoNumero: g('nosso_numero') ?? '', nsu: g('nsu') ?? '', faturado
    };
  }
  function lerPlanilhaTitulos(linhas) {
    const i = acharCabecalho(linhas, [/^id_titulo$/, /^vencimento$/]);
    if (i < 0) throw new Error('A planilha de títulos precisa ter as mesmas colunas da consulta (id_titulo, pedido, nota_fiscal, vencimento, valor...).');
    const cab = linhas[i].map(norm);
    return linhas.slice(i + 1).filter(l => l.some(v => v !== '')).map(l => {
      const r = {}; cab.forEach((k, j) => r[k] = l[j]); return montarTitulo(r);
    }).filter(t => t.venc);
  }

  /* ---------------- decisões e confirmações (salvas no navegador) ---------------- */
  const chaveMes = () => 'conciliacao:' + $('mes').value;
  function lerDecisoesMes() { try { return JSON.parse(localStorage.getItem(chaveMes())) || { confirmados: {}, rejeitados: [] }; } catch (e) { return { confirmados: {}, rejeitados: [] }; } }
  function salvarDecisoesMes(d) { try { localStorage.setItem(chaveMes(), JSON.stringify(d)); } catch (e) {} }
  function lerDestinos() { try { return JSON.parse(localStorage.getItem('conciliacao:destinos')) || {}; } catch (e) { return {}; } }
  function salvarDestino(chave, valor) {
    const d = lerDestinos();
    if (valor) d[chave] = valor; else delete d[chave];
    try { localStorage.setItem('conciliacao:destinos', JSON.stringify(d)); } catch (e) {}
  }

  /* ---------------- carregar do banco ---------------- */
  function aviso(txt, erro) { $('aviso').innerHTML = txt ? `<p class="aviso${erro ? ' erro' : ''}">${txt}</p>` : ''; }

  async function carregarDoBanco() {
    estado.fonte = 'api'; $('fonteTitulos').textContent = 'Títulos: banco do PROCFIT';
    aviso('Buscando os títulos do mês no banco…');
    const mes = $('mes').value;
    try {
      estado.titulos = (await api('/conciliacao/titulos?mes=' + mes)).map(montarTitulo).filter(t => t.venc);
      aviso('');
    } catch (err) {
      if (err.message === 'acesso') return;
      estado.titulos = [];
      aviso(esc(err.message) + ' Enquanto isso, dá para usar "Usar títulos de uma planilha" com a exportação do SSMS.', true);
    }
    await carregarExtratosGuardados();
    try {
      estado.pedidosBanco = (await api('/conciliacao/pedidos-sem-nota?mes=' + mes)).map(p => ({
        pedido: p.pedido, data: lerData(p.data_pedido), cod: p.cod_cliente ?? '', nome: p.nome_cliente ?? '',
        doc: p.cpf_cnpj ?? '', valor: lerValor(p.valor), pago: lerValor(p.valor_pago),
        situacao: p.situacao ?? '', vendedor: p.vendedor ?? ''
      }));
    } catch (err) {
      estado.pedidosBanco = null; // sem a consulta de pedidos, a lista sai dos títulos sem nota
    }
    processar();
  }

  // Extratos já enviados antes: a conciliação usa sozinha, sem escolher o arquivo de novo
  estado.extratosNoServidor = null; // null = ainda não sabe; false = servidor sem banco de extratos
  async function carregarExtratosGuardados() {
    try {
      const linhas = await api('/conciliacao/extratos?mes=' + $('mes').value);
      const porArquivo = new Map();
      linhas.forEach(r => {
        const chave = r.arquivo || 'sem nome';
        if (!porArquivo.has(chave)) porArquivo.set(chave, { nome: chave, origem: r.origem, conta: r.conta, entradas: [], salvo: true });
        porArquivo.get(chave).entradas.push({
          id: r.id, arquivo: chave, data: lerData(r.data), valor: Number(r.valor), desc: r.descricao || '',
          doc: r.documento || '', nome: r.nome || '', chave: r.chave || '', origem: r.origem, pix: !!r.pix, agrupado: !!r.agrupado
        });
      });
      estado.arquivos = [...porArquivo.values()];
      estado.extratosNoServidor = true;
      juntarEntradas();
    } catch (err) {
      if (err.message === 'acesso') return;
      // Servidor ainda sem o banco de extratos: continua funcionando só com o arquivo da vez
      estado.extratosNoServidor = false;
    }
  }

  // Mostra "Conciliando…" antes de calcular, para a tela não parecer travada
  let agendado = null;
  function processar() {
    if (!estado.titulos.length) { estado.resultado = null; renderizar(); return; }
    $('tabela').innerHTML = `<p class="vazio">Conciliando ${estado.titulos.length.toLocaleString('pt-BR')} títulos com ${estado.entradas.length.toLocaleString('pt-BR')} entradas…</p>`;
    document.body.style.cursor = 'progress';
    clearTimeout(agendado);
    agendado = setTimeout(() => {
      const d = lerDecisoesMes();
      estado.resultado = MotorConciliacao.conciliar(estado.titulos, estado.entradas, {
        mes: $('mes').value, hoje: new Date(), confirmados: d.confirmados, rejeitados: d.rejeitados
      });
      // atalhos para achar entrada e título pelo id sem percorrer as listas
      estado.entradaPorId = new Map(estado.resultado.entradas.map(e => [e.id, e]));
      estado.tituloPorId = new Map(estado.resultado.titulos.map(t => [String(t.id), t]));
      document.body.style.cursor = '';
      renderizar();
    }, 30);
  }

  /* ---------------- pedidos sem nota ---------------- */
  function pedidosSemNota() {
    const hoje = new Date();
    let lista;
    if (estado.pedidosBanco) lista = estado.pedidosBanco.map(p => Object.assign({ fonte: 'pedidos' }, p));
    else {
      // Sem a consulta de pedidos: agrupa os títulos em aberto que ainda não têm nota
      const grupos = new Map();
      (estado.resultado ? estado.resultado.titulos : []).filter(t => !t.faturado && t.pendente > 0 && String(t.pedido).trim()).forEach(t => {
        const g = grupos.get(t.pedido) || { pedido: t.pedido, data: t.venc, cod: t.cod, nome: t.nome, doc: t.doc, valor: 0, pago: 0, situacao: '', vendedor: '', fonte: 'titulos' };
        g.valor += t.valor; g.pago += t.pago; if (t.venc < g.data) g.data = t.venc;
        grupos.set(t.pedido, g);
      });
      lista = [...grupos.values()];
    }
    const limite = Math.max(1, parseInt($('dias').value, 10) || 15);
    lista.forEach(p => {
      p.diasParado = p.data ? Math.max(0, Math.floor((hoje - p.data) / DIA)) : 0;
      if (p.pago > 0) p.leitura = ['Tem pagamento — faturar?', 's-sug'];
      else if (p.diasParado >= limite) p.leitura = ['Candidato a cancelar', 's-ruim'];
      else p.leitura = ['Recente', 's-neutro'];
    });
    return lista.sort((a, b) => b.diasParado - a.diasParado);
  }

  /* ---------------- listas de cada aba ---------------- */
  function listas() {
    const r = estado.resultado; if (!r) return {};
    const incluirAnt = $('anteriores').checked;
    const doPeriodo = t => t.doMes || (incluirAnt && t.pendente > 0);
    const aberto = t => t.pendente > 0 && doPeriodo(t) && !['sem_baixa', 'sugerido'].includes(t.status);
    return {
      confirmar: r.pares.filter(p => p.tipo === 'sugerido'),
      conciliados: r.titulos.filter(t => t.status === 'conciliado' && !t.formaProblema),
      diferenca: r.titulos.filter(t => t.status === 'diferenca' && !t.formaProblema),
      faltaBaixar: r.titulos.filter(t => t.status === 'sem_baixa'),
      corrigirForma: r.titulos.filter(t => t.formaProblema),
      semDinheiro: r.titulos.filter(t => t.status === 'baixado_sem_entrada'),
      vencidas: r.titulos.filter(t => aberto(t) && t.faturado && t.status === 'vencido'),
      aVencer: r.titulos.filter(t => aberto(t) && t.faturado && t.status === 'a_vencer'),
      pedidos: pedidosSemNota(),
      semTitulo: r.entradas.filter(e => e.status === 'sem_titulo'),
      balcao: r.entradas.filter(e => e.status === 'venda_sem_titulo'),
      somados: r.entradas.filter(e => e.status === 'agrupado'),
      todos: r.titulos.filter(doPeriodo)
    };
  }
  // [chave, nome, grupo] — na ordem em que o trabalho deve ser feito
  const ABAS = [
    ['faltaBaixar', 'Falta baixar', '1 · Acertar no PROCFIT'],
    ['corrigirForma', 'Corrigir forma', '1 · Acertar no PROCFIT'],
    ['confirmar', 'Para confirmar', '2 · Conferir'],
    ['diferenca', 'Com diferença de valor', '2 · Conferir'],
    ['semTitulo', 'Dinheiro sem título', '3 · Investigar'],
    ['semDinheiro', 'Baixa sem dinheiro no banco', '3 · Investigar'],
    ['vencidas', 'Vencidas: cobrar ou cancelar', '4 · Decidir'],
    ['aVencer', 'A vencer', '4 · Decidir'],
    ['pedidos', 'Pedidos sem nota', '4 · Decidir'],
    ['somados', 'Somados no dia', '5 · Informativo'],
    ['balcao', 'Balcão na Rede', '5 · Informativo'],
    ['conciliados', 'Conciliados', '6 · Está certo'],
    ['todos', 'Todos os títulos', '6 · Está certo']
  ];

  // Guia de cada aba: o que é, por que acontece e o que fazer (para não restar dúvida)
  const GUIA = {
    faltaBaixar: ['O dinheiro já entrou no banco, mas o título continua em aberto no PROCFIT.',
      'A baixa não foi feita, ou foi lançada em outro título.',
      'Baixe no PROCFIT o título indicado, com a data e a conta do extrato. Recarregue: ele passa para Conciliados.'],
    corrigirForma: ['Dinheiro e baixa conferem, mas a forma de pagamento no PROCFIT é diferente da que aparece no banco.',
      'Baixa lançada com a forma errada (ex.: PIX registrado como dinheiro) ou forma em branco.',
      'Corrija a forma de pagamento no PROCFIT. Isso afeta os relatórios por forma e a conciliação de dinheiro.'],
    confirmar: ['O sistema achou um título provável, mas sem certeza: várias parcelas somando o valor, nome parecido ou só o valor igual.',
      'O banco nem sempre informa o CPF/CNPJ de quem pagou, e alguns clientes pagam várias notas de uma vez.',
      'Leia o motivo e a confiança. Confirmar: o par é aceito. Recusar: a entrada volta a procurar outro título.'],
    diferenca: ['Mesmo cliente, mas o valor pago é diferente do título.',
      'A mais: juros ou multa por atraso. A menos: desconto, taxa ou pagamento parcial.',
      'Baixe com juros/desconto no PROCFIT, ou faça a baixa parcial e cobre o restante.'],
    semTitulo: ['Entrou dinheiro no banco e nenhum título do mês corresponde a ele.',
      'Pagamento antecipado, título com cliente ou valor errado, depósito de terceiro ou transferência entre contas.',
      'Identifique quem pagou (comprovante, contato com o cliente) e marque a decisão. Enquanto houver valor aqui, o mês não fecha.'],
    semDinheiro: ['Há baixa no PROCFIT neste mês, mas nenhum crédito correspondente nos arquivos carregados.',
      'Data ou conta digitada errada na baixa, baixa feita sem o dinheiro, ou o crédito está em outra conta ou arquivo.',
      'Confira data e conta da baixa (veja se o extrato da outra conta foi carregado). Sem dinheiro de fato: estorne a baixa.'],
    vencidas: ['Títulos vencidos que não apareceram no banco.', 'O cliente não pagou, ou pagou e o dinheiro ainda não foi identificado.',
      'Antes de cobrar, confira a aba Dinheiro sem título. Depois decida: cobrar ou cancelar.'],
    aVencer: ['Títulos que ainda vão vencer.', 'Situação normal.', 'Nada a fazer agora; acompanhe.'],
    pedidos: ['Pedidos sem nota fiscal.', 'Orçamentos esquecidos, vendas desistidas ou pagas sem faturar.',
      'Pedido com pagamento: faturar. Parado há muitos dias sem pagamento: avaliar cancelamento.'],
    somados: ['Lançamentos do extrato que juntam vários pagamentos num valor só (boletos do dia, repasses da Rede, PIX pela maquininha).',
      'O banco credita esses recebimentos em lote.', 'Nada a fazer aqui: o detalhe vem do relatório de boletos e do arquivo da Rede.'],
    balcao: ['Vendas aprovadas na maquininha da Rede que não têm título no sistema.', 'Normalmente são vendas de balcão pagas na hora.',
      'Nada a fazer, a não ser que o valor seja de uma venda a prazo.'],
    conciliados: ['Dinheiro no banco e baixa no PROCFIT conferem: mesmo valor, data compatível.', '', 'Nada a fazer.'],
    todos: ['Todos os títulos do mês, com a situação de cada um.', '', 'Use a busca para achar um cliente, pedido ou nota.']
  };

  // Confiança do cruzamento, para ler cada sugestão sem dúvida
  function confianca(par) {
    if (!par) return '';
    if (par.tipo === 'confirmado') return '<span class="conf conf-alta">confirmado por você</span>';
    if (par.tipo === 'auto' || par.tipo === 'diferenca') return '<span class="conf conf-alta">confiança alta</span>';
    if (par.nivel <= 3) return '<span class="conf conf-media">confiança média</span>';
    return '<span class="conf conf-baixa">confiança baixa</span>';
  }

  // Em qual linha do quadro de prova cada crédito do arquivo entra
  function classeEntrada(e) {
    if (e.status === 'agrupado') return 'somados';
    if (e.status === 'venda_sem_titulo') return 'balcao';
    if (e.status === 'sem_titulo') return 'semTitulo';
    if (e.status === 'sugerido') return 'confirmar';
    const ts = e.par ? titulosDoPar(e.par) : [];
    if (ts.some(t => t.status === 'sem_baixa')) return 'faltaBaixar';
    if (e.par && e.par.tipo === 'diferenca') return 'diferenca';
    return 'conciliados';
  }

  function chaveFechamento() { return 'conciliacao:fechamento:' + $('mes').value; }
  function lerFechamento() { try { return JSON.parse(localStorage.getItem(chaveFechamento())); } catch (e) { return null; } }

  // Quadro de prova: os créditos do arquivo e as baixas do PROCFIT precisam ficar 100% explicados
  function quadroDeProva() {
    const r = estado.resultado;
    if (!r) return '<div class="prova-vazia">Escolha o mês para carregar os títulos do PROCFIT.</div>';
    const soma = (lista, f) => lista.reduce((s, x) => s + (f(x) || 0), 0);
    const [ano, mesN] = $('mes').value.split('-').map(Number);
    const ini = new Date(ano, mesN - 1, 1), fim = new Date(ano, mesN, 1);
    const noMes = d => d && d >= ini && d < fim;

    const linhasBanco = { conciliados: 0, faltaBaixar: 0, diferenca: 0, confirmar: 0, somados: 0, balcao: 0, semTitulo: 0 };
    r.entradas.forEach(e => { linhasBanco[classeEntrada(e)] += e.valor || 0; });
    const totalBanco = soma(r.entradas, e => e.valor);

    const baixasMes = r.titulos.filter(t => t.pago > 0 && noMes(t.dtPag) && !t.fora);
    const conciliadas = soma(baixasMes.filter(t => t.par && t.par.tipo !== 'sugerido'), t => t.pago);
    const semDinheiro = soma(baixasMes.filter(t => t.status === 'baixado_sem_entrada'), t => t.pago);
    const outrasBaixas = soma(baixasMes, t => t.pago) - conciliadas - semDinheiro;

    const pendenteBanco = linhasBanco.semTitulo + linhasBanco.confirmar + linhasBanco.diferenca + linhasBanco.faltaBaixar;
    const fechado = lerFechamento();
    const temArquivo = r.entradas.length > 0;
    const linha = (rotulo, valor, aba, classe = '') =>
      `<tr class="${classe}"><td>${aba ? `<button class="ir" data-ir="${aba}">${rotulo}</button>` : rotulo}</td><td class="num">${brl(valor)}</td></tr>`;

    let situacao;
    if (!temArquivo) situacao = '<span class="selo selo-neutro">Nenhum extrato guardado neste mês: envie o arquivo do Itaú uma vez</span>';
    else if (fechado) situacao = `<span class="selo selo-ok">Mês fechado em ${esc(fechado.em)}${fechado.justificativa ? ' · com justificativa' : ''}</span>`;
    else if (pendenteBanco < 0.01 && semDinheiro < 0.01) situacao = '<span class="selo selo-ok">Tudo explicado: o mês pode ser fechado</span>';
    else situacao = `<span class="selo selo-alerta">Falta explicar ${brl(pendenteBanco + semDinheiro)}</span>`;

    return `
      <div class="prova-topo"><h2>Prova da conciliação · ${esc($('mes').value.split('-').reverse().join('/'))}</h2>${situacao}
        ${temArquivo ? `<button class="btn claro" id="fecharMes" type="button">${fechado ? 'Reabrir o mês' : 'Fechar o mês'}</button>` : ''}</div>
      <div class="prova">
        <table aria-label="Créditos do banco">
          <thead><tr><th>No banco (extratos guardados no painel)</th><th class="num">Valor</th></tr></thead>
          <tbody>
            ${linha('Créditos no extrato do mês', totalBanco, null, 'total')}
            ${linha('(−) Conciliados com baixa no PROCFIT', linhasBanco.conciliados, 'conciliados')}
            ${linha('(−) Falta baixar no PROCFIT', linhasBanco.faltaBaixar, 'faltaBaixar', linhasBanco.faltaBaixar > 0.01 ? 'alerta' : '')}
            ${linha('(−) Com diferença de valor', linhasBanco.diferenca, 'diferenca', linhasBanco.diferenca > 0.01 ? 'alerta' : '')}
            ${linha('(−) Para confirmar', linhasBanco.confirmar, 'confirmar', linhasBanco.confirmar > 0.01 ? 'alerta' : '')}
            ${linha('(−) Somados no dia (detalhe em outro arquivo)', linhasBanco.somados, 'somados')}
            ${linha('(−) Vendas de balcão na Rede', linhasBanco.balcao, 'balcao')}
            ${linha('(=) Dinheiro sem título', linhasBanco.semTitulo, 'semTitulo', linhasBanco.semTitulo > 0.01 ? 'ruim resultado' : 'resultado')}
          </tbody>
        </table>
        <table aria-label="Baixas do PROCFIT">
          <thead><tr><th>No PROCFIT (baixas do mês)</th><th class="num">Valor</th></tr></thead>
          <tbody>
            ${linha('Baixas com data no mês', soma(baixasMes, t => t.pago), null, 'total')}
            ${linha('(−) Conciliadas com o banco', conciliadas, 'conciliados')}
            ${outrasBaixas > 0.01 ? linha('(−) Aguardando confirmação', outrasBaixas, 'confirmar') : ''}
            ${linha('(=) Baixa sem dinheiro no banco', semDinheiro, 'semDinheiro', semDinheiro > 0.01 ? 'ruim resultado' : 'resultado')}
          </tbody>
        </table>
      </div>
      <p class="prova-nota">O mês está conciliado quando as duas linhas "(=)" ficam zeradas, ou quando o que sobrar tem justificativa. Clique numa linha para abrir a lista correspondente.</p>`;
  }
  const ABAS_COM_DECISAO = ['semDinheiro', 'vencidas', 'aVencer', 'corrigirForma', 'faltaBaixar'];

  /* ---------------- desenho ---------------- */
  function renderizar() {
    const r = estado.resultado;
    $('fechamento').innerHTML = quadroDeProva();

    const L = listas();
    const valorDaLista = (k) => {
      const lista = L[k] || [];
      if (k === 'confirmar') return lista.reduce((s, p) => s + ((estado.entradaPorId && estado.entradaPorId.get(p.entradaId)) || {}).valor || 0, 0);
      if (['semTitulo', 'somados', 'balcao'].includes(k)) return lista.reduce((s, e) => s + (e.valor || 0), 0);
      if (k === 'pedidos') return lista.reduce((s, p) => s + (p.valor || 0), 0);
      const campo = ['semDinheiro', 'conciliados', 'corrigirForma', 'diferenca'].includes(k) ? 'pago' : 'pendente';
      return lista.reduce((s, t) => s + (t[campo] || 0), 0);
    };
    // Trilha de trabalho: um bloco por passo ("1 · Acertar no PROCFIT"), com as listas dele embaixo
    const passos = [];
    ABAS.forEach(([k, n, g]) => {
      let passo = passos.find(p => p.g === g);
      if (!passo) { passo = { g, itens: [] }; passos.push(passo); }
      const qtd = L[k] ? L[k].length : 0;
      passo.itens.push(`<button role="tab" aria-selected="${estado.aba === k}" data-aba="${k}"${qtd ? '' : ' class="vazia"'}>${n}<b>${qtd}</b>${qtd ? `<small>${brl(valorDaLista(k))}</small>` : ''}</button>`);
    });
    $('abas').innerHTML = passos.map(({ g, itens }) => {
      const [num, nome] = g.split(' · ');
      return `<div class="trilha__passo" role="presentation"><span class="grupo-abas"><span class="grupo-abas__num">${num}</span>${nome || num}</span>${itens.join('')}</div>`;
    }).join('');
    const guia = GUIA[estado.aba];
    $('guia').innerHTML = guia ? `<div class="guia"><div><span>O que é</span>${guia[0]}</div>${guia[1] ? `<div><span>Por que acontece</span>${guia[1]}</div>` : ''}<div><span>O que fazer</span>${guia[2]}</div></div>` : '';
    $('rotuloDias').hidden = estado.aba !== 'pedidos';
    $('rotuloAnteriores').hidden = !['vencidas', 'todos'].includes(estado.aba);

    if (!r) {
      $('tabela').innerHTML = '<p class="vazio">Escolha o mês para carregar os títulos. Depois, escolha o arquivo do banco ou da Rede.</p>';
      $('totalLista').textContent = ''; return;
    }

    const LIMITE = 300; // linhas desenhadas na tela; o total e o Excel usam a lista inteira
    const busca = norm($('busca').value);
    const passa = txt => !busca || norm(txt).includes(busca);
    const destinos = lerDestinos();
    let html = '', total = 0, n = 0;

    if (estado.aba === 'confirmar') {
      const itens = L.confirmar.filter(p => {
        const e = estado.entradaPorId.get(p.entradaId);
        return passa(e.nome + ' ' + e.desc + ' ' + e.valor + ' ' + titulosDoPar(p).map(t => t.nome + ' ' + t.pedido + ' ' + t.nf).join(' '));
      });
      n = itens.length;
      itens.forEach(p => { total += estado.entradaPorId.get(p.entradaId).valor; });
      html = `<table><thead><tr><th>Data no arquivo</th><th class="num">Valor no arquivo</th><th>Quem pagou (arquivo)</th><th>Arquivo</th><th>Título(s) do sistema</th><th>Motivo</th><th></th></tr></thead><tbody>` +
        itens.slice(0, LIMITE).map(p => {
          const e = estado.entradaPorId.get(p.entradaId);
          return `<tr><td>${dt(e.data)}</td><td class="num">${brl(e.valor)}</td><td>${esc(e.nome || e.desc)}<div class="cod">${esc(e.doc)}</div></td><td class="motivo">${esc(e.arquivo)}</td>
            <td>${titulosDoPar(p).map(t => `<div>Pedido ${esc(t.pedido)}/${esc(t.parcela)} · NF ${esc(t.nf || '—')} · ${btnCliente(t)} · venc. ${dt(t.venc)} · ${brl(t.pendenteOuPago)}</div>`).join('')}</td>
            <td class="motivo">${confianca(p)}<br>${esc(p.motivo)}${p.diferenca ? '<br>Diferença: ' + brl(p.diferenca) : ''}</td>
            <td class="acoes"><button class="confirmar" data-confirmar="${esc(p.entradaId)}">Confirmar</button><button class="recusar" data-recusar="${esc(p.entradaId)}">Recusar</button></td></tr>`;
        }).join('') + '</tbody></table>';
    } else if (estado.aba === 'semTitulo' || estado.aba === 'somados' || estado.aba === 'balcao') {
      const explica = {
        somados: 'Estes lançamentos do extrato juntam vários pagamentos num valor só (boletos do dia, repasses da Rede, PIX pela maquininha). Eles não entram no confronto título a título: o detalhe de cada um vem do relatório de boletos e do relatório da Rede.',
        balcao: 'Vendas aprovadas na maquininha da Rede que não têm título no sistema. Normalmente são vendas de balcão pagas na hora, então não indicam problema.'
      }[estado.aba];
      const itens = L[estado.aba].filter(e => passa(e.nome + ' ' + e.desc + ' ' + e.doc + ' ' + e.valor + ' ' + e.arquivo + ' ' + e.chave));
      n = itens.length;
      itens.forEach(e => { total += e.valor; });
      html = `<table><thead><tr><th>Data</th><th class="num">Valor</th><th>Quem pagou</th><th>CPF/CNPJ</th><th>Descrição</th><th>Arquivo</th>${estado.aba === 'semTitulo' ? '<th>Decisão</th>' : ''}</tr></thead><tbody>` +
        itens.slice(0, LIMITE).map(e => {
          return `<tr><td>${dt(e.data)}</td><td class="num">${brl(e.valor)}</td><td>${esc(e.nome)}</td><td>${esc(e.doc)}</td><td>${esc(e.desc)}${e.chave ? ' · ' + esc(e.chave) : ''}</td><td class="motivo">${esc(e.arquivo)}</td>
            ${estado.aba === 'semTitulo' ? `<td>${seletor('E:' + e.id, destinos)}</td>` : ''}</tr>`;
        }).join('') + '</tbody></table>';
    } else if (estado.aba === 'pedidos') {
      const itens = L.pedidos.filter(p => passa(`${p.nome} ${p.cod} ${p.pedido} ${p.vendedor} ${p.valor}`));
      n = itens.length;
      itens.forEach(p => { total += p.valor; });
      html = (estado.pedidosBanco ? '' : '<p class="aviso">Lista montada pelos títulos sem nota. Quando a consulta de pedidos for configurada, entram também os pedidos que nem geraram título.</p>') +
        `<table><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th class="num">Valor</th><th class="num">Pago</th><th class="num">Dias parado</th><th>Leitura</th><th>Decisão</th></tr></thead><tbody>` +
        itens.slice(0, LIMITE).map(p => {
          return `<tr><td>${esc(p.pedido)}</td><td>${dt(p.data)}</td><td>${btnCliente(p)} <span class="cod">${esc(p.cod)}</span></td><td>${esc(p.vendedor)}</td>
            <td class="num">${brl(p.valor)}</td><td class="num">${p.pago ? brl(p.pago) : '—'}</td><td class="num">${p.diasParado}</td>
            <td><span class="status ${p.leitura[1]}">${p.leitura[0]}</span>${p.situacao ? `<div class="motivo">${esc(p.situacao)}</div>` : ''}</td>
            <td>${seletor('P:' + p.pedido, destinos)}</td></tr>`;
        }).join('') + '</tbody></table>';
    } else {
      const itens = (L[estado.aba] || []).filter(t => passa(`${t.nome} ${t.cod} ${t.pedido} ${t.nf} ${t.valor}`)).sort((a, b) => a.venc - b.venc);
      n = itens.length;
      const campoTotal = ['semDinheiro', 'conciliados', 'corrigirForma'].includes(estado.aba) ? 'pago' : 'pendente';
      itens.forEach(t => { total += t[campoTotal]; });
      html = tabelaTitulos(itens.slice(0, LIMITE), null, ABAS_COM_DECISAO.includes(estado.aba), estado.aba === 'corrigirForma', destinos);
    }
    $('totalLista').innerHTML = `${n} ${n === 1 ? 'item' : 'itens'} · <strong>${brl(total)}</strong>`;
    const corte = n > LIMITE
      ? `<p class="aviso">Mostrando ${LIMITE} de ${n.toLocaleString('pt-BR')}. Use a busca para achar um cliente, pedido ou nota; o Excel leva a lista completa.</p>` : '';
    $('tabela').innerHTML = n ? corte + html : '<p class="vazio">Nada nesta lista para o mês e a busca escolhidos.</p>';
    rotularTabelas($('tabela'));
  }

  function seletor(chave, destinos) {
    const atual = destinos[chave] || '';
    return `<select class="decisao${atual ? ' marcada' : ''}" data-destino="${esc(chave)}" aria-label="Decisão">` +
      DECISOES.map(o => `<option value="${o}"${o === atual ? ' selected' : ''}>${o || 'Decidir…'}</option>`).join('') + '</select>';
  }
  function titulosDoPar(p) { return p.tituloIds.map(id => estado.tituloPorId.get(id)).filter(Boolean); }
  // "Entrou R$ X em dd/mm · arquivo · diferença R$ Y" — para conferir o que casou com o título
  function detalheEntrada(t) {
    if (!t.par || !estado.entradaPorId) return '';
    const e = estado.entradaPorId.get(t.par.entradaId); if (!e) return '';
    const dif = t.par.diferenca ? ` · diferença ${t.par.diferenca > 0 ? '+' : '−'}${brl(Math.abs(t.par.diferenca))}` : '';
    return `<div class="motivo">Entrou ${brl(e.valor)} em ${dt(e.data)} · ${esc(e.arquivo || '')}${dif}</div>`;
  }
  function btnCliente(t) { return `<button class="cliente" data-cliente="${esc(t.cod)}">${esc(t.nome)}</button>`; }
  function diasAtraso(t) { if (t.pendente <= 0) return ''; const d = Math.floor((new Date() - t.venc) / DIA); return d > 0 ? d : ''; }

  function tabelaTitulos(itens, soma, comDecisao, comForma, destinos) {
    return `<table><thead><tr><th>Pedido</th><th>Nota fiscal</th><th>Parcela</th><th>Cliente</th><th>Vencimento</th>
      <th class="num">Valor</th><th class="num">Pago</th><th class="num">Pendente</th><th class="num">Atraso (dias)</th>
      ${comForma ? '<th>Forma no sistema</th><th>Forma no arquivo</th>' : ''}<th>Situação</th>${comDecisao ? '<th>Decisão</th>' : ''}</tr></thead><tbody>` +
      itens.map(t => {
        soma && soma(t); const [nome, cls] = STATUS[t.status] || [t.status, 's-neutro'];
        return `<tr><td>${esc(t.pedido)}</td><td>${esc(t.nf || '—')}</td><td>${esc(t.parcela)}</td>
          <td>${btnCliente(t)} <span class="cod">${esc(t.cod)}</span></td><td>${dt(t.venc)}</td>
          <td class="num">${brl(t.valor)}</td><td class="num">${t.pago ? brl(t.pago) : '—'}</td><td class="num">${t.pendente ? brl(t.pendente) : '—'}</td>
          <td class="num">${diasAtraso(t)}</td>
          ${comForma ? `<td>${esc(t.forma || 'vazia')}</td><td>${esc(t.formaArquivo || 'não identificada')}</td>` : ''}
          <td><span class="status ${cls}">${nome}</span>${t.par && t.par.motivo ? `<div class="motivo">${confianca(t.par)} · ${esc(t.par.motivo)}</div>` : ''}${detalheEntrada(t)}${t.origem && t.origem !== 'Nota fiscal' ? `<div class="motivo">${esc(t.origem)}</div>` : ''}</td>
          ${comDecisao ? `<td>${seletor('T:' + t.id, destinos)}</td>` : ''}</tr>`;
      }).join('') + '</tbody></table>';
  }

  // No celular cada linha vira um cartão: cada célula leva o nome da sua coluna (o CSS mostra ao lado)
  function rotularTabelas(area) {
    area.querySelectorAll('table').forEach(tabela => {
      const nomes = [...tabela.querySelectorAll('thead th')].map(th => th.textContent.trim());
      tabela.querySelectorAll('tbody tr').forEach(tr => {
        let coluna = 0;
        [...tr.children].forEach(td => {
          td.setAttribute('data-label', td.colSpan > 1 ? '' : (nomes[coluna] || ''));
          coluna += td.colSpan || 1;
        });
      });
    });
  }

  /* ---------------- ficha do cliente ---------------- */
  function abrirFicha(cod) {
    const ts = estado.titulos.filter(t => String(t.cod) === String(cod)).sort((a, b) => a.venc - b.venc);
    const peds = pedidosSemNota().filter(p => String(p.cod) === String(cod) && p.fonte === 'pedidos');
    if (!ts.length && !peds.length) return;
    const base = ts[0] || peds[0];
    const total = ts.reduce((s, t) => s + t.valor, 0), pago = ts.reduce((s, t) => s + t.pago, 0), pend = ts.reduce((s, t) => s + t.pendente, 0);
    const f = $('ficha');
    f.innerHTML = `<header style="background:var(--verde-noite);color:#fff"><button class="fechar" id="fecharFicha" aria-label="Fechar">×</button>
      <h2>${esc(base.nome)}</h2><div class="fonte">Código ${esc(cod)}${base.doc ? ' · ' + esc(base.doc) : ''}</div></header>
      <div class="numeros"><div><span>Total em títulos</span><strong>${brl(total)}</strong></div>
      <div><span>Pago</span><strong>${brl(pago)}</strong></div><div><span>Pendente</span><strong>${brl(pend)}</strong></div></div>
      <div class="rolagem"><table><thead><tr><th>Pedido</th><th>NF</th><th>Parc.</th><th>Venc.</th><th class="num">Valor</th><th class="num">Pendente</th><th>Situação</th></tr></thead><tbody>
      ${ts.map(t => { const [n, c] = STATUS[t.status] || ['', 's-neutro']; return `<tr><td>${esc(t.pedido)}</td><td>${esc(t.nf || '—')}</td><td>${esc(t.parcela)}</td><td>${dt(t.venc)}</td><td class="num">${brl(t.valor)}</td><td class="num">${t.pendente ? brl(t.pendente) : '—'}</td><td><span class="status ${c}">${n}</span></td></tr>`; }).join('')}
      ${peds.map(p => `<tr><td>${esc(p.pedido)}</td><td>—</td><td></td><td>${dt(p.data)}</td><td class="num">${brl(p.valor)}</td><td class="num">${brl(p.valor - p.pago)}</td><td><span class="status ${p.leitura[1]}">Pedido sem nota</span></td></tr>`).join('')}
      </tbody></table></div>`;
    rotularTabelas(f);
    f.classList.add('aberta'); f.setAttribute('aria-hidden', 'false');
    $('fecharFicha').focus();
  }
  function fecharFicha() { const f = $('ficha'); f.classList.remove('aberta'); f.setAttribute('aria-hidden', 'true'); }

  /* ---------------- exportar ---------------- */
  function exportar() {
    const r = estado.resultado; if (!r) return;
    const destinos = lerDestinos();
    const wb = XLSX.utils.book_new();
    const linhaT = t => ({
      Pedido: t.pedido, 'Nota fiscal': t.nf, Parcela: t.parcela, 'Cód. cliente': t.cod, Cliente: t.nome, 'CPF/CNPJ': t.doc,
      Vencimento: t.venc, Valor: t.valor, Pago: t.pago, Pendente: t.pendente, 'Data pagamento': t.dtPag, 'Conta caixa': t.conta,
      Origem: t.origem || '', 'Forma no sistema': t.forma, 'Forma no arquivo': t.formaArquivo || '', Situação: (STATUS[t.status] || [t.status])[0],
      Motivo: t.par ? t.par.motivo : '',
      'Valor no extrato': t.par && estado.entradaPorId.get(t.par.entradaId) ? estado.entradaPorId.get(t.par.entradaId).valor : '',
      'Data no extrato': t.par && estado.entradaPorId.get(t.par.entradaId) ? estado.entradaPorId.get(t.par.entradaId).data : '',
      'Arquivo': t.par && estado.entradaPorId.get(t.par.entradaId) ? estado.entradaPorId.get(t.par.entradaId).arquivo : '',
      'Diferença': t.par ? t.par.diferenca || 0 : '',
      Decisão: destinos['T:' + t.id] || ''
    });
    const linhaP = p => ({
      Pedido: p.pedido, Data: p.data, 'Cód. cliente': p.cod, Cliente: p.nome, Vendedor: p.vendedor, Valor: p.valor,
      Pago: p.pago, 'Dias parado': p.diasParado, Leitura: p.leitura[0], Decisão: destinos['P:' + p.pedido] || ''
    });
    const aba = (nome, linhas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ Aviso: 'Nada nesta lista' }]), nome);
    const L = listas();
    const todosT = r.titulos.map(linhaT), todosP = L.pedidos.map(linhaP);
    aba('Decisão - Cancelar', todosT.filter(l => l.Decisão === 'Cancelar').concat(todosP.filter(l => l.Decisão === 'Cancelar')));
    aba('Decisão - Cobrar', todosT.filter(l => l.Decisão === 'Cobrar'));
    // Prova da conciliação em linhas (mesma conta da tela)
    const prova = [];
    const tmp = document.createElement('div'); tmp.innerHTML = quadroDeProva();
    tmp.querySelectorAll('tr').forEach(tr => {
      const c = [...tr.children].map(td => td.textContent.trim());
      if (c.length === 2) prova.push({ Linha: c[0], Valor: c[1] });
    });
    const f = lerFechamento();
    if (f) prova.push({ Linha: 'Mês fechado em ' + f.em, Valor: f.justificativa || '' });
    aba('Prova da conciliação', prova);
    aba('Falta baixar', L.faltaBaixar.map(linhaT));
    aba('Com diferença', L.diferenca.map(linhaT));
    aba('Corrigir forma', L.corrigirForma.map(linhaT));
    aba('Baixado sem dinheiro', L.semDinheiro.map(linhaT));
    aba('Notas vencidas', L.vencidas.map(linhaT));
    aba('Notas a vencer', L.aVencer.map(linhaT));
    aba('Pedidos sem nota', todosP);
    aba('Entradas sem título', L.semTitulo.map(e => ({ Data: e.data, Valor: e.valor, Arquivo: e.arquivo, 'Quem pagou': e.nome, 'CPF/CNPJ': e.doc, Descrição: e.desc, Decisão: destinos['E:' + e.id] || '' })));
    aba('Somados no dia', L.somados.map(e => ({ Data: e.data, Valor: e.valor, Arquivo: e.arquivo, Descrição: e.desc })));
    aba('Vendas de balcão', L.balcao.map(e => ({ Data: e.data, Valor: e.valor, Arquivo: e.arquivo, Descrição: e.desc, 'NSU/CV': e.chave })));
    aba('Todos os títulos', todosT);
    XLSX.writeFile(wb, `conciliacao-${$('mes').value}.xlsx`);
  }

  /* ---------------- eventos ---------------- */
  const hoje = new Date();
  $('mes').value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  try { const d = localStorage.getItem('conciliacao:dias'); if (d) $('dias').value = d; } catch (e) {}

  $('mes').addEventListener('change', () => {
    limparArquivos();
    // carregarDoBanco busca os títulos E os extratos guardados do novo mês
    estado.fonte === 'api' ? carregarDoBanco() : processar();
  });
  // Vários arquivos de uma vez (Ctrl ou Shift na janela de escolha), e dá para ir adicionando mais.
  // Se escolher de novo um arquivo com o mesmo nome, ele substitui o anterior.
  function juntarEntradas() {
    estado.entradas = estado.arquivos.flatMap(a => a.entradas);
    const n = estado.arquivos.length;
    $('nomeArquivo').innerHTML = n
      ? estado.arquivos.map(a => {
          const tipo = a.origem === 'rede' ? 'Rede' : a.origem === 'boletos' ? 'boletos' : 'extrato';
          const agrup = a.entradas.filter(e => e.agrupado).length;
          const remover = a.salvo ? ` <button class="remover-arquivo" type="button" data-remover="${esc(a.nome)}" title="Tirar este arquivo do painel">remover</button>` : '';
          return `${esc(a.nome)} <span style="opacity:.7">(${tipo}${a.conta ? ' conta ' + esc(a.conta) : ''}, ${a.entradas.length - agrup}${agrup ? ' + ' + agrup + ' somados no dia' : ''} no mês)</span>${remover}`;
        }).join('<br>')
      : 'Nenhum extrato guardado para este mês';
    if (n > 1) $('nomeArquivo').innerHTML = `<details><summary>${n} arquivos guardados · ${(estado.entradas.filter(e => !e.agrupado).length).toLocaleString('pt-BR')} pagamentos no mês</summary>${$('nomeArquivo').innerHTML}</details>`;
    // Com os extratos guardados no painel, "limpar" não faz sentido: cada arquivo tem o seu "remover"
    $('limparArquivos').hidden = !n || estado.extratosNoServidor === true;
  }
  function limparArquivos() { estado.arquivos = []; juntarEntradas(); }

  $('arquivo').addEventListener('change', async ev => {
    const escolhidos = [...ev.target.files]; if (!escolhidos.length) return;
    const lidos = [], erros = [], substituidos = [];
    for (const arq of escolhidos) {
      try {
        const lido = lerArquivoPagamentos(await lerPlanilha(arq), $('tipo').value, arq.name);
        // Mesmo arquivo, ou a mesma conta no mesmo tipo de relatório: substitui em vez de somar duas vezes
        // (os arquivos já guardados no painel não entram aqui: o próprio servidor ignora o que for repetido)
        const repetido = a => !a.salvo && (a.nome === arq.name || (lido.conta && a.conta === lido.conta && a.origem === lido.origem));
        estado.arquivos.filter(repetido).forEach(a => { if (a.nome !== arq.name) substituidos.push(`${esc(a.nome)} (mesma conta ${esc(a.conta)})`); });
        estado.arquivos = estado.arquivos.filter(a => !repetido(a));
        estado.arquivos.push({ nome: arq.name, origem: lido.origem, conta: lido.conta, entradas: lido.entradas, ignoradas: lido.ignoradas });
        lidos.push(arq.name);
      } catch (err) { erros.push(`${esc(arq.name)}: ${esc(err.message)}`); }
    }
    // Guarda no painel: da próxima vez, a conciliação já usa sem escolher o arquivo
    const guardados = [];
    if (estado.extratosNoServidor !== false && estado.fonte === 'api') {
      for (const a of estado.arquivos.filter(x => !x.salvo && lidos.includes(x.nome))) {
        try {
          const r = await apiEnviar('/conciliacao/extratos', 'POST', {
            arquivo: a.nome, conta: a.conta || '', origem: a.origem,
            entradas: a.entradas.map(e => ({
              data: `${e.data.getFullYear()}-${String(e.data.getMonth() + 1).padStart(2, '0')}-${String(e.data.getDate()).padStart(2, '0')}`,
              valor: e.valor, desc: e.desc, nome: e.nome, doc: e.doc, chave: e.chave, agrupado: !!e.agrupado, pix: !!e.pix
            }))
          });
          const novos = r.novos === 1 ? '1 lançamento novo guardado' : `${r.novos.toLocaleString('pt-BR')} lançamentos novos guardados`;
          guardados.push(`${esc(a.nome)}: ${novos}${r.repetidos ? `, ${r.repetidos.toLocaleString('pt-BR')} já estavam no painel` : ''}`);
        } catch (err) {
          erros.push(`${esc(a.nome)}: não consegui guardar no painel (${esc(err.message)}); vale só nesta tela`);
        }
      }
      if (guardados.length) await carregarExtratosGuardados(); // passa a usar o que está guardado (só o mês escolhido)
    }
    juntarEntradas();
    const temBanco = estado.arquivos.some(a => a.origem !== 'rede'), temRede = estado.arquivos.some(a => a.origem === 'rede');
    const agrupados = estado.entradas.filter(e => e.agrupado).length;
    const ignoradas = estado.arquivos.reduce((s, a) => s + (a.ignoradas || 0), 0);
    let msg = `${(estado.entradas.length - agrupados).toLocaleString('pt-BR')} pagamentos de ${estado.arquivos.length} ${estado.arquivos.length === 1 ? 'arquivo' : 'arquivos'}.`;
    if (agrupados) msg += ` ${agrupados} lançamentos do extrato chegam somados no dia (boletos, Rede, PIX QRS) e ficam fora do confronto: o detalhe deles vem do relatório de boletos e da Rede.`;
    if (ignoradas) msg += ` ${ignoradas} linhas ignoradas (boletos não pagos, vendas negadas, expiradas ou canceladas).`;
    if (substituidos.length) msg += '<br>Substituí, para não contar em dobro: ' + substituidos.join('; ') + '.';
    if (temBanco && !temRede) msg += ' Títulos pagos em cartão ficam esperando o arquivo da Rede.';
    if (temRede && !temBanco) msg += ' Só os títulos de cartão entram até você adicionar o extrato do banco.';
    if (guardados.length) msg = 'Guardado no painel: ' + guardados.join('; ') + '. Da próxima vez, é só abrir o mês.<br>' + msg;
    if (erros.length) msg += '<br>Atenção: ' + erros.join('; ');
    aviso(msg, erros.length && !lidos.length);
    processar();
    ev.target.value = '';
  });
  $('limparArquivos').addEventListener('click', () => { limparArquivos(); aviso(''); processar(); });
  $('nomeArquivo').addEventListener('click', async ev => {
    const b = ev.target.closest('[data-remover]'); if (!b) return;
    const nome = b.dataset.remover;
    if (!confirm(`Tirar do painel todos os lançamentos do arquivo "${nome}" (de todos os meses)?`)) return;
    try {
      const r = await apiEnviar('/conciliacao/extratos?arquivo=' + encodeURIComponent(nome), 'DELETE');
      aviso(`Arquivo ${esc(nome)} removido: ${r.removidos.toLocaleString('pt-BR')} lançamentos.`);
      await carregarExtratosGuardados(); processar();
    } catch (err) { aviso('Não consegui remover: ' + esc(err.message), true); }
  });
  $('arquivoTitulos').addEventListener('change', async ev => {
    const arq = ev.target.files[0]; if (!arq) return;
    try {
      estado.titulos = lerPlanilhaTitulos(await lerPlanilha(arq)); estado.fonte = 'planilha';
      $('fonteTitulos').textContent = 'Títulos: planilha ' + arq.name;
      aviso(`${estado.titulos.length} títulos lidos da planilha.`); processar();
    } catch (err) { aviso(esc(err.message), true); }
    ev.target.value = '';
  });
  $('abas').addEventListener('click', ev => { const b = ev.target.closest('[data-aba]'); if (b) { estado.aba = b.dataset.aba; renderizar(); } });
  // Quadro de prova: clicar numa linha abre a lista; botão fecha ou reabre o mês
  $('fechamento').addEventListener('click', ev => {
    const ir = ev.target.closest('[data-ir]');
    if (ir) { estado.aba = ir.dataset.ir; renderizar(); $('abas').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (ev.target.closest('#fecharMes')) {
      if (lerFechamento()) {
        if (confirm('Reabrir o mês para continuar conciliando?')) { try { localStorage.removeItem(chaveFechamento()); } catch (e) {} renderizar(); }
        return;
      }
      const texto = $('fechamento').querySelector('.selo-alerta');
      let justificativa = '';
      if (texto) {
        justificativa = prompt('Ainda há valores sem explicação. Escreva a justificativa para fechar o mês assim (ou cancele):') || '';
        if (!justificativa.trim()) return;
      }
      const agora = new Date();
      try {
        localStorage.setItem(chaveFechamento(), JSON.stringify({
          em: agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          justificativa: justificativa.trim()
        }));
      } catch (e) {}
      renderizar();
    }
  });
  $('busca').addEventListener('input', renderizar);
  $('anteriores').addEventListener('change', renderizar);
  $('dias').addEventListener('change', () => { try { localStorage.setItem('conciliacao:dias', $('dias').value); } catch (e) {} renderizar(); });
  $('exportar').addEventListener('click', exportar);
  $('tabela').addEventListener('change', ev => {
    const s = ev.target.closest('[data-destino]');
    if (s) { salvarDestino(s.dataset.destino, s.value); s.classList.toggle('marcada', !!s.value); }
  });
  $('tabela').addEventListener('click', ev => {
    const c = ev.target.closest('[data-cliente]'); if (c) return abrirFicha(c.dataset.cliente);
    const ok = ev.target.closest('[data-confirmar]'), no = ev.target.closest('[data-recusar]');
    if (ok || no) {
      const id = (ok || no).dataset[ok ? 'confirmar' : 'recusar'];
      const par = estado.resultado.pares.find(p => p.entradaId === id);
      const d = lerDecisoesMes();
      if (ok) d.confirmados[id] = par.tituloIds; else d.rejeitados.push(id + '|' + par.tituloIds.join(','));
      salvarDecisoesMes(d); processar();
    }
  });
  $('ficha').addEventListener('click', ev => { if (ev.target.closest('#fecharFicha')) fecharFicha(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fecharFicha(); });

  $('formChave').addEventListener('submit', async ev => {
    ev.preventDefault();
    const chave = $('chave').value.trim(); if (!chave) return;
    $('avisoEntrada').innerHTML = '<p class="aviso">Conferindo a chave…</p>';
    const modo = await testarChave(chave);
    if (modo == null) { $('avisoEntrada').innerHTML = '<p class="aviso erro">Chave não aceita pela API.</p>'; return; }
    Acesso.chave = chave; Acesso.modo = modo; guardarAcesso();
    $('chave').value = ''; mostrarTela(); carregarDoBanco();
  });

  if (typeof XLSX === 'undefined') {
    mostrarTela();
    aviso('A biblioteca de Excel não carregou. Rode no terminal da API: npm install xlsx (veja as instruções da entrega) e reinicie.', true);
  }
  renderizar();
  iniciarAcesso().then(ok => { if (ok) { mostrarTela(); carregarDoBanco(); } else mostrarEntrada(); });
})();
