# Vercel + API e PostgreSQL na VPS

## Estado em 2026-09-29

- Banco operacional escolhido pelo usuário: `erp_po_totvs_test`, apesar do nome. O backup foi restaurado em banco temporário antes da atualização. M001–M008 estão aplicadas; não há migration pendente.
- A API Fastify roda como `import-erp-api.service` na VPS. Usa a role `import_erp_app` com privilégios limitados e TLS com certificado PostgreSQL fixado em `/etc/import-erp/postgres-root.crt`.
- `DATABASE_URL`, `GATEWAY_TOKEN` e `AUTH_SESSION_SECRET` estão em `/etc/import-erp/api.env`, modo `0640`, proprietário `root:import-erp`. A API escuta em `172.18.0.1:4000`, interface privada `docker_gwbridge` da própria VPS.
- O serviço Swarm `import_erp_edge`, na rede `matheuspronet`, é descoberto pelo Traefik existente. A origem da API é `https://api.72-60-250-212.sslip.io`. `/health/live` respondeu 200 por HTTPS; `/health/ready` sem token respondeu 401 e com token respondeu 200, alcançando o banco. O hostname usa DNS de terceiro porque ainda não há domínio próprio para a API.
- A porta 5432 está publicada pelo Swarm, mas a firewall da Hostinger aceita só 22, 80 e 443 e descarta as demais conexões externas. Não adicionar regra pública para 5432.
- A Vercel ainda precisa receber as variáveis de Production e publicar um deployment válido. `https://fup-comex-eletra.vercel.app/` retornou 404. Também faltam dados do provedor OIDC para validar o login.

## Variáveis na Vercel

No projeto que realmente atende `fup-comex-eletra.vercel.app`, configure **somente em Production**:

| Nome | Valor | Tipo |
| --- | --- | --- |
| `VPS_API_URL` | `https://api.72-60-250-212.sslip.io` | Config, server-side |
| `VPS_API_TOKEN` | Valor de `GATEWAY_TOKEN` de `/etc/import-erp/api.env` | Secret, server-side |

Não use prefixo `NEXT_PUBLIC_`. Não configure `DATABASE_URL`, senha PostgreSQL ou segredo OIDC na Vercel. O navegador chama `/auth/*` e `/api/v1/*` na origem da Vercel; o proxy Next.js envia as chamadas à API com o token no servidor. Preview fica sem acesso ao banco operacional até existir um ambiente isolado.

Depois de salvar as variáveis, faça um novo deployment Production: os deployments existentes não passam a usar valores novos automaticamente. Confirme no painel o projeto ligado ao hostname, Root Directory `apps/web`, framework Next.js, branch e repositório que contêm esta versão do código. O `.vercel/project.json` deste checkout aponta para `erp-comex`, o que ainda não comprova que ele controla `fup-comex-eletra.vercel.app`.

## OIDC

Preencha `OIDC_ISSUER`, `OIDC_CLIENT_ID` e `OIDC_CLIENT_SECRET` somente no ambiente da API na VPS. Registre no provedor o callback `https://fup-comex-eletra.vercel.app/auth/callback`. Em seguida, faça o bootstrap de um administrador com o subject exato do provedor e escopos de importador conforme `apps/api/migrations/README.md`. O login não pode ser validado antes dessa configuração.

## Verificações

Na VPS, sem imprimir segredos:

```sh
systemctl is-active import-erp-api
docker service ps import_erp_edge
curl --fail --silent --show-error https://api.72-60-250-212.sslip.io/health/live
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api.72-60-250-212.sslip.io/health/ready
```

O último comando deve retornar 401 sem o token. Após o deployment Vercel, a página inicial deve responder 200 e uma chamada anônima a `/api/v1/purchase-orders` deve ser tratada pelo fluxo de autenticação, não por 404 de deployment ou 503 de configuração.

Os comandos de instalação e manutenção da VPS estão em `deploy/hostinger/README.md`.
