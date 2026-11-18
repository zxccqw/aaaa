param([switch]$Background, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$jar = Join-Path $backend 'target\skin-backend-1.0.0.jar'
$logDir = Join-Path $backend 'logs'
$pidFile = Join-Path $logDir 'backend.pid'

function Find-Jdk {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\java.exe') }
    $cmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($base in @((Join-Path $env:USERPROFILE '.jdks'), 'C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium')) {
        if (Test-Path $base) {
            Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $candidates += (Join-Path $_.FullName 'bin\java.exe')
            }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path $candidate)) { continue }
        $v = & $candidate -version 2>&1 | Out-String
        if ($v -match 'version "21\.') { return $candidate }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Stop-App {
    if (Test-Path $pidFile) {
        $id = 0
        if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$id)) {
            $p = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($p) { Write-Host "停止后端进程 PID=$id"; Stop-Process -Id $id -Force }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'skin-backend-1\.0\.0\.jar' } |
        ForEach-Object { Write-Host "停止后端进程 PID=$($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $segScript = Join-Path $root 'Ai医疗识别\SkinFusion-Seg\start-service.ps1'
    if (Test-Path $segScript) { try { & $segScript -Stop } catch { } }
    Write-Host '已停止。'
}
if ($Stop) { Stop-App; exit 0 }

$java = Find-Jdk
if (-not $java) { throw '未找到 Java 21，请安装 JDK 21 后重试（或设置 JAVA_HOME）。' }
if (-not (Test-Path $jar)) { throw "未找到后端 jar：$jar" }
if (-not (Test-Path (Join-Path $frontend 'index.html'))) { throw '未找到 frontend/index.html，请检查目录结构。' }

$env:PORT = '5175'
$env:FRONTEND_LOCATION = 'file:../frontend/'
$env:SKIN_STORAGE_TYPE = 'file'
$env:SKIN_STORAGE = Join-Path $backend 'data'
$env:DOCTOR_USERNAME = 'doctor'
$env:DOCTOR_PASSWORD = 'Doc@2026#A9k2'
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD = 'Adm@2026#B7q4'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:5175'
$env:SESSION_COOKIE_SECURE = 'false'
$env:SKINFUSION_URL = 'http://127.0.0.1:8000'
$env:SKINFUSION_API_KEY = 'sk-seg-demo-2026'
$userKey = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
if ($userKey) { $env:DEEPSEEK_API_KEY = $userKey }
$env:DEEPSEEK_ENABLED = if ($env:DEEPSEEK_API_KEY) { 'true' } else { 'false' }

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$segScript = Join-Path $root 'Ai医疗识别\SkinFusion-Seg\start-service.ps1'
if (Test-Path $segScript) {
    $segReady = $false
    try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $segReady = $true } } catch { }
    if (-not $segReady) {
        Write-Host '启动 AI 分割服务（SkinFusion-Seg）...'
        try { & $segScript -Background } catch { Write-Warning "AI 分割服务未启动：$($_.Exception.Message)（主系统仍可继续使用）" }
    } else { Write-Host 'AI 分割服务已在运行。' }
}

if (-not $Background) {
    Set-Location $backend
    Write-Host '前台启动（Ctrl+C 停止），访问 http://127.0.0.1:5175/login.html'
    & $java -jar $jar
    exit $LASTEXITCODE
}

$outLog = Join-Path $logDir 'backend.out.log'
$errLog = Join-Path $logDir 'backend.err.log'
$proc = Start-Process -FilePath $java -ArgumentList @('-jar', ('"' + $jar + '"')) -WorkingDirectory $backend -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
Write-Host "启动中 PID=$($proc.Id)，等待就绪..."
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }
    try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5175/login.html' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
    Start-Sleep -Milliseconds 700
}
if ($ready) {
    Write-Host ''
    Write-Host '医疗检验工作台已就绪：http://127.0.0.1:5175/login.html'
    Write-Host '  医生账号：doctor / Doc@2026#A9k2'
    Write-Host '  管理员账号：admin / Adm@2026#B7q4'
    Write-Host "  日志：$outLog"
    exit 0
}
Write-Host '启动失败，日志末尾：'
Get-Content $outLog -Tail 40 -ErrorAction SilentlyContinue
Get-Content $errLog -Tail 20 -ErrorAction SilentlyContinue
exit 1
