#!/usr/bin/env bash
# Opens a private tunnel from your laptop to the RMG Desk database through the SSM bastion.
# Then connect MySQL Workbench or dbmate to 127.0.0.1:3307. Ctrl+C closes the tunnel.
# Needs: AWS CLI v2, the Session Manager plugin, and a signed-in AWS profile.
#   ./scripts/db-tunnel.sh            (prod)
#   ./scripts/db-tunnel.sh staging
set -euo pipefail
ENV="${1:-prod}"
STACK="RmgDesk-${ENV}"
REGION="eu-west-2"
LOCAL_PORT="${LOCAL_PORT:-3307}"

out() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BASTION="$(out BastionInstanceId)"
DB_HOST="$(out DbEndpoint)"
echo "Tunnel: 127.0.0.1:${LOCAL_PORT} -> ${DB_HOST}:3306 via ${BASTION}"
echo "Password: aws secretsmanager get-secret-value --region ${REGION} --secret-id rmgdesk-${ENV}/db-admin --query SecretString --output text"
aws ssm start-session --region "$REGION" --target "$BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${DB_HOST}\"],\"portNumber\":[\"3306\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}"
