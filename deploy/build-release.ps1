[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$')]
    [string]$Version = "2.7.0"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$releaseRoot = Join-Path $projectRoot "release"
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "fangcun-release-$Version-$([Guid]::NewGuid().ToString('N'))"
$archive = Join-Path $releaseRoot "fangcun-release-$Version.tar.gz"

$rootFiles = @(
    ".env.example", "AGENTS.md", "README.md", "package.json", "index.html", "privacy.html", "styles.css", "v22-layout.css",
    "smart-parser.js", "docx-schedule-parser.js", "app.js", "manifest.webmanifest", "icon.svg",
    "appearance.css", "liquid.css", "liquid-select.js", "appearance.js", "appearance-browser-smoke.js", "liquid-renderer.js", "three.module.min.js", "three.core.min.js", "THREE-LICENSE.txt",
    "service-worker.js", "server.js", "outlook-sync.js", "google-sync.js", "reset-password.js", "smart-parser-smoke.js",
    "docx-schedule-smoke.js", "outlook-sync-smoke.js", "google-sync-smoke.js", "smoke-test.js", "runtime-smoke.js",
    "mobile-smoke.js", "mobile-interaction-smoke.js", "v22-smoke.js", "android-smoke.js", "release-smoke.js", "password-reset-smoke.js", "server-smoke.js"
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
    foreach ($docName in @("calendar-sync-guide.md", "deployment-guide.md", "release-2.7.0.md")) {
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

    $originalWrapper = (Get-FileHash -LiteralPath (Join-Path $projectRoot "android\gradle\wrapper\gradle-wrapper.jar") -Algorithm SHA256).Hash
    $stagedWrapper = (Get-FileHash -LiteralPath (Join-Path $stageRoot "android\gradle\wrapper\gradle-wrapper.jar") -Algorithm SHA256).Hash
    if ($originalWrapper -ne $stagedWrapper) { throw "Gradle wrapper binary changed during staging." }
    & tar -czf $archive -C $stageRoot .
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
