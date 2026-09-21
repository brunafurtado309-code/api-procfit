# Padrão visual do painel Belo Norte

Este arquivo vale para **todas as telas** do painel (vendas, financeiro e as que vierem).
Antes de criar ou mudar uma tela, leia aqui. Todo o visual fica em `src/public/css/style.css`,
e as cores, letras e medidas estão nas variáveis do topo dele (seção 1). Tela nova não cria
cor nem tamanho próprio: usa as variáveis.

## Princípios

1. **Página aberta, sem caixas.** Seções são separadas por uma linha fina (`--linha`) e
   respiro (`--respiro-secao`). Nada de cartão branco com sombra em volta de cada bloco.
2. **Caixa só onde se clica.** Os únicos elementos com borda em volta são os cartões que
   filtram (`.cartao`), a tela de entrada e as janelas (`.detalhe`).
3. **Só verdes.** Uma família de cor: `--verde-escuro`, `--verde`, `--verde-medio`,
   `--verde-vivo`, `--verde-claro`, `--verde-suave`. Quando precisar de duas séries num
   gráfico, use `--verde` e `--verde-vivo`.
4. **Laranja é só alerta.** `--alerta` aparece apenas para atraso, valor negativo e desconto.
5. **Letra legível.** Texto de leitura nunca abaixo de `--texto-mini` (13px). Corpo em 16px,
   título de seção em `--texto-titulo` (20px).
6. **Largura cheia.** O conteúdo usa até `--largura` (1600px), com a mesma margem lateral
   em todas as telas.

## Estrutura de uma tela

```
<header class="topo">          faixa verde fina: marca, título, módulos, trocar chave
<main class="conteudo">
  <nav class="abas">           (opcional) abas da tela
  <form class="filtros">       barra de ferramentas: campos + botão principal
  <form class="pesquisa">      (opcional) busca
  <p class="status">           linha de "atualizado às..."
  <section class="destaque">   número principal da tela
  <section class="bloco">      cada seção: h2 + descrição + conteúdo
```

## Componentes (use estas classes)

| Preciso de... | Classe | Observação |
|---|---|---|
| Seção com título | `.bloco` + `h2` + `.bloco__descricao` | linha fina em cima, sem caixa |
| Título com botões ao lado | `.bloco-topo` + `.bloco-acoes` | |
| Duas seções lado a lado | `.duas-colunas` | vira uma coluna no celular |
| Número principal | `.destaque` + `.valor-grande` | um por tela |
| Indicadores em linha | `.numeros` > `.numero` (`dt`/`dd`) | separados por traço vertical |
| Indicador que abre lista | `.numero--clicavel` + `.ver-detalhes` | link verde com seta |
| Cartões que filtram | `.cartoes` > `button.cartao` | até 4 por linha; ativo = `.cartao--ativo` |
| Lista de barras | `.barras` > `.barra` (rótulo, trilho, valor) | cor: `.barra--atraso`, `.barra--previsao` |
| Tabela | `.tabela-rolagem` > `.tabela` | valores à direita, 1ª coluna à esquerda |
| Linha pequena na célula | `.qtd` ou `.origem` | 13px, cor suave |
| Etiqueta | `.situacao`, `.tipo-documento`, `.tabela-preco` | pílula pequena |
| Botão principal | `button` | um por barra de ferramentas |
| Botão secundário | `.botao-secundario` | contorno verde |
| Atalhos de período | `.atalhos` > `button` | pílulas; ativo = `.atalho--ativo` |
| Janela de detalhe | `dialog.detalhe` | topo verde-escuro |

## Cuidados que já deram problema

- **Não reaproveitar nome de classe com outro sentido.** A barra da venda (vendas) e as
  linhas de barras (financeiro) usavam a mesma classe `.barra`, e uma cortava a outra.
  Hoje a barra da venda usa o id `#barra`. O mesmo aconteceu com `.marca` (topo × tabela).
  Classe nova: nome específico da coisa.
- **Não fixar altura em linha que tem texto.** Altura fixa com `overflow: hidden` corta a
  segunda linha (foi o que escondia o "211 títulos").
- **Número grande não quebra linha.** Use `white-space: nowrap` e garanta espaço no grid
  (`minmax(0, 1fr)`), senão o valor invade a coluna do lado.

## Checklist antes de publicar uma tela

- [ ] Nenhuma cor escrita direto no CSS da tela (só `var(--...)`)
- [ ] Nenhum texto menor que 13px
- [ ] Sem caixa em volta de seção (só linha fina)
- [ ] Testado na largura do notebook e no celular (F12 → ícone de celular no Chrome)
- [ ] Classes novas com nome que não existe em outra tela
