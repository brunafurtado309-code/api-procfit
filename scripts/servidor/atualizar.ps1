# Atualiza a API agora, sem esperar a manutencao automatica (que roda a cada 5 minutos).
# Uso (PowerShell como administrador):
#   cd C:\apps\api-procfit
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\atualizar.ps1
& (Join-Path $PSScriptRoot 'manutencao.ps1') -Agora
