// Paginação no padrão de ERP, igual em todas as telas: linhas por página, "1-20 de 274 registros"
// e as páginas (« ‹ 1 2 3 4 5 … 14 › »).
//
// Uso:
//   paginacao.desenhar(document.getElementById('meu-paginador'), {
//     total: 274, pagina: 1, porPagina: 20,
//     aoMudar: ({ pagina, porPagina }) => { ... desenha a lista de novo ... },
//   });
//   paginacao.lembrar('produtos', 20)   // linhas por página guardadas neste navegador (ou o padrão)
//   paginacao.guardar('produtos', 50)
//
// O elemento recebe a classe .paginador (estilo na seção 24 do style.css).

const paginacao = (() => {
  const OPCOES = [10, 20, 50, 100];
  const PAGINAS_EM_VOLTA = 2; // quantas páginas aparecem de cada lado da atual

  const inteiro = (v) => new Intl.NumberFormat('pt-BR').format(Number(v) || 0);

  // Guardar a escolha é só conforto: se o navegador bloquear, segue com o padrão
  function lembrar(nome, padrao = 20) {
    try {
      const valor = Number(localStorage.getItem(`paginacao:${nome}`));
      return OPCOES.includes(valor) ? valor : padrao;
    } catch (_) {
      return padrao;
    }
  }
  function guardar(nome, porPagina) {
    try { localStorage.setItem(`paginacao:${nome}`, String(porPagina)); } catch (_) { /* sem problema */ }
  }

  // Páginas que aparecem: a primeira, a última e as vizinhas da atual; o resto vira "…"
  function paginasVisiveis(atual, total) {
    const lista = [];
    for (let p = 1; p <= total; p += 1) {
      if (p === 1 || p === total || Math.abs(p - atual) <= PAGINAS_EM_VOLTA) lista.push(p);
      else if (lista[lista.length - 1] !== '…') lista.push('…');
    }
    return lista;
  }

  function desenhar(alvo, { total, pagina, porPagina, opcoes = OPCOES, aoMudar }) {
    alvo.classList.add('paginador');
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const atual = Math.min(Math.max(1, pagina), paginas);
    const ir = (nova, novoPorPagina = porPagina) => aoMudar({ pagina: nova, porPagina: novoPorPagina });

    const seletor = document.createElement('select');
    seletor.setAttribute('aria-label', 'Linhas por página');
    for (const n of opcoes) seletor.append(new Option(String(n), String(n), false, n === porPagina));
    seletor.addEventListener('change', () => ir(1, Number(seletor.value)));

    const primeiro = total ? (atual - 1) * porPagina + 1 : 0;
    const ultimo = Math.min(atual * porPagina, total);
    const contagem = document.createElement('span');
    contagem.textContent = `${inteiro(primeiro)}-${inteiro(ultimo)} de ${inteiro(total)} registros`;

    const navegacao = document.createElement('nav');
    navegacao.className = 'paginador__paginas';
    navegacao.setAttribute('aria-label', 'Páginas');
    const botao = (texto, destino, rotulo, desligado, atualClasse = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = texto;
      b.disabled = desligado;
      if (rotulo) b.setAttribute('aria-label', rotulo);
      if (atualClasse) {
        b.className = 'paginador__atual';
        b.setAttribute('aria-current', 'page');
      }
      b.addEventListener('click', () => ir(destino));
      return b;
    };
    navegacao.append(
      botao('«', 1, 'Primeira página', atual === 1),
      botao('‹', atual - 1, 'Página anterior', atual === 1),
      ...paginasVisiveis(atual, paginas).map((p) => {
        if (p === '…') {
          const r = document.createElement('span');
          r.className = 'paginador__reticencias';
          r.textContent = '…';
          return r;
        }
        return botao(String(p), p, `Página ${p}`, false, p === atual);
      }),
      botao('›', atual + 1, 'Próxima página', atual === paginas),
      botao('»', paginas, 'Última página', atual === paginas),
    );

    alvo.replaceChildren(seletor, contagem, navegacao);
    alvo.hidden = total === 0;
    return atual;
  }

  return { desenhar, lembrar, guardar, OPCOES };
})();
