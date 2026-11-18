# ==============================================================================
# Instalador Integración Nativa de Windows Explorer para .nc / .c2d + UGS
# ==============================================================================
# 1. Compila CncShellExtension.cs con el compilador .NET nativo de Windows (csc.exe)
# 2. Registra Preview Handler (Panel Vista Previa Alt+P) y Thumbnail Provider (Iconos Muy Grandes)
# 3. Agrega "Abrir directo en UGS" en el clic derecho de .nc, .gcode, .ngc, .tap y .c2d
# 4. Sincroniza capturas existentes del catálogo hacia las carpetas de diseños
# 5. Limpia caché de miniaturas y reinicia explorer.exe
# ==============================================================================

$ErrorActionPreference = "Stop"

# Auto-elevar a Administrador si es necesario
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[*] Solicitando permisos de Administrador para registrar extensiones del Explorador..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Get-Item $scriptDir).Parent.FullName
$csFile = Join-Path $scriptDir "CncShellExtension.cs"
$dllFile = Join-Path $scriptDir "CncShellExtension.dll"
$vbsPath = Join-Path $scriptDir "open_in_ugs.vbs"

$fwDir = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $fwDir "csc.exe"
$regasm = Join-Path $fwDir "RegAsm.exe"

if (-not (Test-Path $csc) -or -not (Test-Path $regasm)) {
    throw "No se encontró .NET Framework 4.x x64 en $fwDir"
}

Write-Host "[1/5] Compilando CncShellExtension.dll..." -ForegroundColor Cyan
& $csc /nologo /target:library /platform:x64 /optimize+ `
    /reference:System.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /out:"$dllFile" "$csFile"

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dllFile)) {
    throw "Error compilando CncShellExtension.cs"
}
Write-Host "[OK] DLL compilada en $dllFile" -ForegroundColor Green

Write-Host "[2/5] Registrando COM PreviewHandler y ThumbnailProvider (x64)..." -ForegroundColor Cyan
& $regasm /nologo /codebase "$dllFile" | Out-Null

$previewGuid = "{7F3E9C11-8B2A-4D5F-9A1E-4C6B2D8E0F11}"
$thumbGuid   = "{8A4F1D22-9C3B-4E6A-8B2F-5D7C3E9A1B22}"
$previewAppId = "{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}" # prevhost.exe x64 estándar de Windows
$thumbAppId   = "{8A4F1D22-9C3B-4E6A-8B2F-5D7C3E9A1B22}"

# Configurar Preview Handler (prevhost.exe) y DisableProcessIsolation para leer fotos de carpeta
New-Item -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$previewGuid" -Force | Out-Null
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$previewGuid" -Name "(Default)" -Value "Catálogo CNC Preview Handler"
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$previewGuid" -Name "AppID" -Value $previewAppId
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$previewGuid" -Name "DisplayName" -Value "Catálogo CNC Vista Previa"
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$previewGuid" -Name "DisableProcessIsolation" -Value 1 -Type DWord

New-Item -Path "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers" -Force | Out-Null
Set-ItemProperty -Path "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers" -Name $previewGuid -Value "Catálogo CNC Vista Previa"

# Configurar Thumbnail Provider en dllhost surrogate + DisableProcessIsolation para leer fotos de carpeta
New-Item -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$thumbGuid" -Force | Out-Null
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$thumbGuid" -Name "(Default)" -Value "Catálogo CNC Thumbnail Provider"
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$thumbGuid" -Name "AppID" -Value $thumbAppId
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$thumbGuid" -Name "DisableProcessIsolation" -Value 1 -Type DWord

New-Item -Path "Registry::HKEY_CLASSES_ROOT\AppID\$thumbAppId" -Force | Out-Null
Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\AppID\$thumbAppId" -Name "DllSurrogate" -Value ""

# Aprobar ambas extensiones en Shell Extensions Approved
New-Item -Path "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" -Force | Out-Null
Set-ItemProperty -Path "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" -Name $previewGuid -Value "Catálogo CNC Preview Handler"
Set-ItemProperty -Path "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" -Name $thumbGuid -Value "Catálogo CNC Thumbnail Provider"

Write-Host "[3/5] Asociando clic derecho 'Abrir directo en UGS', Vista Previa e Iconos Grandes a .nc, .c2d, .gcode, .ngc, .tap..." -ForegroundColor Cyan
$extensions = @(".nc", ".c2d", ".gcode", ".ngc", ".tap")
$ugsCmd = "wscript.exe `"$vbsPath`" `"%1`""

# Detectar ruta de UGS para el icono del menú contextual si existe
$ugsIcon = ""
$ugsFinder = @(
    "C:\Program Files\ugsplatform*\bin\ugsplatform64.exe",
    "$env:USERPROFILE\Downloads\ugsplatform*\bin\ugsplatform64.exe",
    "$env:USERPROFILE\Descargas\ugsplatform*\bin\ugsplatform64.exe",
    "$env:USERPROFILE\Desktop\ugsplatform*\bin\ugsplatform64.exe"
)
foreach ($pat in $ugsFinder) {
    $m = Get-Item -Path $pat -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $ugsIcon = $m.FullName; break }
}

foreach ($ext in $extensions) {
    # Registrar PreviewHandler & ThumbnailProvider en la extensión y en SystemFileAssociations
    foreach ($baseReg in @(
        "Registry::HKEY_CLASSES_ROOT\$ext",
        "Registry::HKEY_CLASSES_ROOT\SystemFileAssociations\$ext"
    )) {
        New-Item -Path "$baseReg\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}" -Force | Out-Null
        Set-ItemProperty -Path "$baseReg\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}" -Name "(Default)" -Value $previewGuid

        New-Item -Path "$baseReg\shellex\{e357fccd-a995-4576-b01f-234630154e96}" -Force | Out-Null
        Set-ItemProperty -Path "$baseReg\shellex\{e357fccd-a995-4576-b01f-234630154e96}" -Name "(Default)" -Value $thumbGuid
    }

    # También registrar bajo cualquier ProgID o UserChoice asociado al usuario actual
    $progIds = New-Object System.Collections.Generic.List[string]
    try {
        $extDefault = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$ext" -ErrorAction SilentlyContinue).'(default)'
        if ($extDefault) { $progIds.Add($extDefault) }
    } catch {}
    try {
        $uc = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$ext\UserChoice" -ErrorAction SilentlyContinue).ProgId
        if ($uc) { $progIds.Add($uc) }
    } catch {}

    foreach ($pidName in ($progIds | Select-Object -Unique)) {
        if ($pidName) {
            New-Item -Path "Registry::HKEY_CLASSES_ROOT\$pidName\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}" -Force | Out-Null
            Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$pidName\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}" -Name "(Default)" -Value $previewGuid
            New-Item -Path "Registry::HKEY_CLASSES_ROOT\$pidName\shellex\{e357fccd-a995-4576-b01f-234630154e96}" -Force | Out-Null
            Set-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$pidName\shellex\{e357fccd-a995-4576-b01f-234630154e96}" -Name "(Default)" -Value $thumbGuid
        }
    }

    # Menú contextual Clic Derecho -> "Abrir directo en UGS"
    $shellKey = "Registry::HKEY_CLASSES_ROOT\SystemFileAssociations\$ext\shell\OpenInUGS"
    New-Item -Path "$shellKey\command" -Force | Out-Null
    Set-ItemProperty -Path $shellKey -Name "(Default)" -Value "Abrir directo en UGS"
    if ($ugsIcon) {
        Set-ItemProperty -Path $shellKey -Name "Icon" -Value $ugsIcon
    }
    Set-ItemProperty -Path "$shellKey\command" -Name "(Default)" -Value $ugsCmd
}

Write-Host "[4/5] Sincronizando capturas existentes del catálogo hacia tus carpetas CNC..." -ForegroundColor Cyan
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pyCmd) {
    Push-Location $repoRoot
    try {
        & python -c "from app.indexer import sync_all_captures_to_folders; print(sync_all_captures_to_folders())" 2>$null
    } catch {}
    Pop-Location
}

Write-Host "[5/5] Limpiando caché de miniaturas y reiniciando Explorador de Windows..." -ForegroundColor Cyan
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Remove-Item -Path "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache_*.db" -Force -ErrorAction SilentlyContinue
Start-Process explorer.exe

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host " ¡INTEGRACION WINDOWS EXPLORER + UGS INSTALADA CON EXITO!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host " 1. Clic derecho en cualquier .nc o .c2d -> 'Abrir directo en UGS'"
Write-Host " 2. Activa el Panel de Vista Previa (Alt + P) y haz clic en cualquier .nc o .c2d"
Write-Host " 3. Pon Vista -> Iconos Muy Grandes para ver cada foto en la miniatura del archivo"
Write-Host ""
pause
