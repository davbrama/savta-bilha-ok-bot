#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

STACK_NAME="${STACK_NAME:-oref-bot}"
REGION="${AWS_REGION:-il-central-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
DEPLOY_BUCKET="oref-bot-deploy-${ACCOUNT_ID}"

# Ensure deploy bucket exists
if ! aws s3 ls "s3://${DEPLOY_BUCKET}" --region "$REGION" >/dev/null 2>&1; then
  echo "[deploy] Creating deployment bucket: ${DEPLOY_BUCKET}"
  aws s3 mb "s3://${DEPLOY_BUCKET}" --region "$REGION"
fi

echo "[deploy] Packaging..."
aws cloudformation package \
  --template-file template.yaml \
  --s3-bucket "$DEPLOY_BUCKET" \
  --output-template-file packaged.yaml \
  --region "$REGION"

echo "[deploy] Deploying stack '${STACK_NAME}' to ${REGION}..."
aws cloudformation deploy \
  --template-file packaged.yaml \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --region "$REGION" \
  --no-fail-on-empty-changeset

# Show outputs
echo ""
echo "[deploy] Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# Cleanup
rm -f packaged.yaml
