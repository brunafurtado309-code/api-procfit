// Ponto de partida da API.

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { getPool } = require('./config/db');
const exigirChave = require('./middlewares/auth');
const errorHandler = require('./middlewares/errorHandler');
const vendasRoutes = require('./routes/vendas.routes');

const app = express();
app.use(helmet());          // proteções básicas de segurança
app.use(express.json());    // permite receber JSON

// Rota de saúde (pública): confirma que a API está viva e conectada ao banco.
app.get('/health', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT DB_NAME() AS banco, GETDATE() AS agora');

    res.json({ status: 'ok', ...result.recordset[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'erro', mensagem: 'Falha ao conectar no banco' });
  }
});

// Rotas protegidas por chave
app.use('/vendas', exigirChave, vendasRoutes);

// Rota inexistente
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// Tratamento central de erros (sempre por último)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
