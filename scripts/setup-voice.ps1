param(
    [string]$Python = 'python',
    [string]$ModelDirectory = ''
)

$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
    param([string]$Stage)
    if ($LASTEXITCODE -ne 0) {
        throw "$Stage fehlgeschlagen (Exitcode $LASTEXITCODE). Bitte Ausgabe oben prüfen und das Skript erneut starten."
    }
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($ModelDirectory)) {
    $localData = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($localData)) {
        throw 'Lokaler App-Datenordner nicht gefunden. -ModelDirectory als absoluten Pfad angeben.'
    }
    $ModelDirectory = Join-Path $localData 'JarvisStudio\voice-models'
}
if (-not [IO.Path]::IsPathRooted($ModelDirectory) -or $ModelDirectory -match '^[A-Za-z]:(?:$|[^\\/])') {
    throw '-ModelDirectory muss ein absoluter Pfad außerhalb des Repositories sein.'
}
$modelRoot = [IO.Path]::GetFullPath($ModelDirectory)
$repoPrefix = $repoRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($modelRoot.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $modelRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Das Sprachmodell darf nicht im öffentlichen Repository liegen. Einen Pfad außerhalb wählen.'
}

if (-not (Get-Command $Python -ErrorAction SilentlyContinue)) {
    throw 'Python 3.13 fehlt. Python installieren und danach setup-voice.ps1 erneut starten.'
}
$version = (& $Python -c "import sys; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor))" 2>$null | Out-String).Trim()
Assert-NativeSuccess 'Python-Versionsprüfung'
if ($version -ne '3.13') {
    throw "Python 3.13 benötigt; gefunden: $version. Mit -Python den Pfad zu Python 3.13 angeben."
}

$venv = Join-Path $repoRoot '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    Write-Host 'Erstelle lokale Python-Laufzeit .venv ...'
    & $Python -m venv $venv
    Assert-NativeSuccess 'Python-Umgebung'
}
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    throw 'Die Python-Umgebung wurde nicht vollständig erstellt. .venv prüfen und erneut starten.'
}
$venvVersion = (& $venvPython -c "import sys; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor))" 2>$null | Out-String).Trim()
Assert-NativeSuccess 'Python-Umgebung'
if ($venvVersion -ne '3.13') {
    throw "Die vorhandene .venv verwendet Python $venvVersion statt 3.13. Bitte .venv bewusst entfernen und das Skript erneut starten."
}

Write-Host 'Installiere geprüfte lokale Sprachpakete ...'
& $venvPython -m pip install --disable-pip-version-check 'faster-whisper==1.2.1' 'av==18.1.0'
Assert-NativeSuccess 'Python-Pakete'

New-Item -ItemType Directory -Path $modelRoot -Force | Out-Null
$env:JARVIS_STUDIO_WHISPER_MODEL_DIR = $modelRoot
$env:JARVIS_STUDIO_PYTHON = $venvPython
$offlineCode = "import os; from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root=os.environ['JARVIS_STUDIO_WHISPER_MODEL_DIR'], local_files_only=True)"

# Loading with local_files_only is the idempotence check. A second setup never
# contacts Hugging Face when the model is already usable.
& $venvPython -c $offlineCode 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Whisper-base-Modell fehlt oder ist unvollständig; lade es einmalig in den lokalen Datenordner ...'
    $downloadCode = "import os; from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root=os.environ['JARVIS_STUDIO_WHISPER_MODEL_DIR'])"
    & $venvPython -c $downloadCode
    Assert-NativeSuccess 'Whisper-Modell-Download'
    & $venvPython -c $offlineCode
    Assert-NativeSuccess 'Offline-Modellprüfung'
}

Write-Host 'Lokale Spracheingabe bereit. Aufnahme und Modell bleiben auf diesem Rechner.'
Write-Host 'Für einen neuen PowerShell-Prozess vor npm run dev setzen:'
Write-Host ('$env:JARVIS_STUDIO_PYTHON = ''' + $venvPython.Replace("'", "''") + '''')
Write-Host ('$env:JARVIS_STUDIO_WHISPER_MODEL_DIR = ''' + $modelRoot.Replace("'", "''") + '''')
