# Instala (ou reinstala) a API no servidor. Pode rodar quantas vezes quiser.
# Uso, no PowerShell como administrador:
#   cd C:\apps\api-procfit
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\instalar.ps1
#
# Cria duas tarefas agendadas (rodam como SYSTEM, sem ninguem logado):
#   "API PROCFIT"              mantem a API rodando (sobe com o Windows, reinicia se cair)
#   "API PROCFIT - manutencao" a cada 5 min: reinicia se travar e atualiza pelo GitHub
#
# Opcao -SemToken: instala sem configurar o token do GitHub (atualizacoes manuais).
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\instalar.ps1 -SemToken

param([switch]$SemToken)

. "$PSScriptRoot\comum.ps1"
Set-Location $raiz
$arquivoEnv = Join-Path $raiz '.env'

function Etapa($texto) { Write-Host ''; Write-Host "== $texto" -ForegroundColor Cyan }
function Certo($texto) { Write-Host "   OK   $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   >>   $texto" -ForegroundColor Yellow }
function Parar($texto) {
    Write-Host "   ERRO $texto" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Instalacao interrompida neste ponto. Mande um print desta tela.' -ForegroundColor Red
    if ($script:trava) { $script:trava.ReleaseMutex(); $script:trava.Dispose() }
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

function GitHubAcessivel {
    PrepararGit
    & $git -c credential.helper= ls-remote --heads origin 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function GuardarCredencial($usuario, $token) {
    New-Item -ItemType Directory -Path $pastaDados -Force | Out-Null
    # Somente SYSTEM (S-1-5-18) e Administradores (S-1-5-32-544) podem ler esta pasta
    icacls $pastaDados /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    [IO.File]::WriteAllText($arquivoGit, "$usuario`n$token")
}

Write-Host 'Instalacao da API PROCFIT no servidor' -ForegroundColor White

Etapa '1. Ambiente'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Parar 'Abra o PowerShell com "Executar como administrador".' }
Certo 'PowerShell como administrador'
if (-not (Test-Path $node)) { Parar "Node.js nao encontrado em $node" }
Certo "Node.js $(& $node -v)"
if (-not (Test-Path $git)) { Parar "Git nao encontrado em $git" }
Certo "$(& $git --version)"
if (-not (Test-Path (Join-Path $raiz 'src\server.js'))) { Parar "Projeto nao encontrado em $raiz" }
Certo "Projeto em $raiz ($(& $git log -1 --format='%h %s'))"

$script:trava = ObterTrava 300
if (-not $script:trava) { Parar 'Outra manutencao esta rodando ha mais de 5 minutos.' }

Etapa '2. Firewall (porta 3000 so para a rede interna)'
$regra = 'API PROCFIT - porta 3000 (rede interna)'
if (-not (Get-NetFirewallRule -DisplayName $regra -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $regra -Direction Inbound -Protocol TCP -LocalPort $porta `
        -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
    Certo 'Regra criada'
} else {
    Certo 'Regra ja existia'
}

Etapa '3. Acesso ao GitHub para as atualizacoes automaticas'
$pastaGit = $raiz -replace '\\', '/'
if (-not (@(& $git config --system --get-all safe.directory) -contains $pastaGit)) {
    & $git config --system --add safe.directory $pastaGit
}
Certo 'Pasta do projeto liberada para a conta SYSTEM'
if ((Test-Path $arquivoGit) -and (GitHubAcessivel)) {
    Certo 'Credencial guardada e funcionando'
} else {
    # 1a tentativa: reaproveita a credencial que o Windows guardou no git clone
    $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
    $saida = "protocol=https`nhost=github.com`n`n" | & $git credential fill 2>$null
    $usuario = (@($saida) | Where-Object { $_ -like 'username=*' } | Select-Object -First 1) -replace '^username=', ''
    $token   = (@($saida) | Where-Object { $_ -like 'password=*' } | Select-Object -First 1) -replace '^password=', ''
    $funcionou = $false
    if ($token) {
        GuardarCredencial $(if ($usuario) { $usuario } else { 'x-access-token' }) $token
        $funcionou = GitHubAcessivel
    }
    # 2a tentativa: recebe o token do notebook pela rede (opcional)
    $tentativa = 0
    if ($SemToken) { $tentativa = 3 }   # pulou pela opcao do comando
    while (-not $funcionou -and $tentativa -lt 3) {
        $tentativa++
        try { $Host.UI.RawUI.FlushInputBuffer() } catch { }   # descarta teclas guardadas (ex.: Enter extra ao colar)
        Aviso 'Sem o token, a API fica no ar do mesmo jeito; so as atualizacoes deixam de ser automaticas.'
        $resposta = Read-Host '   Aperte Enter para enviar o token pelo notebook, ou digite P e Enter para pular'
        if ($resposta.Trim().ToUpper() -eq 'P') { break }
        PararApi
        New-Item -ItemType Directory -Path $pastaDados -Force | Out-Null
        icacls $pastaDados /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
        & $node (Join-Path $PSScriptRoot 'receber-env.js') token $arquivoGit
        if ($LASTEXITCODE -ne 0) { continue }
        $funcionou = GitHubAcessivel
        if (-not $funcionou) { Aviso 'O GitHub recusou esse token (vencido, revogado ou incompleto).' }
    }
    Remove-Variable token, saida -ErrorAction SilentlyContinue
    if ($funcionou) {
        Certo 'Credencial guardada em local protegido (so SYSTEM e administradores)'
    } else {
        Remove-Item $arquivoGit -ErrorAction SilentlyContinue
        Aviso 'Atualizacao automatica DESLIGADA por enquanto. A instalacao continua.'
        Aviso 'Para atualizar: scripts\servidor\atualizar.ps1. Para ligar depois: rode este instalador de novo.'
    }
}

Etapa '4. Arquivo .env'
if (EnvValido) {
    Certo '.env valido encontrado'
} else {
    Aviso 'O .env esta ausente ou invalido. Vamos recebe-lo do notebook pela rede.'
    PararApi
    & $node (Join-Path $PSScriptRoot 'receber-env.js')
    if ($LASTEXITCODE -ne 0 -or -not (EnvValido)) { Parar 'O .env nao foi recebido. Rode este script de novo.' }
    Certo '.env recebido'
}

Etapa '5. Dependencias'
PararApi
if (-not (InstalarDependencias)) { Parar 'A instalacao das dependencias (npm) falhou.' }
Certo 'Dependencias instaladas'

Etapa '6. Conexao com o banco'
& $node (Join-Path $PSScriptRoot 'testar-banco.js')
if ($LASTEXITCODE -ne 0) { Parar 'A API nao conseguiu conectar no banco com esse .env.' }
Certo 'Banco acessivel'

Etapa '7. Tarefas agendadas'
$conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$acaoApi = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $raiz `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'iniciar-api.ps1')`""
$opcoesApi = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $tarefaApi -Action $acaoApi -Trigger (New-ScheduledTaskTrigger -AtStartup) `
    -Principal $conta -Settings $opcoesApi -Force | Out-Null
Certo "'$tarefaApi': mantem a API no ar e sobe com o Windows"

$acaoManut = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $raiz `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'manutencao.ps1')`""
$gatilhos = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)),
    (New-ScheduledTaskTrigger -AtStartup)
)
$opcoesManut = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $tarefaManut -Action $acaoManut -Trigger $gatilhos `
    -Principal $conta -Settings $opcoesManut -Force | Out-Null
Certo "'$tarefaManut': a cada 5 minutos confere a API e busca atualizacoes"

IniciarApi

Etapa '8. A API respondeu?'
if (-not (EsperarApi 40)) { Parar "A API nao respondeu. Veja o log em $pastaLogs" }
$saude = $null
try { $saude = Invoke-RestMethod -Uri "http://localhost:$porta/health" -TimeoutSec 10 -UseBasicParsing } catch { }
if (-not $saude -or $saude.status -ne 'ok') { Parar 'A API esta no ar, mas sem conexao com o banco.' }
Certo "API no ar, conectada ao banco $($saude.banco)"

Registrar "Instalacao concluida na versao $(& $git log -1 --format='%h')."
$script:trava.ReleaseMutex(); $script:trava.Dispose()

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
Write-Host ''
Write-Host 'Instalacao concluida.' -ForegroundColor Green
Write-Host "   Painel:        http://${ip}:$porta/painel"
Write-Host "   Logs:          $pastaLogs"
if (Test-Path $arquivoGit) {
    Write-Host '   Atualizacoes:  automaticas a cada 5 minutos (ou agora: scripts\servidor\atualizar.ps1)'
} else {
    Write-Host '   Atualizacoes:  manuais, com scripts\servidor\atualizar.ps1 (automaticas desligadas: falta o token)' -ForegroundColor Yellow
}
Write-Host '   API_KEY:       scripts\servidor\copiar-chave.ps1 copia a chave para a area de transferencia'
