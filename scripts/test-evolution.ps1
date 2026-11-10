# Sends one XML file to the MRI Evolution workflow, exactly as the helpdesk worker would, and shows
# what comes back. Use it to find the XML format the RMGRaiseTask workflow accepts without deploying.
#
#   .\scripts\test-evolution.ps1 -XmlFile .\scripts\evolution-test.xml
#
# The address and credentials are read from Secrets Manager (rmgdesk-prod/mri-evolution); the
# password is never printed. A request Evolution accepts creates a REAL task: use test wording.
# Works in Windows PowerShell 5.1 and PowerShell 7.
param(
  [Parameter(Mandatory = $true)][string]$XmlFile,
  [string]$Env = "prod",
  [string]$AwsProfile = "rmgdesk"
)
$ErrorActionPreference = "Continue"

if (-not (Test-Path $XmlFile)) { Write-Host "File not found: $XmlFile" -ForegroundColor Red; exit 1 }

$raw = aws secretsmanager get-secret-value --secret-id "rmgdesk-$Env/mri-evolution" --region eu-west-2 `
  --profile $AwsProfile --query SecretString --output text
if ($LASTEXITCODE -ne 0 -or -not $raw) {
  Write-Host "Could not read the secret. Run 'aws sso login --profile $AwsProfile' and try again." -ForegroundColor Red
  exit 1
}
$secret = ($raw | Out-String) | ConvertFrom-Json

$workflow = if ($secret.workflow) { $secret.workflow } else { "RMGRaiseTask" }
$base = $secret.url.Split("?")[0]
$url = "{0}?name={1}&username={2}&password={3}" -f $base,
  [uri]::EscapeDataString($workflow), [uri]::EscapeDataString($secret.username), [uri]::EscapeDataString($secret.password)

Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false   # Evolution signals failure by redirecting: show it, don't follow it
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(30)

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $XmlFile))
$content = New-Object System.Net.Http.ByteArrayContent(, $bytes)
$content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue("text/xml")

Write-Host ""
Write-Host "POST $base  (workflow $workflow, user $($secret.username))"
try {
  $response = $client.PostAsync($url, $content).GetAwaiter().GetResult()
} catch {
  Write-Host "The request did not reach Evolution: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
$status = [int]$response.StatusCode
$body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
$location = $response.Headers.Location

Write-Host "Status:   $status $($response.StatusCode)"
if ($location) { Write-Host "Location: $location" }
Write-Host "Type:     $($response.Content.Headers.ContentType)"
Write-Host "Body (first 600 characters):"
Write-Host ($body.Substring(0, [Math]::Min(600, $body.Length)))
Write-Host ""

$looksLikePage = $body -match "(?i)^\s*<!DOCTYPE\s+html|^\s*<html[\s>]|Log in to Evolution"
if ($status -ge 300 -and $status -lt 400) {
  Write-Host "RESULT: REJECTED - Evolution redirected to its error or login page." -ForegroundColor Red
} elseif ($status -lt 200 -or $status -ge 300 -or $looksLikePage) {
  Write-Host "RESULT: REJECTED - Evolution did not run the workflow." -ForegroundColor Red
} else {
  Write-Host "RESULT: ACCEPTED - check Evolution for the new task." -ForegroundColor Green
}
