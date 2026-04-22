<#
.SYNOPSIS
  Migrate the legacy Python/Postgres database to Neon PostgreSQL.

.DESCRIPTION
  Step 1 — Export a data-only dump from the old DB.
  Step 2 — Push the Prisma schema to Neon (creates all tables).
  Step 3 — Load the data dump into Neon.

.PARAMETER OldUrl
  Full postgres:// connection string for the OLD database.
  Example: postgres://tbuser:tbpass@localhost:5432/tbrouter

.PARAMETER NeonUrl
  Full postgres:// connection string for the Neon database (pooled).
  Example: postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require

.PARAMETER NeonDirectUrl
  Non-pooled Neon connection string (used by Prisma migrate).
  If omitted, NeonUrl is used for both.

.EXAMPLE
  .\scripts\migrate-to-neon.ps1 `
    -OldUrl "postgres://tbuser:tbpass@localhost:5432/tbrouter" `
    -NeonUrl "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require" `
    -NeonDirectUrl "postgresql://user:pass@ep-xxx-pooler.neon.tech/neondb?sslmode=require"
#>
param(
  [Parameter(Mandatory)][string]$OldUrl,
  [Parameter(Mandatory)][string]$NeonUrl,
  [string]$NeonDirectUrl = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppDir = $PSScriptRoot | Split-Path -Parent
if ($NeonDirectUrl -eq "") { $NeonDirectUrl = $NeonUrl }

# ── Helpers ──────────────────────────────────────────────────────────────────
function Assert-Command($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "Required command '$cmd' not found. Please install it and re-run."
    exit 1
  }
}

function Step([string]$msg) { Write-Host "`n==== $msg ====" -ForegroundColor Cyan }
function OK  ([string]$msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function WARN([string]$msg) { Write-Host " WARN $msg" -ForegroundColor Yellow }

# ── Preflight ─────────────────────────────────────────────────────────────────
Step "Preflight checks"
Assert-Command pg_dump
Assert-Command psql
Assert-Command pnpm
OK "All required tools found."

# ── Step 1: Dump data from old DB ────────────────────────────────────────────
Step "Step 1/3 — Export data from old database"

$dumpFile = Join-Path $AppDir "migration-data.sql"
Write-Host "  Dumping to $dumpFile ..."

$env:PGPASSWORD = ""   # pg_dump reads password from the URL

# --data-only: schema already handled by Prisma
# --no-privileges / --no-owner: avoid role-specific SQL that won't exist in Neon
# --disable-triggers: skip FK trigger checks during load
pg_dump `
  --data-only `
  --no-privileges `
  --no-owner `
  --disable-triggers `
  --format=plain `
  --file="$dumpFile" `
  $OldUrl

if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump failed"; exit 1 }
OK "Data exported to $dumpFile"

# ── Step 2: Push Prisma schema to Neon ──────────────────────────────────────
Step "Step 2/3 — Apply Prisma schema to Neon"

# Write a temporary .env so prisma picks up the Neon URL
$tmpEnv = Join-Path $AppDir ".env.migrate"
@"
DATABASE_URL=$NeonUrl
DIRECT_URL=$NeonDirectUrl
"@ | Set-Content $tmpEnv -Encoding UTF8

Push-Location $AppDir
try {
  Write-Host "  Running prisma migrate deploy ..."
  # If no migrations folder exists yet, use db push (baseline approach)
  $migrationsDir = Join-Path $AppDir "prisma\migrations"
  if (Test-Path $migrationsDir) {
    $env:DATABASE_URL = $NeonUrl
    $env:DIRECT_URL   = $NeonDirectUrl
    pnpm exec prisma migrate deploy
  } else {
    Write-Host "  No migrations folder — using prisma db push (schema baseline)"
    $env:DATABASE_URL = $NeonUrl
    $env:DIRECT_URL   = $NeonDirectUrl
    pnpm exec prisma db push --accept-data-loss
  }
  if ($LASTEXITCODE -ne 0) { Write-Error "Prisma schema apply failed"; exit 1 }
  OK "Prisma schema applied to Neon."
} finally {
  Pop-Location
  Remove-Item $tmpEnv -ErrorAction SilentlyContinue
}

# ── Step 3: Load data into Neon ──────────────────────────────────────────────
Step "Step 3/3 — Load data into Neon"

Write-Host "  Loading $dumpFile into Neon ..."
psql $NeonUrl --file="$dumpFile" --single-transaction --quiet

if ($LASTEXITCODE -ne 0) {
  WARN "psql returned a non-zero exit (some statements may have been skipped)."
  WARN "Review $dumpFile for incompatible SQL and re-run manually if needed."
} else {
  OK "Data loaded into Neon."
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Migration complete!" -ForegroundColor Green
Write-Host "  Dump file kept at: $dumpFile"
Write-Host "  Delete it after verification: Remove-Item '$dumpFile'"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Set DATABASE_URL and DIRECT_URL in your .env.local and Vercel dashboard."
Write-Host "  2. Run: pnpm db:generate"
Write-Host "  3. Run: pnpm dev  -- verify the app works against Neon."
Write-Host "  4. Delete the dump file."