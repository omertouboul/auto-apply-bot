# Secure credentials helper for AutoApply AI
# This script prompts for your API keys and updates the config.json file securely.

$configPath = "C:\Users\micha\Desktop\google ai\config.json"

if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found! Please run from the project root."
    exit
}

# Read existing config
$config = Get-Content $configPath | ConvertFrom-Json

Write-Host "====== AutoApply AI Credentials Setup ======" -ForegroundColor Cyan
Write-Host "Please enter your keys below. Password fields will hide your typing." -ForegroundColor Yellow
Write-Host ""

# Get Gemini Key
$geminiSecure = Read-Host -AsSecureString "Enter your Google Gemini API Key"
$bstr1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($geminiSecure)
$geminiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr1)

# Get Email
$smtpUser = Read-Host "Enter your Sender Email Address (e.g., yourname@gmail.com)"

# Get SMTP Password (App Password for Gmail)
$passSecure = Read-Host -AsSecureString "Enter your Email SMTP Password / App Password"
$bstr2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($passSecure)
$smtpPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)

if ($geminiKey) {
    $config.geminiKey = $geminiKey
}
if ($smtpUser) {
    $config.smtpUser = $smtpUser
}
if ($smtpPass) {
    $config.smtpPass = $smtpPass
}

# Save back to file
$config | ConvertTo-Json | Out-File $configPath -Encoding utf8

Write-Host ""
Write-Host "[SUCCESS] Credentials saved successfully to config.json!" -ForegroundColor Green
Write-Host "You can now start the Auto-Pilot agent in the dashboard." -ForegroundColor Green
