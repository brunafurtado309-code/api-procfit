// Ponto de partida da API.

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const { getPool } = require('./config/db');
const { exigirChave } = require('./middlewares/auth');
const errorHandler = require('./middlewares/errorHandler');
const vendasRoutes = require('./routes/vendas.routes');
const financeiroRoutes = require('./routes/financeiro.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

// Versão do painel: muda sempre que algum arquivo de src/public muda.
// As telas abertas comparam esse valor e recarregam sozinhas depois de uma atualização.
function calcularVersao(pasta) {
  const hash = crypto.createHash('sha1');
  const percorrer = (dir) => {
    const itens = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of itens) {
      const caminho = path.join(dir, item.name);
      if (item.isDirectory()) percorrer(caminho);
      else hash.update(item.name).update(fs.readFileSync(caminho));
    }
  };
  percorrer(pasta);
  return hash.digest('hex').slice(0, 12);
}
const VERSAO_PAINEL = calcularVersao(path.join(__dirname, 'public'));

app.use(helmet({
  // Permite abrir o painel pela rede (http) sem forçar https
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
}));
app.use(express.json());

// Rota de saúde (pública): confirma que a API está viva e conectada ao banco.
app.get('/health', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT DB_NAME() AS banco, GETDATE() AS agora');

    res.json({ status: 'ok', ...result.recordset[0], versao: VERSAO_PAINEL });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'erro', mensagem: 'Falha ao conectar no banco', versao: VERSAO_PAINEL });
  }
});

// Diz ao painel quais setores a chave informada abre (usado na tela de entrada)
app.get('/acessos', exigirChave(), (req, res) => res.json({ setores: req.setores }));

// Rotas protegidas por chave, cada uma no seu setor
app.use('/vendas', exigirChave('vendas'), vendasRoutes);
app.use('/financeiro', exigirChave('financeiro'), financeiroRoutes);
app.use('/admin', exigirChave('admin'), adminRoutes);

// Painel visual (arquivos da pasta src/public)
app.use('/painel', express.static(path.join(__dirname, 'public')));

// Rota inexistente
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// Tratamento central de erros (sempre por último)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const servidor = app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));

// Porta ocupada: explica o que fazer em vez de mostrar só o erro técnico
servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} já está em uso: provavelmente a API já está rodando em outro terminal.`);
    console.error('Feche a outra instância (ou encerre o processo node da porta) e tente de novo.\n');
    process.exit(1);
  }
  throw err;
});

// Rede de segurança: um erro que escapou não derruba a API; fica registrado no terminal.
const agora = () => new Date().toLocaleString('pt-BR');
process.on('unhandledRejection', (motivo) => {
  console.error(`[${agora()}] Erro não tratado (a API continua no ar):`, motivo);
});
process.on('uncaughtException', (err) => {
  console.error(`[${agora()}] Erro inesperado:`, err);
  // Depois de um erro assim o processo pode ficar instável: encerra para ser reiniciado limpo
  // (quem reinicia é o PM2, que vamos configurar).
  process.exit(1);
});
