# Opens a private tunnel from this computer to the RMG Desk database, through the SSM bastion.
# Then connect MySQL Workbench to 127.0.0.1:3307 (SSL: Require). Ctrl+C or closing the window ends it.
# Needs: AWS CLI v2, the Session Manager plugin, and an "rmgdesk" SSO profile (aws configure sso --profile rmgdesk).
#
#   .\scripts\db-tunnel.ps1                 (prod)
#   .\scripts\db-tunnel.ps1 -Env staging
#
# Works in Windows PowerShell 5.1 and PowerShell 7. Exit codes are checked by hand because
# PowerShell 5.1 treats anything the AWS CLI writes to stderr as a fatal error under "Stop".
param(
  [string]$Env = "prod",
  [string]$AwsProfile = "rmgdesk",
  [int]$LocalPort = 3307
)
$ErrorActionPreference = "Continue"
$region = "eu-west-2"

function Fail($message) {
  Write-Host ""
  Write-Host $message -ForegroundColor Red
  exit 1
}

# Sign in again if the SSO session has expired (it lasts for the permission set's session duration).
cmd /c "aws sts get-caller-identity --profile $AwsProfile >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Your AWS sign-in has expired. A browser window will open to sign in again..."
  aws sso login --profile $AwsProfile
  if ($LASTEXITCODE -ne 0) { Fail "AWS sign-in failed. Check that 'aws configure sso --profile $AwsProfile' has been run." }
}

$json = aws cloudformation describe-stacks --stack-name "RmgDesk-$Env" --region $region --profile $AwsProfile `
  --query "Stacks[0].Outputs" --output json
if ($LASTEXITCODE -ne 0 -or -not $json) { Fail "Could not read the RmgDesk-$Env stack. Check your AWS access to the rmgdesk account." }

$outputs = ($json | Out-String) | ConvertFrom-Json
$bastion = ($outputs | Where-Object { $_.OutputKey -eq "BastionInstanceId" }).OutputValue
$db = ($outputs | Where-Object { $_.OutputKey -eq "DbEndpoint" }).OutputValue
if (-not $bastion -or -not $db) { Fail "The stack outputs did not include the bastion or the database address." }

Write-Host ""
Write-Host "Tunnel: 127.0.0.1:$LocalPort -> $db (via $bastion)" -ForegroundColor Green
Write-Host "Leave this window open while you use MySQL Workbench. Ctrl+C to close."
Write-Host ""
aws ssm start-session --profile $AwsProfile --region $region --target $bastion `
  --document-name AWS-StartPortForwardingSessionToRemoteHost `
  --parameters "host=$db,portNumber=3306,localPortNumber=$LocalPort"
if ($LASTEXITCODE -ne 0) {
  Fail "The tunnel could not start. If it says TargetNotConnected, wait 2 minutes and try again; if it mentions SessionManagerPlugin, install the Session Manager plugin."
}