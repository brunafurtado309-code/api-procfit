# Funcoes usadas pelo instalar.ps1 e pelo manutencao.ps1.
# (Carregado com: . "$PSScriptRoot\comum.ps1")

$raiz        = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tarefaApi   = 'API PROCFIT'
$tarefaManut = 'API PROCFIT - manutencao'
$porta       = 3000
$node        = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$npm         = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
$git         = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
$pastaLogs   = Join-Path $raiz 'logs'
$pastaDados  = Join-Path $env:ProgramData 'api-procfit'   # credencial do GitHub e estado (so SYSTEM e administradores)
$arquivoGit  = Join-Path $pastaDados 'github.txt'
$arquivoRuim = Join-Path $pastaDados 'versao-recusada.txt'

New-Item -ItemType Directory -Path $pastaLogs -Force | Out-Null

function Registrar($texto) {
    $arquivo = Join-Path $pastaLogs ('manutencao-' + (Get-Date -Format 'yyyy-MM') + '.log')
    Add-Content -Path $arquivo -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $texto"
    Write-Host $texto
}

# Trava: instalacao e manutencao nunca rodam ao mesmo tempo
function ObterTrava([int]$segundos) {
    $trava = New-Object System.Threading.Mutex($false, 'Global\ApiProcfitManutencao')
    try {
        if ($trava.WaitOne($segundos * 1000)) { return $trava }
    } catch [System.Threading.AbandonedMutexException] {
        return $trava   # quem segurava a trava morreu: a trava e nossa
    }
    return $null
}

# Git sem janelas e com a credencial guardada (necessario quando roda como SYSTEM)
function PrepararGit {
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'never'
    Remove-Item Env:GIT_CONFIG_COUNT -ErrorAction SilentlyContinue
    if (Test-Path $arquivoGit) {
        $linhas = Get-Content $arquivoGit
        $basico = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($linhas[0]):$($linhas[1])"))
        $env:GIT_CONFIG_COUNT   = '1'
        $env:GIT_CONFIG_KEY_0   = 'http.https://github.com/.extraheader'
        $env:GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic $basico"
    }
}

# A API responde? (resposta de erro do banco tambem conta: o processo esta vivo)
function ApiResponde {
    try {
        Invoke-RestMethod -Uri "http://localhost:$porta/health" -TimeoutSec 10 -UseBasicParsing | Out-Null
        return $true
    } catch {
        return [bool]$_.Exception.Response
    }
}

function EsperarApi([int]$segundos) {
    $limite = (Get-Date).AddSeconds($segundos)
    while ((Get-Date) -lt $limite) {
        if (ApiResponde) { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

function PararApi {
    if (Get-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue
    }
    # A tarefa para, mas o node pode continuar vivo: encerra quem ocupa a porta
    foreach ($c in @(Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue)) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force }
    }
    Start-Sleep -Seconds 2
}

function IniciarApi { Start-ScheduledTask -TaskName $tarefaApi }

# npm ci usa exatamente as versoes do package-lock.json (sem alterar o arquivo)
function InstalarDependencias {
    Push-Location $raiz
    try {
        if (Test-Path 'package-lock.json') {
            & $git checkout -- package-lock.json 2>$null
            & $npm ci --no-audit --no-fund --loglevel=error
        } else {
            & $npm install --no-audit --no-fund --loglevel=error
        }
        return ($LASTEXITCODE -eq 0)
    } finally {
        Pop-Location
    }
}
