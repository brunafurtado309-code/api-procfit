// Tela inicial: um cartão para cada tela liberada, com o desenho do assunto (img/modulos/*.svg),
// o nome e o que tem nela. Os nomes e as descrições vêm de modulos.PAGINAS (js/modulos.js),
// então uma tela nova aparece aqui sozinha quando entra lá.

const el = (id) => document.getElementById(id);

function saudacao(nome) {
  const hora = new Date().getHours();
  const periodo = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  return nome ? `${periodo}, ${String(nome).split(' ')[0]}` : periodo;
}

function cartao(setor, pagina) {
  const link = document.createElement('a');
  link.className = 'inicio-cartao';
  link.href = pagina.pagina;

  const imagem = document.createElement('img');
  imagem.src = `img/modulos/${setor}.svg`;
  imagem.alt = '';
  imagem.loading = 'lazy';
  imagem.className = 'inicio-cartao__imagem';

  const titulo = document.createElement('h3');
  titulo.textContent = pagina.titulo;
  const descricao = document.createElement('p');
  descricao.textContent = pagina.descricao ?? '';
  const abrir = document.createElement('span');
  abrir.className = 'ver-detalhes';
  abrir.textContent = 'Abrir'; // a seta vem da classe ver-detalhes

  link.append(imagem, titulo, descricao, abrir);
  return link;
}

// Seletor de loja grande na tela inicial: o mesmo do menu da esquerda (andam juntos)
async function mostrarLoja() {
  const nota = el('inicio-loja-nota');
  const escrever = async () => {
    const nome = await modulos.nomeDaLoja();
    nota.textContent = nome ? `Todas as telas mostram só ${nome}.` : 'Todas as lojas somadas.';
  };
  el('inicio-loja').insertBefore(modulos.seletorDeLoja('seletor-loja seletor-loja--grande'), nota);
  modulos.aoMudarLoja(escrever); // aqui não precisa recarregar: só muda o aviso
  await escrever();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const setores = await modulos.setoresDaChave();
    modulos.desenharMenu(setores, 'inicio');
    mostrarLoja();
    el('inicio-cartoes').replaceChildren(...setores.map((s) => cartao(s, modulos.PAGINAS[s])));
    if (!setores.length) el('status').textContent = 'Nenhuma tela liberada ainda. Fale com a administradora do painel.';
  } catch (erro) {
    if (erro.chaveInvalida) {
      sessionStorage.removeItem('apiKey');
      window.location.href = 'login.html';
      return;
    }
    el('status').textContent = erro.message;
  }

  // Nome de quem entrou, para a saudação (sem o nome, fica só o "Bom dia")
  try {
    const resposta = await fetch('/auth/eu', { headers: { 'x-api-key': sessionStorage.getItem('apiKey') ?? '' } });
    const eu = resposta.ok ? await resposta.json() : null;
    el('inicio-saudacao').textContent = saudacao(eu?.nome);
  } catch (_) {
    el('inicio-saudacao').textContent = saudacao();
  }
});
