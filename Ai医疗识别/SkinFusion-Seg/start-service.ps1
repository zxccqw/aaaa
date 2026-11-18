param([switch]$Background, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source }
    elseif ($env:PYTHON) { $python = $env:PYTHON }
}
$logDir = Join-Path $root 'logs'
$pidFile = Join-Path $logDir 'service.pid'
$apiKey = if ($env:SKINFUSION_API_KEY) { $env:SKINFUSION_API_KEY } else { 'sk-seg-demo-2026' }

function Stop-App {
    if (Test-Path $pidFile) {
        $procId = 0
        if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$procId)) {
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($p) { Write-Host "停止 AI 分割服务 PID=$procId"; Stop-Process -Id $procId -Force }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'uvicorn\s+service\.app:app' } |
        ForEach-Object { Write-Host "停止 AI 分割服务 PID=$($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host 'AI 分割服务已停止。'
}
if ($Stop) { Stop-App; exit 0 }
if (-not $python -or -not (Test-Path $python)) { throw "未找到 Python 环境，请安装 Python 3.12 并执行 安装AI环境.ps1" }

$env:DEVICE = if ($env:DEVICE) { $env:DEVICE } else { 'cpu' }
$env:CPU_THREADS = if ($env:CPU_THREADS) { $env:CPU_THREADS } else { '2' }
$env:API_KEY = $apiKey
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not $Background) {
    Set-Location $root
    Write-Host "前台启动 AI 分割服务：http://127.0.0.1:8000/（Ctrl+C 停止）"
    & $python -m uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1
    exit $LASTEXITCODE
}

Set-Location $root
$outLog = Join-Path $logDir 'service.out.log'
$errLog = Join-Path $logDir 'service.err.log'
$proc = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','service.app:app','--host','127.0.0.1','--port','8000','--workers','1') -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
Write-Host "AI 分割服务启动中 PID=$($proc.Id)，等待模型加载..."
$deadline = (Get-Date).AddSeconds(180)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }
    try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Write-Host 'AI 分割服务启动失败，日志：' $errLog
    Get-Content $errLog -Tail 20 -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "AI 分割服务已就绪：http://127.0.0.1:8000/health  PID=$($proc.Id)"
