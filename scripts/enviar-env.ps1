# Roda no NOTEBOOK. Envia o .env para o servidor, pela rede interna,
# enquanto o instalar.ps1 do servidor mostra "CODIGO: ......".
# Uso, na pasta do projeto:
#   .\scripts\enviar-env.ps1
#   (ou, se o Windows bloquear: powershell -ExecutionPolicy Bypass -File scripts\enviar-env.ps1)

param([string]$Servidor = '192.168.1.3')

$raiz = Split-Path -Parent $PSScriptRoot
$arquivo = Join-Path $raiz '.env'
if (-not (Test-Path $arquivo)) {
    Write-Host "Nao encontrei o .env em $arquivo" -ForegroundColor Red
    exit 1
}

$codigo = (Read-Host 'Codigo de 6 digitos que aparece no servidor').Trim()
$bytes = [Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText($arquivo))

try {
    $resposta = Invoke-RestMethod -Method Post -Uri "http://${Servidor}:3000/env" `
        -Headers @{ 'x-codigo' = $codigo } -ContentType 'text/plain; charset=utf-8' `
        -Body $bytes -TimeoutSec 15 -UseBasicParsing
    Write-Host $resposta -ForegroundColor Green
    Write-Host 'Volte ao servidor: a instalacao continua sozinha.'
} catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    switch ($status) {
        401 { Write-Host 'Codigo errado. Rode de novo e digite o codigo exatamente como aparece (3 tentativas no total).' -ForegroundColor Red }
        400 { Write-Host 'O servidor recusou o arquivo: o .env deste notebook parece incompleto.' -ForegroundColor Red }
        default {
            Write-Host "Nao consegui falar com o servidor ${Servidor}:3000." -ForegroundColor Red
            Write-Host 'Confira se o servidor esta mostrando o CODIGO (ele espera 10 minutos) e se este notebook esta na rede interna.'
            Write-Host "Detalhe: $($_.Exception.Message)"
        }
    }
    exit 1
}
