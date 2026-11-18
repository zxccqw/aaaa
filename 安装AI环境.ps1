param([switch]$Cuda)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ai = Join-Path $root 'Ai医疗识别\SkinFusion-Seg'
$venv = Join-Path $ai '.venv'
$py = Join-Path $venv 'Scripts\python.exe'

$base = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $base) { throw '未找到 Python，请先安装 Python 3.11-3.13 并加入 PATH。' }
if (-not (Test-Path $venv)) {
    Write-Host '创建 AI 服务虚拟环境...'
    & $base.Source -m venv $venv
}
if (-not (Test-Path $py)) { throw '虚拟环境创建失败。' }
Write-Host '安装 PyTorch（CPU）...'
& $py -m pip install --upgrade pip
if ($Cuda) {
    & $py -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
} else {
    & $py -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
}
Write-Host '安装 AI 服务依赖...'
& $py -m pip install -r (Join-Path $ai 'requirements.txt')
Write-Host 'AI 环境安装完成。'
