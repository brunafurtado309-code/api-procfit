// Recebe do notebook, UMA vez e pela rede interna, o .env ou o token do GitHub, e se encerra.
// Uso: chamado pelo instalar.ps1 (não é preciso rodar à mão).
//   node receber-env.js                  -> recebe o .env (POST /env)
//   node receber-env.js token <arquivo>  -> recebe o token do GitHub (POST /token) e grava em <arquivo>
//
// Segurança:
// - só aceita POST /env com o código de 6 dígitos mostrado na tela;
// - 3 códigos errados ou 10 minutos sem envio: encerra;
// - confere se o conteúdo é um .env e troca a API_KEY por uma nova, só do servidor;
// - nunca mostra senha nem chave na tela.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODO = process.argv[2] === 'token' ? 'token' : 'env';
const DESTINO = MODO === 'token' ? process.argv[3] : path.join(__dirname, '..', '..', '.env');
const ROTA = `/${MODO}`;
const SCRIPT_NOTEBOOK = MODO === 'token' ? 'enviar-token.ps1' : 'enviar-env.ps1';
if (!DESTINO) {
  console.log('Informe o arquivo de destino do token.');
  process.exit(1);
}
const PORTA = 3000;
const LIMITE_MS = 10 * 60 * 1000;
const codigo = String(crypto.randomInt(100000, 1000000));
let erros = 0;

const servidor = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== ROTA) {
    res.writeHead(404);
    return res.end();
  }

  let corpo = '';
  req.setEncoding('utf8');
  req.on('data', (parte) => {
    corpo += parte;
    if (corpo.length > 20000) req.destroy(); // um .env nunca é tão grande
  });

  req.on('end', () => {
    const recebido = Buffer.from(String(req.headers['x-codigo'] || '').trim());
    const esperado = Buffer.from(codigo);
    if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
      erros += 1;
      res.writeHead(401);
      res.end('Codigo errado.\n');
      console.log(`Tentativa com codigo errado (${erros}/3).`);
      if (erros >= 3) {
        console.log('3 codigos errados. Encerrado por seguranca.');
        process.exit(1);
      }
      return;
    }

    if (MODO === 'token') {
      const token = corpo.replace(/^\uFEFF/, '').trim();
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(token)) {
        res.writeHead(400);
        return res.end('O conteudo recebido nao parece um token do GitHub.\n');
      }
      fs.writeFileSync(DESTINO, `x-access-token\n${token}`, 'utf8');
      res.writeHead(200);
      res.end('OK: token recebido pelo servidor.\n');
      console.log(`Token recebido (${token.length} caracteres).`);
      servidor.close();
      setTimeout(() => process.exit(0), 300);
      return;
    }

    let texto = corpo.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!/^DB_SERVER=/m.test(texto) || !/^DB_PASSWORD=/m.test(texto)) {
      res.writeHead(400);
      return res.end('O conteudo recebido nao parece um .env.\n');
    }

    // Chave própria do servidor (diferente da do notebook)
    const chave = crypto.randomBytes(32).toString('hex');
    texto = /^API_KEY=/m.test(texto)
      ? texto.replace(/^API_KEY=.*$/m, `API_KEY=${chave}`)
      : `${texto.trimEnd()}\nAPI_KEY=${chave}\n`;

    fs.writeFileSync(DESTINO, texto, 'utf8');
    res.writeHead(200);
    res.end('OK: .env gravado no servidor.\n');
    console.log(`.env recebido e gravado (${Buffer.byteLength(texto)} bytes).`);
    servidor.close();
    setTimeout(() => process.exit(0), 300);
  });
});

servidor.on('error', (err) => {
  console.log(`Nao foi possivel abrir a porta ${PORTA}: ${err.code}`);
  process.exit(1);
});

servidor.listen(PORTA, () => {
  console.log('');
  console.log(`   CODIGO: ${codigo}`);
  console.log('');
  console.log(`   No NOTEBOOK, na pasta do projeto, rode:`);
  console.log(`   powershell -ExecutionPolicy Bypass -File scripts\\${SCRIPT_NOTEBOOK}`);
  console.log('   e digite o codigo acima. (Esta espera fecha em 10 minutos.)');
});

setTimeout(() => {
  console.log('Tempo esgotado sem receber nada.');
  process.exit(1);
}, LIMITE_MS);
