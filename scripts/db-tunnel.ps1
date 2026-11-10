# Opens a private tunnel from this computer to the RMG Desk database, through the SSM bastion.
# Then connect MySQL Workbench to 127.0.0.1:3307 (SSL: Require). Ctrl+C or closing the window ends it.
# Needs: AWS CLI v2, the Session Manager plugin, and an "rmgdesk" SSO profile (aws configure sso --profile rmgdesk).
#
#   .\scripts\db-tunnel.ps1                 (prod)
#   .\scripts\db-tunnel.ps1 -Env staging
param(
  [string]$Env = "prod",
  [string]$AwsProfile = "rmgdesk",
  [int]$LocalPort = 3307
)
$ErrorActionPreference = "Stop"
$region = "eu-west-2"

# Sign in again if the SSO session has expired (it lasts for the permission set's session duration).
aws sts get-caller-identity --profile $AwsProfile *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Signing in to AWS..."
  aws sso login --profile $AwsProfile
}

$outputs = aws cloudformation describe-stacks --stack-name "RmgDesk-$Env" --region $region --profile $AwsProfile `
  --query "Stacks[0].Outputs" | ConvertFrom-Json
$bastion = ($outputs | Where-Object OutputKey -eq "BastionInstanceId").OutputValue
$db = ($outputs | Where-Object OutputKey -eq "DbEndpoint").OutputValue

Write-Host ""
Write-Host "Tunnel: 127.0.0.1:$LocalPort -> $db (via $bastion)"
Write-Host "Leave this window open while you use MySQL Workbench. Ctrl+C to close."
Write-Host ""
aws ssm start-session --profile $AwsProfile --region $region --target $bastion `
  --document-name AWS-StartPortForwardingSessionToRemoteHost `
  --parameters "host=$db,portNumber=3306,localPortNumber=$LocalPort"