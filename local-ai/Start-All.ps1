$ErrorActionPreference = 'Stop'
$baseDir = $PSScriptRoot
$logDir = Join-Path $baseDir 'tmp\service-logs'
$publicUrl = 'https://abrasive-modify-appointee.ngrok-free.dev'
function Test-Service($url) {
  try { $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3; return $r.StatusCode -eq 200 } catch { return $false }
}
try {
  & (Join-Path $baseDir 'tmp\start-services.ps1')
  if (-not (Test-Service 'http://127.0.0.1:8010/gateway-health')) {
    $listener = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq 8010
    if ($listener) { throw 'Port 8010 is occupied but the gateway is not healthy. Check service logs.' }
    Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList ('"' + (Join-Path $baseDir 'ai-gateway.cjs') + '"') -WorkingDirectory $baseDir -WindowStyle Hidden -RedirectStandardOutput "$logDir\gateway.out.log" -RedirectStandardError "$logDir\gateway.err.log" | Out-Null
  }
  Write-Host 'Waiting for Face and CCTV AI (up to 3 minutes)...'
  $deadline = (Get-Date).AddMinutes(3)
  do {
    $faceReady = Test-Service 'http://127.0.0.1:8000/'
    $cctvReady = Test-Service 'http://127.0.0.1:8001/api/cctv/status'
    if ($faceReady -and $cctvReady) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  if (-not ($faceReady -and $cctvReady)) { throw "AI startup timed out. See $logDir" }
  $tunnels = $null
  try { $tunnels = Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3 } catch {}
  $existing = @($tunnels.tunnels | Where-Object public_url -eq $publicUrl)
  if ($existing.Count -gt 0 -and $existing[0].config.addr -notmatch ':8010/?$') {
    throw 'The existing ngrok tunnel still points to another port. Close the old ngrok process and run START-ALL.cmd again.'
  }
  if ($existing.Count -eq 0) {
    if ($tunnels) { throw 'Another ngrok agent is running. Close it before starting this configured tunnel.' }
    Start-Process -FilePath "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe" -ArgumentList "http 8010 --url=$publicUrl --log=stdout" -WindowStyle Hidden -RedirectStandardOutput "$logDir\ngrok.out.log" -RedirectStandardError "$logDir\ngrok.err.log" | Out-Null
  }
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $r = Invoke-WebRequest "$publicUrl/api/cctv/status" -Headers @{'ngrok-skip-browser-warning'='1'} -UseBasicParsing -TimeoutSec 5
      $body = $r.Content | ConvertFrom-Json
      if ($r.StatusCode -eq 200 -and $body.status -eq 'online') { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "Public tunnel not ready. See $logDir\ngrok.err.log" }
  Write-Host "READY: Face + CCTV use $publicUrl" -ForegroundColor Green
  Write-Host 'Vercel one-time setting: VITE_CCTV_API_URL = ' $publicUrl
  Write-Host 'Local website: http://localhost:5173/'
  Write-Host 'You can close this window. Keep the computer awake while using AI.'
} catch {
  Write-Host "STARTUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
