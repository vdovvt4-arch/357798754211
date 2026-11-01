param([string]$SourceDir)
# =========================================================
#  Power Gym - نافذة تثبيت بشريط تقدّم
# =========================================================
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ElectronVer = '33.2.1'
$InstallDir  = Join-Path $env:LOCALAPPDATA 'Programs\Power Gym'
$TmpZip      = Join-Path $env:TEMP "powergym-electron-$ElectronVer.zip"
$SourceDir   = (Resolve-Path ($SourceDir.Trim('"').TrimEnd('\'))).Path.TrimEnd('\')

# ---------- الواجهة ----------
$form = New-Object System.Windows.Forms.Form
$form.Text            = 'Power Gym - تثبيت'
$form.Size            = New-Object System.Drawing.Size(540, 210)
$form.StartPosition   = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox     = $false
$form.MinimizeBox     = $false
$form.BackColor       = [System.Drawing.Color]::FromArgb(7, 17, 31)
$form.ForeColor       = [System.Drawing.Color]::White

function New-Label($x, $y, $w, $h, $size, $bold, $color) {
    $l = New-Object System.Windows.Forms.Label
    $l.Location    = New-Object System.Drawing.Point($x, $y)
    $l.Size        = New-Object System.Drawing.Size($w, $h)
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $l.Font        = New-Object System.Drawing.Font('Segoe UI', $size, $style)
    $l.ForeColor   = $color
    $l.RightToLeft = 'Yes'
    $form.Controls.Add($l)
    return $l
}

$titleLbl  = New-Label 20 14 490 28 13 $true ([System.Drawing.Color]::White)
$titleLbl.Text = 'تثبيت Power Gym'
$statusLbl = New-Label 20 52 490 22 10 $false ([System.Drawing.Color]::FromArgb(125, 211, 252))
$statusLbl.Text = 'جاري التحضير...'

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(20, 84)
$bar.Size     = New-Object System.Drawing.Size(490, 26)
$bar.Minimum  = 0
$bar.Maximum  = 100
$form.Controls.Add($bar)

$detailLbl = New-Label 20 120 490 20 8 $false ([System.Drawing.Color]::FromArgb(148, 163, 184))
$detailLbl.Text = ''

$form.Show()

function Set-Step($text, $pct, $detail) {
    $statusLbl.Text = $text
    $bar.Value = [int][Math]::Min(100, [Math]::Max(0, $pct))
    $detailLbl.Text = $detail
    [System.Windows.Forms.Application]::DoEvents()
}

function Stop-WithError($msg) {
    $form.Close()
    [System.Windows.Forms.MessageBox]::Show($msg, 'Power Gym', 'OK', 'Error') | Out-Null
    exit 1
}

try {
    if (-not (Test-Path (Join-Path $SourceDir 'app\main.js'))) {
        Stop-WithError "ملفات البرنامج ناقصة. فك ضغط الملف كامل وشغّل Install.bat من داخل المجلد."
    }

    # ---------- 1) بيئة التشغيل ----------
    $runtimeZip = Join-Path $SourceDir 'electron-win.zip'
    if (-not (Test-Path $runtimeZip)) {
        $runtimeZip = $TmpZip
        if (-not (Test-Path $runtimeZip)) {
            Set-Step 'جاري تحميل البرنامج (مرة وحدة فقط)...' 2 ''
            $url = "https://github.com/electron/electron/releases/download/v$ElectronVer/electron-v$ElectronVer-win32-x64.zip"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $req   = [System.Net.HttpWebRequest]::Create($url)
            $resp  = $req.GetResponse()
            $total = [double]$resp.ContentLength
            $in    = $resp.GetResponseStream()
            $out   = [System.IO.File]::Create($TmpZip)
            $buf   = New-Object byte[] 262144
            $got   = 0.0
            while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
                $out.Write($buf, 0, $n)
                $got += $n
                if ($total -gt 0) {
                    $pct = 2 + ($got / $total) * 68
                    $detail = ('{0:N1} MB من {1:N1} MB' -f ($got / 1MB), ($total / 1MB))
                    Set-Step 'جاري تحميل البرنامج (مرة وحدة فقط)...' $pct $detail
                }
            }
            $out.Close(); $in.Close(); $resp.Close()
            $runtimeZip = $TmpZip
        }
    }

    # ---------- 2) تنظيف النسخة القديمة (البيانات محفوظة بالـ Documents) ----------
    Set-Step 'جاري تجهيز المجلد...' 72 ''
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    # ---------- 3) فك الملفات ----------
    Set-Step 'جاري فك الملفات...' 76 'قد تاخذ ثواني'
    Expand-Archive -LiteralPath $runtimeZip -DestinationPath $InstallDir -Force

    Rename-Item -Path (Join-Path $InstallDir 'electron.exe') -NewName 'Power Gym.exe'
    $defaultApp = Join-Path $InstallDir 'resources\default_app.asar'
    if (Test-Path $defaultApp) { Remove-Item -Force $defaultApp }

    # ---------- 4) نسخ ملفات التطبيق ----------
    Set-Step 'جاري تثبيت ملفات البرنامج...' 86 ''
    Copy-Item -Recurse -Force (Join-Path $SourceDir 'app') (Join-Path $InstallDir 'resources\app')
    Copy-Item -Force (Join-Path $SourceDir 'Uninstall.bat') (Join-Path $InstallDir 'Uninstall Power Gym.bat')

    # ---------- 5) الاختصارات ----------
    Set-Step 'جاري إنشاء الاختصارات...' 93 ''
    $ws   = New-Object -ComObject WScript.Shell
    $icon = Join-Path $InstallDir 'resources\app\build\icon.ico'
    foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
        $s = $ws.CreateShortcut((Join-Path $dir 'Power Gym.lnk'))
        $s.TargetPath       = Join-Path $InstallDir 'Power Gym.exe'
        $s.WorkingDirectory = $InstallDir
        $s.IconLocation     = $icon
        $s.Description      = 'Power Gym'
        $s.Save()
    }

    # ---------- 6) التسجيل في الإعدادات (Installed apps) ----------
    Set-Step 'جاري التسجيل في إعدادات ويندوز...' 97 ''
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerGym'
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name DisplayName     -Value 'Power Gym'  -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name DisplayVersion  -Value '2.1.0'      -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name Publisher       -Value 'FRD'        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name InstallLocation -Value $InstallDir  -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name DisplayIcon     -Value $icon        -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name UninstallString -Value ('"' + (Join-Path $InstallDir 'Uninstall Power Gym.bat') + '"') -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $key -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

    # ---------- انتهى ----------
    Set-Step 'تم التثبيت بنجاح ✅' 100 ('البيانات محفوظة في: ' + [Environment]::GetFolderPath('MyDocuments') + '\Power Gym')
    Start-Sleep -Milliseconds 600
    $answer = [System.Windows.Forms.MessageBox]::Show('تم تثبيت Power Gym. تبي تفتحه الحين؟', 'Power Gym', 'YesNo', 'Information')
    $form.Close()
    if ($answer -eq 'Yes') { Start-Process -FilePath (Join-Path $InstallDir 'Power Gym.exe') }
}
catch {
    Stop-WithError ("صار خطأ أثناء التثبيت:`n" + $_.Exception.Message + "`n`nتأكد من الإنترنت وحاول مرة ثانية.")
}
