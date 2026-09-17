# Atualiza a API no servidor com a versao mais recente do GitHub.
# Uso (PowerShell como administrador):
#   cd C:\apps\api-procfit
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\atualizar.ps1

$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $raiz
Write-Host '== Baixando a versao mais recente' -ForegroundColor Cyan
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host '   ERRO no git pull. Nada foi alterado. Mande um print desta tela.' -ForegroundColor Red
    exit 1
}
git log --oneline -1
# O instalar reinstala dependencias, reinicia a tarefa e confere a API
& (Join-Path $PSScriptRoot 'instalar.ps1')
