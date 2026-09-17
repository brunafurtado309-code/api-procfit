# Mantem a API rodando: se ela encerrar por qualquer motivo, sobe de novo em 10 segundos.
# Executado pela tarefa agendada "API PROCFIT" (criada pelo instalar.ps1), como SYSTEM.
# Logs em <projeto>\logs\api-AAAA-MM.log

$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $raiz
$logs = Join-Path $raiz 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'

while ($true) {
    $arquivo = Join-Path $logs ('api-' + (Get-Date -Format 'yyyy-MM') + '.log')
    Add-Content -Path $arquivo -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Iniciando a API"
    cmd.exe /c "`"$node`" src\server.js >> `"$arquivo`" 2>&1"
    Add-Content -Path $arquivo -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] A API encerrou (codigo $LASTEXITCODE). Reiniciando em 10 segundos."
    Start-Sleep -Seconds 10
}
