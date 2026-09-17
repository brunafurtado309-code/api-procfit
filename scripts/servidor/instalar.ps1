# Instala (ou reinstala) a API no servidor. Pode rodar quantas vezes quiser.
# Uso, no PowerShell como administrador:
#   cd C:\apps\api-procfit
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\instalar.ps1
#
# Cria duas tarefas agendadas (rodam como SYSTEM, sem ninguem logado):
#   "API PROCFIT"              mantem a API rodando (sobe com o Windows, reinicia se cair)
#   "API PROCFIT - manutencao" a cada 5 min: reinicia se travar e atualiza pelo GitHub
#
# A manutencao roda com o usuario que esta instalando (Administrator), para usar o mesmo
# acesso ao GitHub do "git pull". O Windows pede a senha desse usuario uma vez, aqui.
#
# Opcao -SemAutomatico: instala sem atualizacao automatica (so a vigia contra quedas).
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\instalar.ps1 -SemAutomatico

param([switch]$SemAutomatico, [switch]$SemToken)

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

# O usuario que esta instalando consegue falar com o GitHub sem abrir janela de login?
# (usa a credencial que o Windows guardou no git clone / git pull)
function GitHubAcessivelComUsuario {
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'never'
    Remove-Item Env:GIT_CONFIG_COUNT -ErrorAction SilentlyContinue
    & $git ls-remote --heads origin 2>$null | Out-Null
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
Certo 'Pasta do projeto liberada para as tarefas'
$usuarioManutencao = "$env:USERDOMAIN\$env:USERNAME"
$automatico = $false
if ($SemAutomatico -or $SemToken) {
    Aviso 'Atualizacao automatica desligada por opcao do comando (-SemAutomatico).'
} elseif (GitHubAcessivelComUsuario) {
    Certo "Este servidor acessa o GitHub como $usuarioManutencao (o mesmo acesso do git pull)"
    $automatico = $true
} else {
    Aviso 'Este servidor nao conseguiu falar com o GitHub sem pedir login.'
    Aviso 'Rode um "git pull" aqui, entre com o token quando a janela do GitHub pedir, e depois rode este instalador de novo.'
    Aviso 'Atualizacao automatica DESLIGADA por enquanto; a vigia contra quedas continua.'
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

if ($automatico) {
    $tentativa = 0
    while ($tentativa -lt 3) {
        $tentativa++
        try { $Host.UI.RawUI.FlushInputBuffer() } catch { }
        Aviso "Digite a senha do Windows de $usuarioManutencao (a mesma do login no servidor). Tentativa $tentativa de 3."
        $senhaSegura = Read-Host '   Senha' -AsSecureString
        $senhaTexto = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSegura))
        try {
            $senhaDaTarefa = $senhaTexto
            # Confere a senha registrando uma tarefa de teste.
            # Aqui NAO se usa -Principal: com -User/-Password, quem define o nivel e o -RunLevel.
            Register-ScheduledTask -TaskName 'API PROCFIT - teste de senha' -Action $acaoApi `
                -User $usuarioManutencao -Password $senhaDaTarefa -RunLevel Highest -Force -ErrorAction Stop | Out-Null
            Unregister-ScheduledTask -TaskName 'API PROCFIT - teste de senha' -Confirm:$false
            Certo 'Senha aceita pelo Windows'
            break
        } catch {
            Aviso "O Windows recusou: $($_.Exception.Message)"
            $senhaDaTarefa = $null
            if ($tentativa -eq 3) {
                Aviso 'Sem a senha, a manutencao roda como SYSTEM: a vigia funciona, a atualizacao automatica nao.'
                $automatico = $false
            }
        } finally {
            Remove-Variable senhaTexto, senhaSegura -ErrorAction SilentlyContinue
        }
    }
}

$acaoManut = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $raiz `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'manutencao.ps1')`""
$gatilhos = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)),
    (New-ScheduledTaskTrigger -AtStartup)
)
$opcoesManut = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable -MultipleInstances IgnoreNew
if ($automatico -and $senhaDaTarefa) {
    Register-ScheduledTask -TaskName $tarefaManut -Action $acaoManut -Trigger $gatilhos `
        -Settings $opcoesManut -User $usuarioManutencao -Password $senhaDaTarefa -RunLevel Highest -Force | Out-Null
    Certo "'$tarefaManut': a cada 5 minutos confere a API e atualiza pelo GitHub (como $usuarioManutencao)"
} else {
    Register-ScheduledTask -TaskName $tarefaManut -Action $acaoManut -Trigger $gatilhos `
        -Principal $conta -Settings $opcoesManut -Force | Out-Null
    Certo "'$tarefaManut': a cada 5 minutos confere a API (sem atualizacao automatica)"
}
Remove-Variable senhaDaTarefa -ErrorAction SilentlyContinue

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
if ($automatico) {
    Write-Host '   Atualizacoes:  automaticas a cada 5 minutos (ou agora: scripts\servidor\atualizar.ps1)'
} else {
    Write-Host '   Atualizacoes:  manuais, com scripts\servidor\atualizar.ps1' -ForegroundColor Yellow
}
Write-Host '   API_KEY:       scripts\servidor\copiar-chave.ps1 copia a chave para a area de transferencia'
