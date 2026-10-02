$t = Get-Clipboard -Raw
if ($t -match 'titulosDasNotas' -and $t -match 'const CARGAS = ') {
  [IO.File]::WriteAllText("$PWD\src\repositories\despachos.repository.js", $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "GRAVADO despachos.repository.js"
} else { Write-Host "NAO GRAVEI: o que esta copiado nao e o arquivo 2" }