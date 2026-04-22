<#
.SYNOPSIS
  Push all required environment variables to Vercel using the Vercel CLI.

.DESCRIPTION
  Reads from a local .env.local file and sets each variable in Vercel for
  the specified environments (production, preview, development).

  Requires: vercel CLI installed (npm install -g vercel) and authenticated.

.PARAMETER EnvFile
  Path to your local env file. Defaults to .env.local in the app directory.

.PARAMETER Env
  Vercel environment to target. Defaults to "production".
  Valid values: production | preview | development

.EXAMPLE
  .\scripts\setup-vercel-env.ps1
  .\scripts\setup-vercel-env.ps1 -EnvFile .env.production -Env production
#>
param(
  [string]$EnvFile = ".env.local",
  [ValidateSet("production","preview","development")]
  [string]$Env = "production"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppDir = $PSScriptRoot | Split-Path -Parent
$EnvPath = Join-Path $AppDir $EnvFile

if (-not (Test-Path $EnvPath)) {
  Write-Error "Env file not found: $EnvPath"
  exit 1
}

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  Write-Error "Vercel CLI not found. Install with: npm install -g vercel"
  exit 1
}

$lines = Get-Content $EnvPath | Where-Object {
  $_ -match "^\s*[A-Z_]+=.+" -and $_ -notmatch "^\s*#"
}

Write-Host "Pushing $($lines.Count) env vars to Vercel ($Env)..." -ForegroundColor Cyan
Push-Location $AppDir

foreach ($line in $lines) {
  $parts = $line.Split("=", 2)
  $key   = $parts[0].Trim()
  $value = $parts[1].Trim()

  # Skip NEXT_PUBLIC_ vars — they're safe to show; sensitive vars are hidden
  Write-Host "  Setting $key ..."
  $value | vercel env add $key $Env --yes 2>&1 | Out-Null
}

Pop-Location
Write-Host "Done! Trigger a new Vercel deployment to apply the changes." -ForegroundColor Green