/* =========================================================================
   MOTOR DE CONCILIAÇÃO DE TÍTULOS — api-procfit
   Regras (combinadas com a Bruna):
     Nível 1  Chave exata (nosso número, NSU/autorização, pedido/parcela) -> automático
     Nível 2  CPF/CNPJ + valor + data próxima                           -> automático
     Nível 2b CPF/CNPJ + várias parcelas somando o valor                 -> sugestão
     Nível 2c CPF/CNPJ + data próxima, valor diferente (até 10%)         -> com diferença
     Nível 3  Nome parecido + valor + data                               -> sugestão
     Nível 4  Só valor + data bem próxima                                -> sugestão fraca
   Parcelas: sempre a mais antiga primeiro (ordem de vencimento).
   ========================================================================= */
(function (root) {
  'use strict';

  // ---------- parâmetros que o financeiro pode ajustar ----------
  const CONFIG = {
    tolerancia: 0.05,          // diferença de centavos aceita como "igual"
    diferencaMaxima: 0.10,     // até 10% vira "conciliado com diferença" (mesmo CPF/CNPJ)
    janela: {                  // dias aceitos entre a data do título e a do arquivo
      banco: { antes: 2, depois: 5 },
      rede:  { antes: 3, depois: 3 }
    },
    similaridadeNome: 0.6,     // 0 a 1 — quanto do nome precisa bater
    maxParcelasCombinadas: 4   // pagamento agrupado: até 4 parcelas num valor só
  };

  // ---------- utilitários ----------
  const DIA = 86400000;
  const soDigitos = s => String(s == null ? '' : s).replace(/\D/g, '');
  const dias = (a, b) => Math.round((a - b) / DIA);
  const igual = (a, b) => Math.abs(a - b) <= CONFIG.tolerancia;
  const arred = v => Math.round(v * 100) / 100;

  const PALAVRAS_IGNORADAS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'MEI', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'COMERCIO', 'CIA']);
  function normNome(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/).filter(p => p.length > 1 && !PALAVRAS_IGNORADAS.has(p));
  }
  function similaridade(a, b) {
    const A = new Set(normNome(a)), B = new Set(normNome(b));
    if (!A.size || !B.size) return 0;
    let comuns = 0;
    A.forEach(p => { if (B.has(p)) comuns++; });
    return comuns / Math.max(A.size, B.size);
  }

  // Traduz o texto do extrato ou do sistema para uma forma de pagamento padrão
  function classeForma(texto) {
    const s = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (!s.trim()) return null;
    if (/PIX/.test(s)) return 'PIX';
    if (/EM CONTA|DEB(ITO)? AUT/.test(s)) return 'Débito em conta';
    if (/CARTAO|CRED|DEB|REDE|CIELO|STONE|GETNET|MAQUIN/.test(s)) return 'Cartão';
    if (/BOLETO|COBRANCA|LIQUIDAC|TITULO/.test(s)) return 'Boleto';
    if (/TED|DOC|TRANSF|TEF/.test(s)) return 'Transferência';
    if (/DINHEIRO|DEPOSITO|ESPECIE/.test(s)) return 'Dinheiro/depósito';
    return null;
  }

  function ehCartao(t) {
    return classeForma(t.forma) === 'Cartão';
  }

  // Valores que podem aparecer no arquivo para esse título
  function valoresDoTitulo(t) {
    const v = [];
    if (t.pago > 0) v.push({ valor: t.pago, tipo: 'baixado' });
    if (t.pendente > 0) v.push({ valor: t.pendente, tipo: 'aberto' });
    return v;
  }

  function dataRef(t) { return t.dtPag || t.venc; }

  // Data do arquivo é compatível com o título?
  function dataCompativel(t, e, solta) {
    const janela = CONFIG.janela[e.origem] || CONFIG.janela.banco;
    const d = dias(e.data, dataRef(t));
    if (d >= -janela.antes && d <= janela.depois) return true;
    // título em aberto pago com atraso: vale qualquer data depois do vencimento (só nos níveis com CPF/nome)
    if (solta && !t.dtPag && e.data >= new Date(t.venc.getTime() - janela.antes * DIA)) return true;
    return false;
  }

  function combinacoes(lista, alvo, max) {
    const achadas = [];
    function busca(inicio, escolhidos, soma) {
      if (achadas.length) return;
      if (escolhidos.length >= 2 && igual(soma, alvo)) { achadas.push(escolhidos.slice()); return; }
      if (escolhidos.length >= max || soma > alvo + CONFIG.tolerancia) return;
      for (let i = inicio; i < lista.length; i++) {
        escolhidos.push(lista[i]);
        busca(i + 1, escolhidos, soma + lista[i].pendenteOuPago);
        escolhidos.pop();
      }
    }
    busca(0, [], 0);
    return achadas[0] || null;
  }

  /* -----------------------------------------------------------------------
     conciliar(titulos, entradas, opcoes)
       titulos:  [{ id, pedido, nf, parcela, cod, nome, doc, venc, valor, pago,
                    pendente, dtPag, conta, forma, faturado, nossoNumero, nsu }]
       entradas: [{ id, data, valor, desc, nome, doc, chave, origem:'banco'|'rede', arquivo }]
                 (pode misturar vários extratos e o arquivo da Rede no mesmo mês)
       opcoes:   { mes:'2026-09', hoje:Date,
                   confirmados:{ entradaId:[tituloIds] }, rejeitados:['entradaId|t1,t2'] }
     ----------------------------------------------------------------------- */
  function conciliar(titulos, todasEntradas, opcoes) {
    todasEntradas.forEach(e => { if (!e.origem) e.origem = 'banco'; });
    // Lançamentos somados no dia (boletos, Rede, PIX QRS) não casam com um título sozinho: ficam fora do confronto
    const entradas = todasEntradas.filter(e => !e.agrupado);
    // Quais tipos de arquivo foram carregados. Relatório de boletos conta como banco (é dinheiro que caiu na conta).
    const origens = new Set(entradas.map(e => e.origem === 'rede' ? 'rede' : 'banco'));
    const hoje = opcoes.hoje || new Date();
    const [ano, mes] = opcoes.mes.split('-').map(Number);
    const inicioMes = new Date(ano, mes - 1, 1);
    const fimMes = new Date(ano, mes, 1);
    const noMes = d => d && d >= inicioMes && d < fimMes;
    const confirmados = opcoes.confirmados || {};
    const rejeitados = new Set(opcoes.rejeitados || []);

    // Quem entra no confronto com esse arquivo
    titulos.forEach(t => {
      t.status = null; t.par = null; t._usado = false;
      const caixaInterno = /INTERNO/i.test(t.conta || '');
      if (caixaInterno) t.fora = 'caixa_interno';
      else if (ehCartao(t) && !origens.has('rede')) t.fora = 'outro_arquivo';   // cartão cai no banco em lote da Rede
      else if (!ehCartao(t) && !origens.has('banco')) t.fora = 'outro_arquivo';
      else t.fora = null;
    });
    const elegiveis = titulos.filter(t => !t.fora);
    const porId = new Map(titulos.map(t => [String(t.id), t]));
    const pares = [];

    function registrar(e, lista, nivel, tipo, motivo) {
      const soma = lista.reduce((s, t) => s + (t.pendenteOuPago || 0), 0);
      const par = {
        entradaId: e.id, tituloIds: lista.map(t => String(t.id)), nivel, tipo, motivo,
        diferenca: arred(e.valor - soma)
      };
      pares.push(par);
      e.par = par;
      lista.forEach(t => { t._usado = true; t.par = par; });
    }
    const foiRejeitado = (e, lista) => rejeitados.has(e.id + '|' + lista.map(t => t.id).join(','));

    function casaValor(t, valor) {
      const v = valoresDoTitulo(t).find(x => igual(x.valor, valor));
      if (v) { t.pendenteOuPago = v.valor; return true; }
      return false;
    }
    function prepara(t) { t.pendenteOuPago = t.pago > 0 ? t.pago : t.pendente; return t; }
    const porVencimento = (a, b) => a.venc - b.venc;

    // ---------- índices (para não percorrer todos os títulos a cada linha do extrato) ----------
    const semZeros = x => soDigitos(x).replace(/^0+/, '');
    const porDoc = new Map(), porCentavos = new Map(), porChave = new Map(), porPedidoParcela = new Map();
    const juntar = (mapa, chave, t) => { let l = mapa.get(chave); if (!l) mapa.set(chave, l = []); l.push(t); };
    elegiveis.forEach((t, i) => {
      t._ordem = i;
      t._cartao = ehCartao(t);
      t._pix = classeForma(t.forma) === 'PIX';
      t._doc = soDigitos(t.doc);
      t._palavras = null; // calculadas só se precisar (nível 3)
      if (t._doc.length >= 11) juntar(porDoc, t._doc, t);
      valoresDoTitulo(t).forEach(v => juntar(porCentavos, Math.round(v.valor * 100), t));
      [t.nossoNumero, t.nsu].forEach(c => { const k = soDigitos(c); if (k.length >= 4) juntar(porChave, k, t); });
      if (t.pedido && t.parcela) juntar(porPedidoParcela, semZeros(t.pedido) + '/' + semZeros(t.parcela), t);
    });
    const passo = Math.round(CONFIG.tolerancia * 100);
    function pelosValores(valor) {
      const c = Math.round(valor * 100), achados = new Set();
      for (let k = c - passo; k <= c + passo; k++) (porCentavos.get(k) || []).forEach(t => achados.add(t));
      return [...achados];
    }
    // Título ainda livre e do tipo certo para essa entrada (cartão só com a Rede, o resto só com o banco)
    // Título ainda livre e do tipo certo para essa entrada:
    // cartão só com a Rede; PIX feito na maquininha (Rede) também casa com título em PIX; o resto só com banco/boletos
    const livre = (t, e) => !t._usado && (e.origem === 'rede' ? (t._cartao || (e.pix && t._pix)) : !t._cartao);
    const palavras = nome => new Set(normNome(nome));
    function similaridadePalavras(A, B) {
      if (!A.size || !B.size) return 0;
      let comuns = 0; A.forEach(p => { if (B.has(p)) comuns++; });
      return comuns / Math.max(A.size, B.size);
    }

    entradas.forEach(e => { e.par = null; });

    // 0) O que a Bruna já confirmou antes
    entradas.forEach(e => {
      const ids = confirmados[e.id];
      if (!ids) return;
      const lista = ids.map(id => porId.get(String(id))).filter(t => t && !t._usado);
      if (lista.length === ids.length) { lista.forEach(prepara); registrar(e, lista, 0, 'confirmado', 'Confirmado por você'); }
    });

    // 1) Chave exata
    entradas.filter(e => !e.par).forEach(e => {
      // candidatos pela chave (nosso número / NSU) e pelo pedido/parcela escrito na descrição
      const cands = new Set(porChave.get(soDigitos(e.chave)) || []);
      const texto = String(e.desc || '') + ' ' + String(e.chave || '');
      const re = /(\d+)\s*[\/-]\s*0*(\d+)/g; let m;
      while ((m = re.exec(texto))) (porPedidoParcela.get(semZeros(m[1]) + '/' + semZeros(m[2])) || []).forEach(t => cands.add(t));
      const t = [...cands].filter(t => livre(t, e)).sort((a, b) => a._ordem - b._ordem)[0];
      if (t) { prepara(t); registrar(e, [t], 1, 'auto', 'Chave igual (nosso número / NSU / pedido-parcela)'); }
    });

    // 2) CPF/CNPJ + valor + data
    entradas.filter(e => !e.par && soDigitos(e.doc).length >= 11).forEach(e => {
      const cands = (porDoc.get(soDigitos(e.doc)) || []).filter(t => livre(t, e) && casaValor(t, e.valor) && dataCompativel(t, e, true)).sort(porVencimento);
      if (cands.length) registrar(e, [cands[0]], 2, 'auto', 'Mesmo CPF/CNPJ, mesmo valor, data compatível');
    });

    // 2b) Pagamento agrupado (várias parcelas do mesmo CPF/CNPJ)
    entradas.filter(e => !e.par && soDigitos(e.doc).length >= 11).forEach(e => {
      const cands = (porDoc.get(soDigitos(e.doc)) || []).filter(t => livre(t, e) && dataCompativel(t, e, true))
        .map(prepara).sort(porVencimento).slice(0, 12);
      const combo = combinacoes(cands, e.valor, CONFIG.maxParcelasCombinadas);
      if (combo && !foiRejeitado(e, combo)) registrar(e, combo, 2, 'sugerido', combo.length + ' parcelas do mesmo cliente somam o valor');
    });

    // 2c) Mesmo CPF/CNPJ, valor diferente (juros, desconto, taxa)
    entradas.filter(e => !e.par && soDigitos(e.doc).length >= 11).forEach(e => {
      const cands = (porDoc.get(soDigitos(e.doc)) || []).filter(t => livre(t, e) && dataCompativel(t, e, false)).map(prepara)
        .filter(t => Math.abs(t.pendenteOuPago - e.valor) <= t.pendenteOuPago * CONFIG.diferencaMaxima)
        .sort((a, b) => Math.abs(a.pendenteOuPago - e.valor) - Math.abs(b.pendenteOuPago - e.valor));
      if (cands.length) {
        const dif = arred(e.valor - cands[0].pendenteOuPago);
        registrar(e, [cands[0]], 2, 'diferenca', dif > 0 ? 'Valor maior — provável juros/multa' : 'Valor menor — provável desconto ou taxa');
      }
    });

    // 3) Nome parecido + valor + data
    entradas.filter(e => !e.par && (e.nome || e.desc)).forEach(e => {
      const pe = palavras(e.nome || e.desc);
      const cands = pelosValores(e.valor)
        .filter(t => livre(t, e) && casaValor(t, e.valor) && dataCompativel(t, e, true))
        .map(t => { if (!t._palavras) t._palavras = palavras(t.nome); return { t, s: similaridadePalavras(pe, t._palavras) }; })
        .filter(x => x.s >= CONFIG.similaridadeNome && !foiRejeitado(e, [x.t]))
        .sort((a, b) => b.s - a.s || a.t.venc - b.t.venc);
      if (cands.length) { casaValor(cands[0].t, e.valor); registrar(e, [cands[0].t], 3, 'sugerido', 'Nome parecido (' + Math.round(cands[0].s * 100) + '%) e mesmo valor'); }
    });

    // 4) Só valor + data bem próxima (nunca automático)
    // Quantas sugestões cada entrada já teve recusadas (para contar os candidatos sem montar texto à toa)
    const recusasPorEntrada = new Map();
    rejeitados.forEach(r => { const id = r.slice(0, r.lastIndexOf('|')); recusasPorEntrada.set(id, (recusasPorEntrada.get(id) || 0) + 1); });
    entradas.filter(e => !e.par).forEach(e => {
      let cands = pelosValores(e.valor).filter(t => livre(t, e) && casaValor(t, e.valor) && dataCompativel(t, e, false));
      if (!cands.length || cands.length > 3 + (recusasPorEntrada.get(e.id) || 0)) return; // valor comum demais: não dá para sugerir
      cands = cands.filter(t => !foiRejeitado(e, [t]))
        .sort((a, b) => Math.abs(dias(e.data, dataRef(a))) - Math.abs(dias(e.data, dataRef(b))));
      if (cands.length >= 1 && cands.length <= 3) {
        casaValor(cands[0], e.valor);
        registrar(e, [cands[0]], 4, 'sugerido', 'Só o valor bate' + (cands.length > 1 ? ' (há ' + cands.length + ' títulos possíveis)' : '') + ' — confira');
      }
    });

    // ---------- status dos títulos ----------
    titulos.forEach(t => {
      if (t.par) {
        if (t.par.tipo === 'sugerido') t.status = 'sugerido';
        else if (!(t.pago > 0)) t.status = 'sem_baixa';            // dinheiro entrou, sistema não baixou
        else if (t.par.tipo === 'diferenca') t.status = 'diferenca';
        else t.status = 'conciliado';
      } else if (t.fora === 'caixa_interno' && t.pago > 0) t.status = 'caixa_interno';
      else if (t.fora === 'outro_arquivo' && t.pendente <= 0) t.status = 'outro_arquivo';
      else if (!t.fora && t.pago > 0 && noMes(t.dtPag)) t.status = 'baixado_sem_entrada';
      else if (t.pendente > 0) t.status = t.venc < hoje ? 'vencido' : 'a_vencer';
      else t.status = 'pago_outro_mes';
      t.doMes = noMes(t.venc);
    });
    entradas.forEach(e => {
      e.status = e.par ? (e.par.tipo === 'sugerido' ? 'sugerido' : 'conciliado')
        : e.origem === 'rede' ? 'venda_sem_titulo'   // venda de balcão na maquininha: normal não ter título
        : 'sem_titulo';
    });
    todasEntradas.forEach(e => { if (e.agrupado) { e.par = null; e.status = 'agrupado'; } });

    // ---------- rastreio da forma de pagamento ----------
    // Quando o dinheiro bateu, compara a forma real (do arquivo) com a forma lançada no sistema.
    const entradaPorId = new Map(entradas.map(e => [e.id, e]));
    titulos.forEach(t => {
      t.formaArquivo = null; t.formaProblema = null;
      if (!t.par || t.par.tipo === 'sugerido' || !(t.pago > 0)) return;
      const e = entradaPorId.get(t.par.entradaId);
      t.formaArquivo = !e ? null : e.origem === 'rede' ? (e.pix ? 'PIX' : 'Cartão') : e.origem === 'boletos' ? 'Boleto' : classeForma(e.desc || '');
      const formaSistema = classeForma(t.forma);
      if (!String(t.forma || '').trim()) t.formaProblema = 'vazia';
      else if (t.formaArquivo && formaSistema && t.formaArquivo !== formaSistema) t.formaProblema = 'divergente';
    });

    // ---------- fechamento do mês ----------
    const soma = (lista, f) => arred(lista.reduce((s, x) => s + (f(x) || 0), 0));
    const doMes = titulos.filter(t => t.doMes);
    const resumo = {
      esperado: soma(doMes, t => t.valor),
      recebidoArquivo: soma(entradas, e => e.valor),   // sem os lançamentos somados, para não contar boleto e Rede em dobro
      conciliado: soma(entradas.filter(e => e.status === 'conciliado'), e => e.valor),
      emAberto: soma(doMes, t => t.pendente),
      semExplicacao: arred(
        soma(entradas.filter(e => e.status === 'sem_titulo'), e => e.valor) +
        soma(titulos.filter(t => t.status === 'baixado_sem_entrada'), t => t.pago))
    };

    return { titulos, entradas: todasEntradas, pares, resumo };
  }

  const api = { conciliar, CONFIG, similaridade, soDigitos, classeForma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MotorConciliacao = api;
})(typeof window !== 'undefined' ? window : globalThis);
