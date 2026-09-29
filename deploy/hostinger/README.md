# API ERP na VPS Hostinger

Esta instalação usa a VPS `matheusproserv` e o banco operacional `erp_po_totvs_test` escolhido pelo usuário. O computador corporativo não executa componentes de produção. O código da API fica em `/opt/import-erp/apps/api`; configurações e segredos ficam em `/etc/import-erp`.

## Serviços

- `import-erp-api.service`: API Node 24, usuário de sistema `import-erp`, porta `172.18.0.1:4000` da rede privada `docker_gwbridge`.
- `import_erp_edge`: serviço Swarm Traefik dedicado à ponte interna; sem porta publicada. O Traefik compartilhado termina TLS e encaminha `api.72-60-250-212.sslip.io` para ele.
- PostgreSQL existente no serviço `postgres_postgres`: banco `erp_po_totvs_test`, role de runtime `import_erp_app`; a role separada `erp_po_totvs_migrator` é usada somente para migrations.

O provedor Hostinger permite 22, 80 e 443 e bloqueia as outras portas públicas. A porta 5432 continua publicada pelo Swarm, então mantenha a regra de firewall externa que a bloqueia. Não altere as rotas ou portas do Traefik compartilhado para manter os outros serviços.

## Ambiente e credenciais

`/etc/import-erp/api.env` contém `DATABASE_URL`, `DATABASE_POOL_MAX`, `GATEWAY_TOKEN`, `AUTH_SESSION_SECRET`, `APP_PUBLIC_ORIGIN`, `HOST` e `PORT`; ele pertence a `root:import-erp` com modo `0640`. A URL do PostgreSQL usa `127.0.0.1` **da VPS** e TLS verificado pelo certificado fixado em `/etc/import-erp/postgres-root.crt`. O serviço não lê a credencial de migrations.

`/etc/import-erp/migration-release.env` contém a URL da role de migrations, pertence a `root:root` e tem modo `0600`. Não envie o conteúdo desses arquivos a chats, logs ou ao Git. No painel Vercel Production, `VPS_API_URL=https://api.72-60-250-212.sslip.io` e `VPS_API_TOKEN` deve ter o mesmo valor do `GATEWAY_TOKEN`. O token deve ser do tipo Secret. Não configure `DATABASE_URL` na Vercel.

Ainda faltam `OIDC_ISSUER`, `OIDC_CLIENT_ID` e `OIDC_CLIENT_SECRET`, além do callback `https://fup-comex-eletra.vercel.app/auth/callback`, para habilitar login. Sem OIDC, o teste de conexão com PostgreSQL e a rota de health funcionam, mas o fluxo de usuário não está pronto.

## Backup e migrations

Antes de aplicar M008, foi criado `/var/backups/import-erp/erp_po_totvs_test_20260929T144804Z.dump` e a restauração foi verificada em banco temporário. SHA256: `0b5ddab3fc8aa588538ddbceaff9ebe9daffe52f89b627a20eb2fa024b98f99c`. M008 foi aplicada primeiro nessa cópia, depois no banco escolhido. O ledger real registra M001–M008, sem pendências. Não aplique migrations automaticamente na inicialização da API.

Para um novo release, inspecione o estado, faça backup restaurável e use o runner explícito de `apps/api`; a API lê credenciais diferentes das migrations. Os scripts deste diretório registram a sequência executada para este release. `publish-api-traefik.sh` cria a rota HTTPS somente uma vez e recusa alterar um serviço `import_erp_edge` existente.

## Verificação rápida

```sh
systemctl is-active import-erp-api
docker service ps import_erp_edge
curl --fail --silent --show-error https://api.72-60-250-212.sslip.io/health/live
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api.72-60-250-212.sslip.io/health/ready
```

As respostas esperadas são `active`, uma task `Running`, `{"status":"ok"}` e 401 sem token. Para a verificação autenticada, use o token somente dentro da VPS e não o imprima. `journalctl -u import-erp-api` e `docker service logs import_erp_edge` ajudam a diagnosticar falhas sem ler arquivos de segredo.
