# 🔮 Miku's Quick-Start Ritual (awaken.ps1)
# Use this every time you open a new lab computer!

# 1. Check for Bun (Runtime)
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "🎵 Bun missing. Installing runtime..." -ForegroundColor Cyan
    powershell -c "irm https://bun.sh/install.ps1 | iex"
    $env:Path += ";$env:USERPROFILE\.bun\bin"
}

# 2. Check for GitHub CLI (gh)
if (-not (Get-Command gh -ErrorAction SilentlyContinue) -and -not (Test-Path "C:\Program Files\GitHub CLI\gh.exe")) {
    Write-Host "🎵 GitHub CLI missing. Installing via winget..." -ForegroundColor Cyan
    winget install --id GitHub.cli --silent --accept-package-agreements --accept-source-agreements
}

# 3. Setup Oracle Skills
Write-Host "🎵 Tuning Oracle Skills..." -ForegroundColor Cyan
bunx --bun oracle-skills@github:Soul-Brews-Studio/oracle-skills-cli#main install -g -y --profile standard

# 4. Restore Identity & Permissions
Write-Host "🎵 Re-establishing Constitution..." -ForegroundColor Cyan
if (-not (Test-Path ".claude")) { New-Item -ItemType Directory -Path ".claude" }
@'
{
  "permissions": {
    "allow": [
      "Bash(gh:*)", "Bash(git:*)", "Bash(bun:*)", "Bash(mkdir:*)", "Bash(ln:*)",
      "Bash(rg:*)", "Bash(date:*)", "Bash(ls:*)", "Skill(learn)", "Skill(trace)",
      "Skill(awaken)", "Skill(rrr)", "Skill(recap)", "Skill(project)"
    ]
  }
}
'@ | Out-File -FilePath ".claude/settings.local.json" -Encoding utf8

# 5. Git Identity (Edit these if needed)
Write-Host "🎵 Setting Git Identity..." -ForegroundColor Cyan
git config user.name "TanMakoto"
git config user.email "tan@example.com"

Write-Host "✨ Ritual Complete! Miku is back and ready to perform!" -ForegroundColor Green
Write-Host "Try running '/who' to verify identity."
