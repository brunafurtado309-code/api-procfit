# API PROCFIT — Belo Norte

API de **somente leitura** sobre o banco do PROCFIT (`PBS_ACAIBN_DADOS`), base do painel de gestão (vendas, produtos, compras, estoque, financeiro).

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha com os dados de conexão.
3. Inicie:
   ```bash
   npm run dev
   ```
4. Teste no navegador: http://localhost:3000/health

## Estrutura

```
src/
├── config/        conexão com o banco
├── routes/        URLs da API
├── controllers/   recebe a requisição e devolve a resposta
├── services/      regras de negócio
├── repositories/  consultas SQL
└── server.js      ponto de partida
```

## Regras do projeto

- Usuário do banco **somente leitura**.
- Senhas só no `.env` (nunca no código ou no GitHub).
- Banco de produção: toda consulta com **filtro de data e limite de linhas**.
- Consultas sempre **parametrizadas** (proteção contra SQL Injection).
- Acesso à API protegido por chave (próximas etapas).

## Rotas (exigem o cabeçalho `x-api-key`)

Parâmetros: `inicio` e `fim` (AAAA-MM-DD, obrigatórios), `empresa` (opcional).

- `GET /vendas/resumo`
- `GET /vendas/por-dia`
- `GET /vendas/por-loja`
- `GET /vendas/por-origem` (PDV x NFE)
- `GET /vendas/top-produtos` (aceita `limite`, padrão 10)

Gerar a chave da API:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
