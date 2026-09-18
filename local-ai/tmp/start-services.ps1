$ErrorActionPreference = 'Stop'
$logDir = 'D:\Gesture-Recognition-master\tmp\service-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:VITE_ATTENDANCE_API_URL = 'https://psru-attendance-db.onrender.com'
$env:VITE_QR_API_URL = 'https://scan-qr-eiei.vercel.app'
$env:VITE_FACE_API_URL = 'http://localhost:8000/api/verify_face'
$env:VITE_CCTV_API_URL = 'http://localhost:8001'
$env:REMOTE_API_BASE_URL = 'https://psru-attendance-db.onrender.com'
if (-not $env:QR_SECRET) { $env:QR_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
$services = @(
  @{Name='qr'; Exe='C:\Python311\python.exe'; Args='-u app.py'; Dir='D:\ScanQr_eiei-main'; Port=5000},
  @{Name='face'; Exe='D:\titan-auth-api-main\titan-auth-api-main\python311\python.exe'; Args='-s -u D:\Gesture-Recognition-master\face_service.py'; Dir='D:\titan-auth-api-main\titan-auth-api-main'; Port=8000},
  @{Name='cctv'; Exe='C:\Python311\python.exe'; Args='-u D:\Gesture-Recognition-master\cctv_service_vgg.py'; Dir='D:\smart-attendance-web-main\Gesture-Recognition-master'; Port=8001},
  @{Name='web'; Exe='C:\Program Files\nodejs\node.exe'; Args='node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort'; Dir='D:\smart-attendance-web-main'; Port=5173}
)
foreach ($svc in $services) {
  $probe = New-Object System.Net.Sockets.TcpClient
  try { $probe.Connect('127.0.0.1', $svc.Port); Write-Output "$($svc.Name): port already active"; continue } catch {} finally { $probe.Dispose() }
  $proc = Start-Process -FilePath $svc.Exe -ArgumentList $svc.Args -WorkingDirectory $svc.Dir -WindowStyle Hidden -RedirectStandardOutput "$logDir\$($svc.Name).out.log" -RedirectStandardError "$logDir\$($svc.Name).err.log" -PassThru
  Write-Output "$($svc.Name): PID $($proc.Id), port $($svc.Port)"
}
