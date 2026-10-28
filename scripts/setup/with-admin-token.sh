#!/usr/bin/env bash
# Runs a command with a fresh 24-hour Admin API token in its environment (Dev Dashboard app, client credentials grant).
# Why: Dev Dashboard tokens expire after 24 hours, and the scripts under scripts/shopify and scripts/catalog read
# SHOPIFY_ADMIN_API_ACCESS_TOKEN from the environment only. Nothing secret is printed or written.
#
# Credentials come from the environment (STORE, ADMIN_CLIENT_ID, ADMIN_CLIENT_SECRET) or, when unset, from
# storefront/.env.demo (git-ignored). Usage: bash scripts/setup/with-admin-token.sh <command> [args...]
set -euo pipefail
ENVF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/storefront/.env.demo"
# val <ENV_NAME> <FILE_KEY>: the environment wins, the env file is the fallback.
val() {
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f "$ENVF" ]; then v=$(grep -E "^$2=" "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r"' || true); fi
  printf '%s' "$v"
}
STORE=$(val STORE PUBLIC_STORE_DOMAIN)
CID=$(val ADMIN_CLIENT_ID ADMIN_CLIENT_ID)
CSEC=$(val ADMIN_CLIENT_SECRET ADMIN_CLIENT_SECRET)
if [ -z "$STORE" ] || [ -z "$CID" ] || [ -z "$CSEC" ]; then echo "Missing STORE, ADMIN_CLIENT_ID or ADMIN_CLIENT_SECRET." >&2; exit 2; fi
RESP=$(curl -s -X POST "https://$STORE/admin/oauth/access_token" -d grant_type=client_credentials -d client_id="$CID" -d client_secret="$CSEC")
TOK=$(echo "$RESP" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$TOK" ]; then echo "Token request failed: $(echo "$RESP" | sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p')" >&2; exit 9; fi
echo "token ok (length ${#TOK}); scopes: $(echo "$RESP" | sed -n 's/.*"scope":"\([^"]*\)".*/\1/p')" >&2
export STORE SHOPIFY_ADMIN_API_ACCESS_TOKEN="$TOK" SHOPIFY_ALLOWED_STORES="$STORE"
exec "$@"
