# يجهّز مجلد "Power-Gym-Web" ومجلد "Power-Gym-Mobile" لرفعه على استضافة https أو تشغيله على الهاتف
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Join-Path $PSScriptRoot 'app'
$out = Join-Path $PSScriptRoot 'Power-Gym-Web'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Path $out | Out-Null
New-Item -ItemType Directory -Path (Join-Path $out 'build') | Out-Null

$files = @('index.html','style.css','theme.css','mobile.css','storage-shim.js','app.js','reports.js',
           'receipts.js','extras.js','manifest.json','sw.js','logo.svg','sample_backup.json')
foreach ($f in $files) { Copy-Item -Force (Join-Path $src $f) $out }
foreach ($ic in @('icon.png','icon-192.png','icon-512.png','apple-touch-icon.png')) {
    $icPath = Join-Path $src "build\$ic"
    if (Test-Path $icPath) { Copy-Item -Force $icPath (Join-Path $out 'build') }
}

Write-Host "تم التجهيز بنجاح: $out"
Write-Host "ارفع هذا المجلد كاملاً على الاستضافة (مثال: https://app.netlify.com/drop)."
