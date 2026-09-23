// Lembra os filtros de cada tela enquanto a aba do navegador estiver aberta.
// Assim, ao entrar num cliente ou num pedido e voltar, a tela volta como estava.
// Guardado em sessionStorage: some ao fechar a aba, e não vai para o servidor.

const estado = (() => {
  const chaveDe = (pagina) => `painel:${pagina}`;

  function ler(pagina) {
    try {
      return JSON.parse(sessionStorage.getItem(chaveDe(pagina)) ?? '{}');
    } catch {
      return {};
    }
  }

  function salvar(pagina, valores) {
    try {
      const limpo = Object.fromEntries(
        Object.entries(valores).filter(([, v]) => v !== null && v !== undefined && v !== ''),
      );
      sessionStorage.setItem(chaveDe(pagina), JSON.stringify(limpo));
    } catch {
      // se o navegador não deixar guardar, a tela funciona igual, só não lembra
    }
  }

  // Preenche campos de tela (input/select) com o que estava guardado
  function aplicarCampos(pagina, mapa) {
    const guardado = ler(pagina);
    for (const [chave, id] of Object.entries(mapa)) {
      const campo = document.getElementById(id);
      if (campo && guardado[chave] !== undefined) campo.value = guardado[chave];
    }
    return guardado;
  }

  return { ler, salvar, aplicarCampos };
})();
