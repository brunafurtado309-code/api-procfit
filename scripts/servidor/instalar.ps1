# Instala (ou reinstala) a API no servidor. Pode rodar quantas vezes quiser.
# Uso, no PowerShell como administrador:
#   cd C:\apps\api-procfit
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\instalar.ps1
#
# Etapas: confere o ambiente, instala dependencias, libera a porta 3000 na rede interna,
# recebe o .env do notebook (se preciso), testa o banco, cria a tarefa que mantem a API
# no ar (inclusive depois de reiniciar o servidor) e confere se ela respondeu.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $raiz

$tarefa = 'API PROCFIT'
$porta = 3000
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
$arquivoEnv = Join-Path $raiz '.env'

function Etapa($texto) { Write-Host ''; Write-Host "== $texto" -ForegroundColor Cyan }
function Certo($texto) { Write-Host "   OK   $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   >>   $texto" -ForegroundColor Yellow }
function Parar($texto) {
    Write-Host "   ERRO $texto" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Instalacao interrompida. Nada mais foi alterado. Mande um print desta tela.' -ForegroundColor Red
    exit 1
}

function EnvValido {
    if (-not (Test-Path $arquivoEnv)) { return $false }
    $conteudo = [IO.File]::ReadAllText($arquivoEnv)
    foreach ($nome in 'DB_SERVER', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD', 'API_KEY') {
        if ($conteudo -notmatch "(?m)^$nome=.+") { return $false }
    }
    return ($conteudo -notmatch 'Get-Clipboard|Read-Host')
}

# Encerra a tarefa e qualquer node que esteja ocupando a porta (ex.: um "node src/server.js" manual)
function LiberarPorta {
    if (Get-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
    }
    $conexoes = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conexoes) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if (-not $p) { continue }
        if ($p.ProcessName -ne 'node') { Parar "A porta $porta esta sendo usada por outro programa: $($p.ProcessName) (Id $($p.Id))." }
        Stop-Process -Id $p.Id -Force
    }
    Start-Sleep -Seconds 2
}

Write-Host 'Instalacao da API PROCFIT no servidor' -ForegroundColor White

Etapa '1. Ambiente'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Parar 'Abra o PowerShell com "Executar como administrador".' }
Certo 'PowerShell como administrador'
if (-not (Test-Path $node)) { Parar "Node.js nao encontrado em $node" }
Certo "Node.js $(& $node -v)"
if (-not (Test-Path (Join-Path $raiz 'src\server.js'))) { Parar "Projeto nao encontrado em $raiz" }
Certo "Projeto em $raiz"

Etapa '2. Dependencias (npm install)'
& $npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Parar 'npm install falhou.' }
Certo 'Dependencias instaladas'

Etapa '3. Firewall (porta 3000 so para a rede interna)'
$regra = 'API PROCFIT - porta 3000 (rede interna)'
if (-not (Get-NetFirewallRule -DisplayName $regra -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $regra -Direction Inbound -Protocol TCP -LocalPort $porta `
        -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
    Certo 'Regra criada'
} else {
    Certo 'Regra ja existia'
}

Etapa '4. Arquivo .env'
if (EnvValido) {
    Certo '.env valido encontrado'
} else {
    Aviso 'O .env esta ausente ou invalido. Vamos recebe-lo do notebook pela rede.'
    LiberarPorta
    & $node (Join-Path $PSScriptRoot 'receber-env.js')
    if ($LASTEXITCODE -ne 0 -or -not (EnvValido)) { Parar 'O .env nao foi recebido. Rode este script de novo.' }
    Certo '.env recebido'
}

Etapa '5. Conexao com o banco'
& $node (Join-Path $PSScriptRoot 'testar-banco.js')
if ($LASTEXITCODE -ne 0) { Parar 'A API nao conseguiu conectar no banco com esse .env.' }
Certo 'Banco acessivel'

Etapa '6. Tarefa que mantem a API no ar'
LiberarPorta
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'iniciar-api.ps1')`"" `
    -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $tarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $opcoes -Force | Out-Null
Start-ScheduledTask -TaskName $tarefa
Certo "Tarefa '$tarefa' criada e iniciada (sobe sozinha quando o servidor ligar)"

Etapa '7. A API respondeu?'
$saude = $null
foreach ($tentativa in 1..15) {
    Start-Sleep -Seconds 2
    try { $saude = Invoke-RestMethod -Uri "http://localhost:$porta/health" -TimeoutSec 5 -UseBasicParsing; break } catch { }
}
if (-not $saude) { Parar "A API nao respondeu. Veja o log em $raiz\logs" }
if ($saude.status -ne 'ok') { Parar "A API respondeu, mas sem banco: $($saude.mensagem)" }
Certo "API no ar, conectada ao banco $($saude.banco)"

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
$chave = (Select-String -Path $arquivoEnv -Pattern '^API_KEY=(.+)$').Matches[0].Groups[1].Value.Trim()
Set-Clipboard -Value $chave

Write-Host ''
Write-Host 'Instalacao concluida.' -ForegroundColor Green
Write-Host "   Painel:  http://${ip}:$porta/painel"
Write-Host "   Logs:    $raiz\logs"
Write-Host '   A API_KEY do servidor foi copiada: cole agora no gerenciador de senhas.' -ForegroundColor Yellow
Write-Host '   (Para copiar de novo: powershell -ExecutionPolicy Bypass -File scripts\servidor\copiar-chave.ps1)'
