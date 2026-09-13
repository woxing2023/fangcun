[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$')]
    [string]$Version = "2.7.0-calendar3"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$releaseRoot = Join-Path $projectRoot "release"
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "fangcun-release-$Version-$([Guid]::NewGuid().ToString('N'))"
$archive = Join-Path $releaseRoot "fangcun-release-$Version.tar.gz"

$rootFiles = @(
    ".env.example", "APPEARANCE.md", "README.md", "package.json", "index.html", "privacy.html", "styles.css", "v22-layout.css",
    "smart-parser.js", "docx-schedule-parser.js", "app.js", "manifest.webmanifest", "icon.svg",
    "appearance.css", "xuan.css", "xuan-fibers.svg", "xuan-fibers-mobile.png", "xuan-sans.woff2", "xuan-serif.woff2", "FONT-LICENSE.txt", "material-light.js", "touch-material.js", "mobile-ui.css", "mobile-material.css", "mobile-calendar.css", "calendar-surface.css", "appearance-controls.js", "liquid.css", "liquid-select.js", "appearance.js", "appearance-browser-smoke.js", "xuan-browser-smoke.js", "liquid-material-smoke.js", "liquid-select-smoke.js", "liquid-renderer.js", "three.module.min.js", "three.core.min.js", "THREE-LICENSE.txt",
    "service-worker.js", "server.js", "outlook-sync.js", "google-sync.js", "reset-password.js", "smart-parser-smoke.js",
    "docx-schedule-smoke.js", "outlook-sync-smoke.js", "google-sync-smoke.js", "smoke-test.js", "runtime-smoke.js",
    "mobile-smoke.js", "mobile-interaction-smoke.js", "mobile-calendar-smoke.js", "mobile-material-smoke.js", "mobile-ui-smoke.js", "touch-material-smoke.js", "touch-lifecycle-smoke.js", "gpu-renderer-smoke.js", "runtime-performance-smoke.js", "calendar-engine-smoke.js", "calendar-visual-smoke.js", "calendar-profile.js", "v22-smoke.js", "android-smoke.js", "release-smoke.js", "password-reset-smoke.js", "server-smoke.js",
    "desktop-material-smoke.js", "desktop-browser-smoke.js", "agent-ui-smoke.js"
)

function Assert-StageChild([string]$Target) {
    $resolved = [System.IO.Path]::GetFullPath($Target)
    $prefix = [System.IO.Path]::GetFullPath($stageRoot).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing operation outside release staging directory: $resolved"
    }
}

try {
    New-Item -ItemType Directory -Force -Path $releaseRoot, $stageRoot | Out-Null
    foreach ($file in $rootFiles) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $stageRoot $file)
    }
    foreach ($directory in @("android", "deploy")) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination (Join-Path $stageRoot $directory) -Recurse
    }
    # Whitelist approach: deploy tar only ships operational docs. Internal docs
    # (NEW-CHAT-PROMPT, PROJECT-HANDOFF-*, internal audits, delivery reports) never ship.
    New-Item -ItemType Directory -Path (Join-Path $stageRoot "docs") | Out-Null
    foreach ($docName in @("calendar-sync-guide.md", "deployment-guide.md", "workbench-xuan.md", "xuan-material.md", "mobile-repair.md", "touch-material.md", "release-2.7.0.md", "AGENT-API.md")) {
        $src = Join-Path $projectRoot "docs\$docName"
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $stageRoot "docs")
        }
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot "docs\store") -Destination (Join-Path $stageRoot "docs\store") -Recurse
    New-Item -ItemType Directory -Force -Path (Join-Path $stageRoot "imports\examples") | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot "imports\README.md") -Destination (Join-Path $stageRoot "imports\README.md")
    Copy-Item -LiteralPath (Join-Path $projectRoot "imports\examples\fictional-university-timetable-sample.json") -Destination (Join-Path $stageRoot "imports\examples\fictional-university-timetable-sample.json")

    foreach ($generatedPath in @(
        (Join-Path $stageRoot "android\.gradle"),
        (Join-Path $stageRoot "android\app\build"),
        (Join-Path $stageRoot "android\build"),
        (Join-Path $stageRoot "android\local.properties")
    )) {
        if (Test-Path -LiteralPath $generatedPath) {
            Assert-StageChild $generatedPath
            Remove-Item -LiteralPath $generatedPath -Recurse -Force
        }
    }

    # Never ship signing or machine-local configuration, even outside app/build.
    Get-ChildItem -LiteralPath $stageRoot -File -Recurse | Where-Object {
        $_.Name -in @("local.properties", "signing.properties") -or $_.Name -match '\.(jks|keystore|keystore\.id)$'
    } | ForEach-Object {
        Assert-StageChild $_.FullName
        Remove-Item -LiteralPath $_.FullName -Force
    }

    $originalWrapper = (Get-FileHash -LiteralPath (Join-Path $projectRoot "android\gradle\wrapper\gradle-wrapper.jar") -Algorithm SHA256).Hash
    $stagedWrapper = (Get-FileHash -LiteralPath (Join-Path $stageRoot "android\gradle\wrapper\gradle-wrapper.jar") -Algorithm SHA256).Hash
    if ($originalWrapper -ne $stagedWrapper) { throw "Gradle wrapper binary changed during staging." }
    # Use Windows-native bsdtar: MSYS tar on PATH misreads "C:\..." as a remote host.
    & "$env:SystemRoot\System32\tar.exe" -czf $archive -C $stageRoot .
    if ($LASTEXITCODE -ne 0) { throw "Release archive creation failed." }
    Write-Host "Release archive: $archive"
    Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Format-List
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        $resolvedStage = [System.IO.Path]::GetFullPath($stageRoot)
        $tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
        if ((Split-Path -Parent $resolvedStage) -ne $tempParent -or (Split-Path -Leaf $resolvedStage) -notmatch '^fangcun-release-[0-9a-zA-Z.-]+-[0-9a-f]{32}$') {
            throw "Refusing cleanup of unexpected staging directory: $resolvedStage"
        }
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
