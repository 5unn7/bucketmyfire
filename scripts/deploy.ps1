# Build the game and publish dist/ to the `gh-pages` branch (GitHub Pages).
#
# Deploys the EXACT current working tree's build — it does NOT commit your source,
# touch `main`, or disturb your working tree. The gh-pages branch holds dist/ only,
# as a fresh orphan commit each time (history-free, always pristine).
#
# Live URL: https://5unn7.github.io/bucketmyfire/
#
# Usage (from anywhere):  powershell -File scripts/deploy.ps1
#
# Note: the leaderboard's Supabase keys are read from .env at BUILD time, so make sure
# .env is present before running (see .env.example). Without it the board ships "offline".

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  Write-Host '== building (tsc gate + vite build) ==' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'build failed — fix the error above and re-run' }

  $gitdir = Join-Path $repo '.git'
  $ticks  = (Get-Date).Ticks
  $stage  = Join-Path $env:TEMP "bmf-pub-$ticks"      # staging copy of dist/
  $idx    = Join-Path $env:TEMP "bmf-idx-$ticks"      # temp index, OUTSIDE staging so it's never committed
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Copy-Item (Join-Path $repo 'dist\*') $stage -Recurse -Force
  New-Item -ItemType File (Join-Path $stage '.nojekyll') -Force | Out-Null   # tell Pages: serve as-is, no Jekyll

  $env:GIT_INDEX_FILE = $idx
  git "--git-dir=$gitdir" "--work-tree=$stage" add -A -f
  $tree   = (git "--git-dir=$gitdir" write-tree).Trim()
  $stamp  = (Get-Date -Format 'yyyy-MM-dd HH:mm')
  $commit = (git "--git-dir=$gitdir" commit-tree $tree -m "deploy: gh-pages build $stamp").Trim()
  git "--git-dir=$gitdir" push origin "${commit}:refs/heads/gh-pages" --force

  Write-Host ''
  Write-Host "== deployed (commit $commit) ==" -ForegroundColor Green
  Write-Host '   Live in ~30-60s at: https://5unn7.github.io/bucketmyfire/' -ForegroundColor Green
}
finally { Pop-Location }
