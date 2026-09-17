# Manutencao automatica da API. A tarefa "API PROCFIT - manutencao" roda este script
# a cada 5 minutos, como SYSTEM. Registra o que fez em logs\manutencao-AAAA-MM.log.
#
# 1. Vigia:     se a tarefa da API parou, inicia; se a API travou (nao responde), reinicia.
# 2. Atualiza:  se ha versao nova no GitHub (branch main), baixa, reinicia e confere.
#               Se a versao nova nao responder, volta para a anterior e nao tenta de novo
#               essa mesma versao (tenta a proxima que for enviada).
# 3. Limpa:     apaga logs com mais de 90 dias.
#
# Uso manual (atualizar agora, mostrando tudo na tela):
#   powershell -ExecutionPolicy Bypass -File scripts\servidor\manutencao.ps1 -Agora

param([switch]$Agora)

. "$PSScriptRoot\comum.ps1"
Set-Location $raiz

$trava = ObterTrava $(if ($Agora) { 300 } else { 0 })
if (-not $trava) {
    if ($Agora) { Write-Host 'Outra instalacao ou manutencao esta em andamento. Tente em alguns minutos.' -ForegroundColor Yellow }
    exit 0
}

try {
    # ---------- 1. Vigia ----------
    $tarefa = Get-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue
    if (-not $tarefa) {
        Registrar "A tarefa '$tarefaApi' nao existe. Rode o instalar.ps1."
        exit 1
    }
    if ($tarefa.State -ne 'Running') {
        Registrar "A tarefa da API estava '$($tarefa.State)'. Iniciando."
        IniciarApi
    } elseif (-not (ApiResponde)) {
        Start-Sleep -Seconds 20   # pode estar reiniciando: confere de novo antes de agir
        if (-not (ApiResponde)) {
            Registrar 'A API nao responde. Reiniciando.'
            PararApi
            IniciarApi
            if (EsperarApi 60) { Registrar 'API respondendo de novo.' } else { Registrar 'ATENCAO: a API continua sem responder. Veja logs\api-*.log' }
        }
    } elseif ($Agora) {
        Write-Host 'API respondendo.' -ForegroundColor Green
    }

    # ---------- 2. Atualizacao ----------
    PrepararGit
    & $git -c credential.helper= fetch --quiet origin main 2>$null
    if ($LASTEXITCODE -ne 0) {
        Registrar 'Nao foi possivel consultar o GitHub (rede ou credencial). Tento de novo na proxima rodada.'
        exit 1
    }

    $atual = (& $git rev-parse HEAD).Trim()
    $nova  = (& $git rev-parse origin/main).Trim()
    $recusada = if (Test-Path $arquivoRuim) { (Get-Content $arquivoRuim -Raw).Trim() } else { '' }

    if ($atual -eq $nova) {
        if ($Agora) { Write-Host "Ja esta na versao mais recente: $(& $git log -1 --format='%h %s')" -ForegroundColor Green }
    } elseif ($nova -eq $recusada -and -not $Agora) {
        # versao que ja falhou: espera a proxima
    } else {
        # O package-lock pode ter sido reescrito por um npm install antigo: nao conta como alteracao
        & $git checkout -- package-lock.json 2>$null
        $alterados = @(& $git status --porcelain --untracked-files=no)
        & $git merge-base --is-ancestor $atual $nova
        $avanca = ($LASTEXITCODE -eq 0)

        if ($alterados.Count -gt 0) {
            Registrar "Atualizacao cancelada: ha arquivos alterados no servidor ($($alterados -join ', '))."
        } elseif (-not $avanca) {
            Registrar 'Atualizacao cancelada: o historico do servidor e do GitHub nao batem.'
        } else {
            $mensagem = & $git log -1 --format='%s' $nova
            $mudouDependencias = @(& $git diff --name-only $atual $nova -- package.json package-lock.json).Count -gt 0
            Registrar "Atualizando $($atual.Substring(0,7)) -> $($nova.Substring(0,7)): $mensagem"

            PararApi
            & $git merge --ff-only --quiet $nova
            $ok = ($LASTEXITCODE -eq 0)
            if ($ok -and $mudouDependencias) { $ok = InstalarDependencias }
            if ($ok) { IniciarApi; $ok = EsperarApi 90 }

            if ($ok) {
                Remove-Item $arquivoRuim -ErrorAction SilentlyContinue
                Registrar "Atualizado com sucesso para $($nova.Substring(0,7))."
            } else {
                Registrar "A versao $($nova.Substring(0,7)) nao funcionou. Voltando para $($atual.Substring(0,7))."
                PararApi
                & $git reset --hard --quiet $atual
                if ($mudouDependencias) { [void](InstalarDependencias) }
                IniciarApi
                New-Item -ItemType Directory -Path $pastaDados -Force | Out-Null
                Set-Content -Path $arquivoRuim -Value $nova
                if (EsperarApi 90) { Registrar 'Versao anterior restaurada e respondendo.' }
                else { Registrar 'ATENCAO: a versao anterior tambem nao respondeu. Veja logs\api-*.log' }
            }
        }
    }

    # ---------- 3. Limpeza ----------
    Get-ChildItem $pastaLogs -Filter '*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
        Remove-Item -ErrorAction SilentlyContinue
} finally {
    $trava.ReleaseMutex()
    $trava.Dispose()
}
