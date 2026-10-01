/* =====================================================================
   PEDIDOS PROCESSADOS QUE NÃO VIRARAM NOTA
   (usado pela rota /conciliacao/pedidos-sem-nota)

   Parâmetros enviados pela API:
     @inicio = primeiro dia do mês escolhido
     @fim    = primeiro dia do mês seguinte

   Precisa devolver EXATAMENTE estes nomes de coluna:
     pedido         número do pedido
     data_pedido    data em que o pedido foi feito/processado
     cod_cliente    código do cliente
     nome_cliente   nome / razão social
     cpf_cnpj       CPF ou CNPJ
     valor          valor total do pedido
     valor_pago     quanto já entrou de pagamento (0 se nada)
     situacao       situação do pedido no sistema (texto)
     vendedor       vendedor do pedido

   Regra: pedidos até o fim do mês escolhido, sem nota emitida
   e sem cancelamento.

   Enquanto esta consulta não for preenchida, a tela monta a lista
   pelos títulos que ainda não têm nota fiscal.

   >>> Troque as linhas PREENCHER pelas tabelas reais do PROCFIT <<<
   ===================================================================== */

SELECT
    P.PEDIDO            AS pedido,
    P.DATA_PEDIDO       AS data_pedido,
    C.CODIGO            AS cod_cliente,
    C.NOME              AS nome_cliente,
    C.CPF_CNPJ          AS cpf_cnpj,
    P.VALOR_TOTAL       AS valor,
    ISNULL(P.VALOR_PAGO, 0) AS valor_pago,
    P.SITUACAO          AS situacao,
    P.VENDEDOR          AS vendedor
FROM PREENCHER_TABELA_DE_PEDIDOS P
JOIN PREENCHER_TABELA_DE_CLIENTES C ON C.CODIGO = P.CLIENTE
WHERE P.DATA_PEDIDO < @fim
  AND P.NOTA_FISCAL IS NULL          -- não virou nota
  AND P.SITUACAO <> 'CANCELADO'      -- não foi cancelado
ORDER BY P.DATA_PEDIDO;
