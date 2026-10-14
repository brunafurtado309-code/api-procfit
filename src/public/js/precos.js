// Tabela de preços: código, produto e preço de varejo, sempre como estão no PROCFIT.
// A pesquisa filtra na própria tela (a lista inteira já vem da API).

const el = (id) => document.getElementById(id);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  guardar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

let produtos = [];
let atualizadoEm = null;

// Sem acento e em minúsculas, para "acai" achar "AÇAÍ"
const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

async function chamar(caminho) {
  const resposta = await fetch(caminho, { headers: { 'x-api-key': chave.ler() ?? '' } });
  if (resposta.status === 401) {
    chave.apagar();
    window.location.reload();
    throw new Error('Chave inválida');
  }
  if (resposta.status === 403) throw new Error('Este acesso não tem a tabela de preços liberada.');
  return resposta;
}

async function carregar() {
  mostrarStatus('Carregando os preços…');
  try {
    const resposta = await chamar('/precos/varejo');
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro ?? 'Não foi possível carregar os preços.');
    produtos = corpo;
    atualizadoEm = new Date();
    mostrarLista();
    el('painel').hidden = false;
  } catch (erro) {
    mostrarStatus(erro.message, true);
  }
}

function mostrarLista() {
  const termo = normalizar(el('pesquisa-termo').value.trim());
  const itens = termo
    ? produtos.filter((p) => String(p.codigo) === termo || normalizar(p.produto).includes(termo))
    : produtos;

  const linhas = itens.map((p) => {
    const linha = document.createElement('tr');
    const codigo = document.createElement('td');
    codigo.className = 'esquerda';
    codigo.textContent = p.codigo;
    const nome = document.createElement('td');
    nome.className = 'esquerda';
    nome.textContent = p.produto;
    const preco = document.createElement('td');
    preco.className = 'coluna-final';
    preco.textContent = moeda.format(Number(p.preco) || 0);
    linha.append(codigo, nome, preco);
    return linha;
  });
  if (!linhas.length) {
    const linha = document.createElement('tr');
    const vazio = document.createElement('td');
    vazio.className = 'vazio';
    vazio.colSpan = 3;
    vazio.textContent = 'Nenhum produto encontrado.';
    linha.append(vazio);
    linhas.push(linha);
  }
  el('tabela-precos').tBodies[0].replaceChildren(...linhas);

  const total = produtos.length.toLocaleString('pt-BR');
  el('titulo-lista').textContent = termo
    ? `Produtos (${itens.length.toLocaleString('pt-BR')} de ${total})`
    : `Produtos (${total})`;
  const hora = atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  mostrarStatus(`preços atualizados às ${hora}`);
}

async function baixarExcel() {
  const botao = el('baixar-excel');
  botao.disabled = true;
  try {
    const resposta = await chamar('/precos/varejo/excel');
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível gerar a planilha.');
    }
    const nome = ((resposta.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1]
      || 'tabela_de_precos.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (erro) {
    mostrarStatus(`Excel: ${erro.message}`, true);
  } finally {
    botao.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!chave.ler()) {
    const informada = window.prompt('Informe a chave de acesso:');
    if (!informada) {
      mostrarStatus('É preciso entrar no painel para ver esta tela.', true);
      return;
    }
    chave.guardar(informada.trim());
  }
  try {
    modulos.desenharMenu(await modulos.setoresDaChave(), 'precos');
  } catch (erro) {
    if (erro.chaveInvalida) {
      chave.apagar();
      window.location.reload();
      return;
    }
  }

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    window.location.reload();
  });
  el('form-pesquisa').addEventListener('submit', (evento) => evento.preventDefault());
  el('pesquisa-termo').addEventListener('input', () => {
    el('limpar-pesquisa').hidden = el('pesquisa-termo').value.trim() === '';
    if (atualizadoEm) mostrarLista();
  });
  el('limpar-pesquisa').addEventListener('click', () => {
    el('pesquisa-termo').value = '';
    el('limpar-pesquisa').hidden = true;
    mostrarLista();
  });
  el('atualizar').addEventListener('click', carregar);
  el('baixar-excel').addEventListener('click', baixarExcel);

  carregar();
});
