// Painel de vendas: busca os dados na API e preenche a tela.

// ===== Formatação no padrão brasileiro =====
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const percentual = (valor) =>
  `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const NOMES_ORIGEM = { PDV: 'Caixa', NFE: 'Nota fiscal', OUTROS: 'Outros' };

const el = (id) => document.getElementById(id);

// Data de hoje no formato AAAA-MM-DD (horário local)
function formatarData(data) {
  const doisDigitos = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

// ===== Chave de acesso (guardada só enquanto a aba estiver aberta) =====
const chave = {
  ler: () => sessionStorage.getItem('apiKey'),
  salvar: (valor) => sessionStorage.setItem('apiKey', valor),
  apagar: () => sessionStorage.removeItem('apiKey'),
};

function mostrarEntrada() {
  el('painel').hidden = true;
  el('trocar-chave').hidden = true;
  el('form-chave').hidden = false;
  el('campo-chave').focus();
}

function mostrarPainel() {
  el('form-chave').hidden = true;
  el('painel').hidden = false;
  el('trocar-chave').hidden = false;
  carregar();
}

// ===== Comunicação com a API =====
class ChaveInvalida extends Error {}

async function buscar(rota, filtros) {
  const url = `/vendas/${rota}?${new URLSearchParams(filtros)}`;
  const resposta = await fetch(url, { headers: { 'x-api-key': chave.ler() } });
  const corpo = await resposta.json().catch(() => ({}));

  if (resposta.status === 401) throw new ChaveInvalida();
  if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível carregar os dados.');
  return corpo;
}

function mostrarStatus(texto, erro = false) {
  el('status').textContent = texto;
  el('status').classList.toggle('status--erro', erro);
}

// ===== Preenchimento da tela =====
function mostrarResumo(r) {
  el('venda-liquida').textContent = moeda.format(r.venda_liquida ?? 0);
  el('qtd-vendas').textContent = inteiro.format(r.qtd_vendas ?? 0);
  el('ticket').textContent = r.ticket_medio != null ? moeda.format(r.ticket_medio) : '—';
  el('desconto').textContent = moeda.format(r.desconto ?? 0);

  const nota = el('margem-nota');
  if (r.margem_pct == null) {
    el('margem').textContent = 'Sem custo';
    nota.textContent = 'Nenhuma venda do período tem custo cadastrado.';
    nota.classList.add('nota--alerta');
  } else {
    el('margem').textContent = percentual(r.margem_pct);
    nota.textContent = `Calculada sobre ${percentual(r.cobertura_custo_pct)} das vendas`;
    nota.classList.toggle('nota--alerta', r.cobertura_custo_pct < 100);
  }
}

function mostrarOrigens(origens) {
  // Só entram na barra as origens com venda positiva (devoluções ficam de fora)
  const positivas = origens.filter((o) => o.venda_liquida > 0);
  const total = positivas.reduce((soma, o) => soma + o.venda_liquida, 0);

  const barra = el('barra');
  const legenda = el('legenda');
  barra.replaceChildren();
  legenda.replaceChildren();

  for (const o of positivas) {
    const nome = NOMES_ORIGEM[o.origem] || o.origem;
    const classe = o.origem.toLowerCase();
    const participacao = total ? (o.venda_liquida / total) * 100 : 0;
    const cobertura = o.cobertura_custo_pct ?? 0;

    // Segmento da barra (largura = participação na venda)
    const segmento = document.createElement('div');
    segmento.className = `segmento segmento--${classe}`;
    segmento.style.width = `${participacao}%`;

    // Parte lisa dentro do segmento (largura = quanto tem custo)
    const parteComCusto = document.createElement('div');
    parteComCusto.className = 'segmento__custo';
    parteComCusto.style.width = `${cobertura}%`;
    segmento.append(parteComCusto);
    barra.append(segmento);

    // Legenda (textContent evita injeção de HTML vindo dos dados)
    const item = document.createElement('li');
    item.className = `legenda__item legenda__item--${classe}`;

    const titulo = document.createElement('strong');
    titulo.textContent = `${nome}: ${percentual(participacao)}`;

    const valor = document.createElement('span');
    valor.textContent = moeda.format(o.venda_liquida);

    const custo = document.createElement('span');
    custo.textContent = o.margem_pct != null
      ? `Margem de ${percentual(o.margem_pct)} (custo em ${percentual(cobertura)} das vendas)`
      : 'Sem custo cadastrado';

    item.append(titulo, valor, custo);
    legenda.append(item);
  }
}

async function carregar() {
  const filtros = { inicio: el('inicio').value, fim: el('fim').value };
  mostrarStatus('Carregando…');

  try {
    // As duas consultas rodam ao mesmo tempo
    const [resumo, origens] = await Promise.all([
      buscar('resumo', filtros),
      buscar('por-origem', filtros),
    ]);
    mostrarResumo(resumo);
    mostrarOrigens(origens);
    mostrarStatus(`Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`);
  } catch (erro) {
    if (erro instanceof ChaveInvalida) {
      chave.apagar();
      mostrarEntrada();
      mostrarStatus('');
      alert('Chave de acesso inválida. Informe a chave novamente.');
      return;
    }
    console.error(erro);
    mostrarStatus(erro.message, true);
  }
}

// ===== Início =====
document.addEventListener('DOMContentLoaded', () => {
  const hoje = new Date();
  el('inicio').value = formatarData(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  el('fim').value = formatarData(hoje);

  el('form-chave').addEventListener('submit', (evento) => {
    evento.preventDefault();
    chave.salvar(el('campo-chave').value.trim());
    el('campo-chave').value = '';
    mostrarPainel();
  });

  el('filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregar();
  });

  el('trocar-chave').addEventListener('click', () => {
    chave.apagar();
    mostrarEntrada();
  });

  if (chave.ler()) mostrarPainel();
  else mostrarEntrada();
});
