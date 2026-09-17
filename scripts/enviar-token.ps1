# Roda no NOTEBOOK. Envia o token do GitHub para o servidor, pela rede interna,
# enquanto o instalar.ps1 do servidor mostra "CODIGO: ......".
# O token e lido da area de transferencia DESTE notebook (copie do gerenciador de senhas).
# Uso, na pasta do projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\enviar-token.ps1

param([string]$Servidor = '192.168.1.3')

Write-Host "Copie o token 'servidor-api-procfit' no gerenciador de senhas." -ForegroundColor Yellow
Read-Host 'Depois aperte Enter aqui' | Out-Null
$token = ([string](Get-Clipboard -Raw)).Trim()

if ($token -notmatch '^(github_pat_|ghp_)[A-Za-z0-9_]+$') {
    Write-Host "A area de transferencia nao tem um token do GitHub (tem $($token.Length) caracteres)." -ForegroundColor Red
    Write-Host 'Copie o token de novo e rode este script outra vez (o codigo do servidor continua valendo).'
    exit 1
}
Write-Host "Token encontrado ($($token.Length) caracteres)." -ForegroundColor Green

$codigo = (Read-Host 'Codigo de 6 digitos que aparece no servidor').Trim()
$bytes = [Text.Encoding]::UTF8.GetBytes($token)

try {
    $resposta = Invoke-RestMethod -Method Post -Uri "http://${Servidor}:3000/token" `
        -Headers @{ 'x-codigo' = $codigo } -ContentType 'text/plain; charset=utf-8' `
        -Body $bytes -TimeoutSec 15 -UseBasicParsing
    Write-Host $resposta -ForegroundColor Green
    Write-Host 'Volte ao servidor: a instalacao continua sozinha.'
} catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    switch ($status) {
        401 { Write-Host 'Codigo errado. Rode de novo e digite o codigo exatamente como aparece (3 tentativas no total).' -ForegroundColor Red }
        400 { Write-Host 'O servidor recusou: o conteudo nao parece um token do GitHub.' -ForegroundColor Red }
        default {
            Write-Host "Nao consegui falar com o servidor ${Servidor}:3000." -ForegroundColor Red
            Write-Host 'Confira se o servidor esta mostrando o CODIGO (ele espera 10 minutos).'
        }
    }
    exit 1
} finally {
    Set-Clipboard -Value ' '   # tira o token da area de transferencia
    Remove-Variable token, bytes -ErrorAction SilentlyContinue
}
