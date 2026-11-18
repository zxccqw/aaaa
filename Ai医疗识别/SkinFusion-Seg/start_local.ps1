param(
    [string]$Python = 'python',
    [string]$Bind = '127.0.0.1',
    [int]$Port = 8000
)
Set-Location $PSScriptRoot
# Local test dependencies are optional and are not included in the deployment zip.
if (Test-Path -LiteralPath '.test_deps') {
    $env:PYTHONPATH = (Resolve-Path '.test_deps').Path
}
& $Python -m uvicorn service.app:app --host $Bind --port $Port --workers 1
