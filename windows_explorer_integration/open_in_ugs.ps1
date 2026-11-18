param(
    [Parameter(Mandatory = $true)]
    [string]$TargetFile
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "ugs_path.txt"

function Find-UgsExecutable {
    if (Test-Path $configPath) {
        $saved = (Get-Content $configPath -Raw).Trim().Trim('"')
        if ($saved -and (Test-Path $saved)) { return $saved }
    }

    $candidates = @(
        "C:\Program Files\ugsplatform*\bin\ugsplatform64.exe",
        "C:\Program Files\ugsplatform*\bin\ugsplatform.exe",
        "C:\Program Files (x86)\ugsplatform*\bin\ugsplatform.exe",
        "C:\ugsplatform*\bin\ugsplatform64.exe",
        "C:\ugsplatform*\bin\ugsplatform.exe",
        "$env:USERPROFILE\Downloads\ugsplatform*\bin\ugsplatform64.exe",
        "$env:USERPROFILE\Downloads\ugsplatform*\bin\ugsplatform.exe",
        "$env:USERPROFILE\Descargas\ugsplatform*\bin\ugsplatform64.exe",
        "$env:USERPROFILE\Desktop\ugsplatform*\bin\ugsplatform64.exe",
        "$env:USERPROFILE\Escritorio\ugsplatform*\bin\ugsplatform64.exe",
        "$env:LOCALAPPDATA\ugsplatform*\bin\ugsplatform64.exe"
    )

    foreach ($pattern in $candidates) {
        $found = Get-Item -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

$ugsExe = Find-UgsExecutable

if (-not $ugsExe) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "No se encontró ugsplatform64.exe automáticamente. Selecciona dónde está instalado Universal Gcode Sender (solo se pide esta vez).",
        "Catálogo CNC - Ubicar UGS",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null

    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = "Selecciona ugsplatform64.exe o ugsplatform.exe"
    $dlg.Filter = "UGS Platform (ugsplatform*.exe)|ugsplatform*.exe|Todos los ejecutables (*.exe)|*.exe"
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $ugsExe = $dlg.FileName
        Set-Content -Path $configPath -Value $ugsExe -Encoding UTF8
    } else {
        exit 0
    }
} else {
    Set-Content -Path $configPath -Value $ugsExe -Encoding UTF8
}

$resolvedFile = (Resolve-Path -LiteralPath $TargetFile).Path
Start-Process -FilePath $ugsExe -ArgumentList @("--open", "`"$resolvedFile`"")
