// Menu de módulos do painel, montado conforme a chave informada.
//
// A API diz em /acessos quais setores a chave abre:
//   - chave geral (administrador): aparecem todos os módulos, em abas no topo
//   - chave de um setor: abre direto aquele módulo, sem menu
//
// Usado pelas duas páginas (vendas e financeiro), por isso fica num arquivo só.

const modulos = (() => {
  const PAGINAS = {
    vendas: { titulo: 'Vendas', pagina: 'index.html' },
    financeiro: { titulo: 'Financeiro', pagina: 'financeiro.html' },
  };

  const lerChave = () => sessionStorage.getItem('apiKey') ?? '';

  async function setoresDaChave() {
    const resposta = await fetch('/acessos', { headers: { 'x-api-key': lerChave() } });
    if (resposta.status === 401) {
      const erro = new Error('Chave inválida');
      erro.chaveInvalida = true;
      throw erro;
    }
    if (!resposta.ok) throw new Error('Não foi possível conferir o acesso da chave');
    const { setores } = await resposta.json();
    return setores;
  }

  function irPara(setor) {
    window.location.href = PAGINAS[setor]?.pagina ?? 'index.html';
  }

  // Desenha as abas de módulo dentro do elemento #modulos (se existir na página).
  // Com um setor só, o menu não aparece: não há para onde navegar.
  function desenharMenu(setores, atual) {
    const area = document.getElementById('modulos');
    if (!area) return;

    if (setores.length < 2) {
      area.hidden = true;
      return;
    }

    area.hidden = false;
    area.replaceChildren(
      ...setores
        .filter((setor) => PAGINAS[setor])
        .map((setor) => {
          const item = document.createElement(setor === atual ? 'span' : 'a');
          item.className = setor === atual ? 'modulo modulo--ativo' : 'modulo';
          item.textContent = PAGINAS[setor].titulo;
          if (setor !== atual) item.href = PAGINAS[setor].pagina;
          return item;
        }),
    );
  }

  return { setoresDaChave, irPara, desenharMenu };
})();
