// Recebe o .env do notebook UMA vez, pela rede interna, e se encerra.
// Uso: chamado pelo instalar.ps1 (não é preciso rodar à mão).
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

const DESTINO = path.join(__dirname, '..', '..', '.env');
const PORTA = 3000;
const LIMITE_MS = 10 * 60 * 1000;
const codigo = String(crypto.randomInt(100000, 1000000));
let erros = 0;

const servidor = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/env') {
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
  console.log('   No NOTEBOOK, rode:  .\\scripts\\enviar-env.ps1');
  console.log('   e digite o codigo acima. (Esta espera fecha em 10 minutos.)');
});

setTimeout(() => {
  console.log('Tempo esgotado sem receber o .env.');
  process.exit(1);
}, LIMITE_MS);
