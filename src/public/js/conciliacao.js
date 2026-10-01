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
  const estado = { titulos: [], entradas: [], arquivos: [], pedidosBanco: null, resultado: null, aba: 'confirmar', fonte: 'api' };

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
      aviso(estado.entradas.length ? '' : 'Títulos carregados. Agora escolha o arquivo do banco ou da Rede para conciliar.');
    } catch (err) {
      if (err.message === 'acesso') return;
      estado.titulos = [];
      aviso(esc(err.message) + ' Enquanto isso, dá para usar "Usar títulos de uma planilha" com a exportação do SSMS.', true);
    }
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
      conciliados: r.titulos.filter(t => (t.status === 'conciliado' || t.status === 'diferenca') && !t.formaProblema),
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
  // [chave, nome, grupo]
  const ABAS = [
    ['confirmar', 'Para confirmar', 'Conferir'],
    ['conciliados', 'Conciliados', 'Está certo'],
    ['faltaBaixar', 'Falta baixar', 'Acertar no sistema'],
    ['corrigirForma', 'Corrigir forma de pagamento', 'Acertar no sistema'],
    ['semDinheiro', 'Baixado sem dinheiro no banco', 'Investigar'],
    ['semTitulo', 'Entradas sem título', 'Investigar'],
    ['vencidas', 'Notas vencidas: cobrar ou cancelar', 'Decidir'],
    ['aVencer', 'Notas a vencer', 'Decidir'],
    ['pedidos', 'Pedidos sem nota: cancelar?', 'Decidir'],
    ['somados', 'Somados no dia (boletos, Rede, PIX QRS)', 'Informativo'],
    ['balcao', 'Vendas de balcão na Rede', 'Informativo'],
    ['todos', 'Todos os títulos', '']
  ];
  const ABAS_COM_DECISAO = ['semDinheiro', 'vencidas', 'aVencer', 'corrigirForma', 'faltaBaixar'];

  /* ---------------- desenho ---------------- */
  function renderizar() {
    const r = estado.resultado;
    const res = r ? r.resumo : { esperado: 0, recebidoArquivo: 0, conciliado: 0, emAberto: 0, semExplicacao: 0 };
    $('fechamento').innerHTML = `
      <div><span>Esperado no mês</span><strong>${brl(res.esperado)}</strong></div>
      <div><span>Recebido no arquivo</span><strong>${brl(res.recebidoArquivo)}</strong></div>
      <div><span>Conciliado</span><strong>${brl(res.conciliado)}</strong></div>
      <div><span>Em aberto no mês</span><strong>${brl(res.emAberto)}</strong></div>
      <div class="${res.semExplicacao > 0 ? 'ruim' : ''}"><span>Sem explicação</span><strong>${brl(res.semExplicacao)}</strong></div>`;

    const L = listas();
    $('abas').innerHTML = ABAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${estado.aba === k}" data-aba="${k}">${n}<b>${L[k] ? L[k].length : 0}</b></button>`).join('');
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
            <td class="motivo">${esc(p.motivo)}${p.diferenca ? '<br>Diferença: ' + brl(p.diferenca) : ''}</td>
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
      html = (explica ? `<p class="aviso">${explica}</p>` : '') + `<table><thead><tr><th>Data</th><th class="num">Valor</th><th>Quem pagou</th><th>CPF/CNPJ</th><th>Descrição</th><th>Arquivo</th>${estado.aba === 'semTitulo' ? '<th>Decisão</th>' : ''}</tr></thead><tbody>` +
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
          <td><span class="status ${cls}">${nome}</span>${t.par && t.par.motivo ? `<div class="motivo">${esc(t.par.motivo)}</div>` : ''}${detalheEntrada(t)}${t.origem && t.origem !== 'Nota fiscal' ? `<div class="motivo">${esc(t.origem)}</div>` : ''}</td>
          ${comDecisao ? `<td>${seletor('T:' + t.id, destinos)}</td>` : ''}</tr>`;
      }).join('') + '</tbody></table>';
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
    aba('Falta baixar', L.faltaBaixar.map(linhaT));
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
          return `${esc(a.nome)} <span style="opacity:.7">(${tipo}${a.conta ? ' conta ' + esc(a.conta) : ''}, ${a.entradas.length - agrup}${agrup ? ' + ' + agrup + ' somados no dia' : ''})</span>`;
        }).join('<br>')
      : 'Nenhum arquivo escolhido';
    if (n > 1) $('nomeArquivo').innerHTML = `<details><summary>${n} arquivos carregados · ${(estado.entradas.filter(e => !e.agrupado).length).toLocaleString('pt-BR')} pagamentos</summary>${$('nomeArquivo').innerHTML}</details>`;
    $('limparArquivos').hidden = !n;
  }
  function limparArquivos() { estado.arquivos = []; juntarEntradas(); }

  $('arquivo').addEventListener('change', async ev => {
    const escolhidos = [...ev.target.files]; if (!escolhidos.length) return;
    const lidos = [], erros = [], substituidos = [];
    for (const arq of escolhidos) {
      try {
        const lido = lerArquivoPagamentos(await lerPlanilha(arq), $('tipo').value, arq.name);
        // Mesmo arquivo, ou a mesma conta no mesmo tipo de relatório: substitui em vez de somar duas vezes
        const repetido = a => a.nome === arq.name || (lido.conta && a.conta === lido.conta && a.origem === lido.origem);
        estado.arquivos.filter(repetido).forEach(a => { if (a.nome !== arq.name) substituidos.push(`${esc(a.nome)} (mesma conta ${esc(a.conta)})`); });
        estado.arquivos = estado.arquivos.filter(a => !repetido(a));
        estado.arquivos.push({ nome: arq.name, origem: lido.origem, conta: lido.conta, entradas: lido.entradas, ignoradas: lido.ignoradas });
        lidos.push(arq.name);
      } catch (err) { erros.push(`${esc(arq.name)}: ${esc(err.message)}`); }
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
    if (erros.length) msg += '<br>Não consegui ler: ' + erros.join('; ');
    aviso(msg, erros.length && !lidos.length);
    processar();
    ev.target.value = '';
  });
  $('limparArquivos').addEventListener('click', () => { limparArquivos(); aviso(''); processar(); });
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
