# Copia a API_KEY do servidor para a area de transferencia (sem mostrar na tela).
$arquivo = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.env'
$chave = (Select-String -Path $arquivo -Pattern '^API_KEY=(.+)$').Matches[0].Groups[1].Value.Trim()
Set-Clipboard -Value $chave
Write-Host 'API_KEY copiada. Cole no gerenciador de senhas.' -ForegroundColor Green
