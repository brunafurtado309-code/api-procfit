// Painel da Precificação. Cada passo da construção acrescenta uma parte da tela aqui.

const el = (id) => document.getElementById(id);
const inteiro = new Intl.NumberFormat('pt-BR');

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// Chama a API com a chave do login; trata "sem login" e "sem acesso" num lugar só
async function chamar(caminho) {
  const resposta = await fetch(caminho, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.reload();
    throw new Error('Login expirado');
  }
  if (resposta.status === 403) throw new Error('Este acesso não tem a tela de precificação liberada.');
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar.');
  return corpo;
}

async function carregar() {
  mostrarStatus('Lendo o PROCFIT…');
  try {
    const dados = await chamar('/precificacao/inicio');
    el('num-produtos').textContent = inteiro.format(dados.produtos ?? 0);
    el('num-industrializados').textContent = inteiro.format(dados.industrializados ?? 0);
    el('num-insumos').textContent = inteiro.format(dados.insumos ?? 0);
    el('bloco-cadastro').hidden = false;
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    mostrarStatus(`atualizado às ${hora}`);
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'precificacao');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.reload();
      return;
    }
  }
  el('atualizar').addEventListener('click', carregar);
  carregar();
});
