$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$markerPath = Join-Path $projectRoot "artifacts\latest-package-path.txt"

if (-not (Test-Path -LiteralPath $markerPath)) {
  throw "Latest package marker not found: $markerPath"
}

$appDir = (Get-Content -LiteralPath $markerPath -Raw).Trim()
if (-not (Test-Path -LiteralPath $appDir)) {
  throw "Packaged app directory not found: $appDir"
}

$exe = Get-ChildItem -LiteralPath $appDir -Recurse -Filter "Jester's Game Vault.exe" |
  Select-Object -First 1

if (-not $exe) {
  throw "Packaged EXE not found under $appDir"
}

function Get-BetaCodeSigningCertificate {
  $subject = "CN=Jester's Game Vault Beta"
  $existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(7) } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if ($existing) {
    return $existing
  }

  if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
    throw "New-SelfSignedCertificate is unavailable. Set CSC_LINK and CSC_KEY_PASSWORD for real certificate signing."
  }

  return New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -FriendlyName "Jester's Game Vault Beta Code Signing" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(2)
}

if ($env:CSC_LINK) {
  $flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable -bor
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $env:CSC_LINK,
    $env:CSC_KEY_PASSWORD,
    $flags
  )
  Write-Host "Signing with certificate from CSC_LINK."
} else {
  $certificate = Get-BetaCodeSigningCertificate
  Write-Host "Signing with local self-signed beta certificate: $($certificate.Subject)"
}

$signature = Set-AuthenticodeSignature -FilePath $exe.FullName -Certificate $certificate -HashAlgorithm SHA256

if ($signature.Status -notin @("Valid", "UnknownError")) {
  throw "Authenticode signing failed with status $($signature.Status): $($signature.StatusMessage)"
}

Write-Host "Signed EXE: $($exe.FullName)"
Write-Host "Signature status: $($signature.Status)"
