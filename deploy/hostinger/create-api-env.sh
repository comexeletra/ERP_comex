#!/usr/bin/env bash
# Run on the VPS as root. Secrets are entered interactively and never stored in Git.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'Execute como root na VPS.' >&2
  exit 1
fi
if ! getent group import-erp >/dev/null; then
  echo 'Crie primeiro o grupo/usuario import-erp conforme o runbook.' >&2
  exit 1
fi
if [[ -e /etc/import-erp/api.env ]]; then
  echo '/etc/import-erp/api.env ja existe; nenhuma alteracao foi feita.' >&2
  exit 1
fi
if ! command -v openssl >/dev/null; then
  echo 'openssl e necessario para gerar os segredos.' >&2
  exit 1
fi

read -r -s -p 'DATABASE_URL do banco real na VPS (postgresql://...): ' database_url
printf '\n'
if [[ ! ${database_url} =~ ^postgres(ql)?://[^/]+@(127\.0\.0\.1|localhost)(:[0-9]+)?/[^/?#]+(\?[^[:space:]]*)?$ ]] || [[ ${database_url} =~ [[:space:]\\] ]]; then
  echo 'DATABASE_URL invalida. Use o banco real via loopback da VPS e percent-encode caracteres especiais.' >&2
  exit 1
fi
database_name=${database_url%%\?*}
database_name=${database_name##*/}
read -r -p "Confirme o banco de destino digitando ${database_name}: " confirmed_database_name
if [[ ${confirmed_database_name} != "${database_name}" ]]; then
  echo 'Nome do banco nao confirmado; nenhuma alteracao foi feita.' >&2
  exit 1
fi
read -r -p 'Origem publica ativa da Vercel (https://...; Enter se pendente): ' app_origin
if [[ -n ${app_origin} && ! ${app_origin} =~ ^https://[^/@?#[:space:]]+/?$ ]]; then
  echo 'APP_PUBLIC_ORIGIN deve ser uma origem HTTPS sem caminho.' >&2
  exit 1
fi
app_origin=${app_origin%/}

read -r -p 'OIDC_ISSUER HTTPS (Enter se ainda nao houver provedor): ' oidc_issuer
oidc_client_id=''
oidc_client_secret=''
if [[ -n ${oidc_issuer} ]]; then
  if [[ -z ${app_origin} ]]; then
    echo 'OIDC requer a origem publica ativa da Vercel.' >&2
    exit 1
  fi
  if [[ ! ${oidc_issuer} =~ ^https://[^[:space:]]+$ ]]; then
    echo 'OIDC_ISSUER invalido.' >&2
    exit 1
  fi
  read -r -p 'OIDC_CLIENT_ID: ' oidc_client_id
  read -r -s -p 'OIDC_CLIENT_SECRET: ' oidc_client_secret
  printf '\n'
  if [[ -z ${oidc_client_id} || -z ${oidc_client_secret} ]]; then
    echo 'Informe ID e segredo OIDC juntos.' >&2
    exit 1
  fi
  if [[ ${oidc_client_id} =~ [[:space:]\\] ]] || [[ ${oidc_client_secret} =~ [[:space:]\\] ]]; then
    echo 'Valores OIDC com whitespace ou backslash precisam de tratamento adicional no EnvironmentFile.' >&2
    exit 1
  fi
fi

gateway_token=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)
install -d -o root -g import-erp -m 0750 /etc/import-erp
umask 077
temporary_file=$(mktemp /etc/import-erp/api.env.XXXXXX)
trap 'rm -f -- "$temporary_file"' EXIT
{
  printf 'DATABASE_URL=%s\n' "$database_url"
  printf 'DATABASE_POOL_MAX=5\n'
  printf 'GATEWAY_TOKEN=%s\n' "$gateway_token"
  printf 'AUTH_SESSION_SECRET=%s\n' "$session_secret"
  if [[ -n ${app_origin} ]]; then
    printf 'APP_PUBLIC_ORIGIN=%s\n' "$app_origin"
  fi
  printf 'HOST=127.0.0.1\nPORT=4000\n'
  if [[ -n ${oidc_issuer} ]]; then
    printf 'OIDC_ISSUER=%s\n' "$oidc_issuer"
    printf 'OIDC_CLIENT_ID=%s\n' "$oidc_client_id"
    printf 'OIDC_CLIENT_SECRET=%s\n' "$oidc_client_secret"
    printf 'OIDC_CLIENT_AUTH_METHOD=client_secret_basic\n'
  fi
} > "$temporary_file"
chown root:import-erp "$temporary_file"
chmod 0640 "$temporary_file"
mv -- "$temporary_file" /etc/import-erp/api.env
trap - EXIT

echo 'Criado /etc/import-erp/api.env (root:import-erp, 0640).'
echo 'Copie o valor de GATEWAY_TOKEN para VPS_API_TOKEN em Vercel Production por canal seguro.'
echo 'Se OIDC ficou vazio, o login permanecera indisponivel ate a configuracao do provedor.'
