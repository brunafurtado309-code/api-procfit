// Módulo PRECIFICAÇÃO: custo certo, preço sugerido, margem real, estoque e giro.
// Desenho combinado em out/2026 (documento "Painel da Precificação — Belo Norte").
// O painel calcula e sugere, mas NUNCA grava no PROCFIT: aqui só tem leitura.
//
// De onde vem cada coisa (validado no banco em out/2026):
//   Notas de compra   NF_COMPRA. O PROCFIT cria a nota sozinho quando o XML chega
//                     (PROCEDURE_INSERT = INSERT_NFE_NF_COMPRA). EMISSAO = data da nota.
//                     PROCESSAR = 'S' quando a logística finaliza; DATA_PROCESSAMENTO = quando.
//                     Conferido em 90 dias: 236 de 237 notas 'S' têm estoque; nenhuma 'N' tem.
//   Itens da nota     NF_COMPRA_PRODUTOS só recebe os itens quando a nota é finalizada.
//   parada            Antes disso, os itens existem só no XML: NF_COMPRA.CHAVE_NFE = NFE.ID,
//                     e NFE_PROD.REGISTRO_NFE = NFE.Registro.
//   Vínculo do item   NFE_PROD.PRODUTO vem sempre vazio: o vínculo com o nosso produto é
//                     montado pela API (passo 5).
//   Notas do grupo    NFE guarda todas as notas em que um CNPJ do grupo aparece, inclusive
//                     transferências entre filiais (mesma raiz de CNPJ, 35.018.014).
//   eDoc              EdocRegistrosNFe NÃO é usada: tem notas de muitos CNPJs.
//   Classificação     PRODUTOS.CATEGORIA_PRODUTO e CLASSIFICACAO vêm vazias. INDUSTRIALIZADO
//                     e INSUMO ('S') estão preenchidos e ajudam a sugerir o tipo (passo 3).

const { getPool } = require('../config/db');

// Primeira leitura da tela: confirma a conexão e mostra o tamanho do cadastro
async function inicio() {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT
      COUNT(*)                                              AS produtos,
      SUM(CASE WHEN INDUSTRIALIZADO = 'S' THEN 1 ELSE 0 END) AS industrializados,
      SUM(CASE WHEN INSUMO = 'S' THEN 1 ELSE 0 END)          AS insumos,
      CONVERT(varchar(19), GETDATE(), 120)                  AS lido_em
    FROM PRODUTOS WITH (NOLOCK);
  `);
  return recordset[0] ?? {};
}

module.exports = { inicio };
