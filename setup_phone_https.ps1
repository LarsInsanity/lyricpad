$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$certDir = Join-Path $root 'certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $ip) { throw 'Could not find a LAN IPv4 address. Connect the PC to Wi-Fi/Ethernet and try again.' }

Write-Host "Creating LyricPad certificate for localhost and $ip ..." -ForegroundColor Cyan
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=LyricPad Local' }
foreach ($c in $existing) { Remove-Item -Path ("Cert:\CurrentUser\My\" + $c.Thumbprint) -Force -ErrorAction SilentlyContinue }

$cert = New-SelfSignedCertificate `
  -Type Custom `
  -Subject 'CN=LyricPad Local' `
  -FriendlyName 'LyricPad Local HTTPS' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(3) `
  -TextExtension @("2.5.29.19={critical}{text}ca=TRUE", "2.5.29.17={text}DNS=localhost&IPAddress=$ip")

$passText = 'lyricpad'
$pass = ConvertTo-SecureString -String $passText -Force -AsPlainText
$pfx = Join-Path $certDir 'lyricpad-local.pfx'
$cer = Join-Path $certDir 'lyricpad-local.cer'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pass | Out-Null
Export-Certificate -Cert $cert -FilePath $cer -Type CERT | Out-Null

# Trust it on this Windows account so the PC's own HTTPS URL opens cleanly.
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null

$envPath = Join-Path $root '.env'
if (-not (Test-Path $envPath)) {
  if (Test-Path (Join-Path $root '.env.example')) { Copy-Item (Join-Path $root '.env.example') $envPath }
  else { New-Item -ItemType File $envPath | Out-Null }
}
$lines = Get-Content $envPath -ErrorAction SilentlyContinue
$wanted = @{
  'HTTPS'='1'
  'HTTPS_PORT'='8788'
  'HTTPS_PFX'=$pfx.Replace('\\','/')
  'HTTPS_PFX_PASS'=$passText
}
foreach ($key in $wanted.Keys) {
  $value = $wanted[$key]
  $pattern = '^' + [regex]::Escape($key) + '='
  if ($lines -match $pattern) { $lines = $lines | ForEach-Object { if ($_ -match $pattern) { "$key=$value" } else { $_ } } }
  else { $lines += "$key=$value" }
}
Set-Content -Path $envPath -Value $lines -Encoding UTF8

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "HTTPS URL: https://$ip`:8788"
Write-Host "Certificate file for your phone/tablet: $cer"
Write-Host ''
Write-Host 'IMPORTANT: Your phone/tablet must trust this certificate for a fully secure/installable local PWA.' -ForegroundColor Yellow
Write-Host 'Samsung: transfer/download lyricpad-local.cer, install it as a CA certificate in Security settings, then reopen Chrome.'
Write-Host 'iPad: install the downloaded profile/certificate, then enable full trust under Settings > General > About > Certificate Trust Settings.'
Write-Host ''
Write-Host 'Restart run_lyricpad_next.bat after this setup.'
Read-Host 'Press Enter to close'
