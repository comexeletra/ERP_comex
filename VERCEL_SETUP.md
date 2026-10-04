# Vercel + API e PostgreSQL na VPS

> Os números de migrations e verificações abaixo registram 2026-09-29. Para o
> estado vigente, consulte [CHECKLIST_ATUAL_IMPLEMENTACAO.md](CHECKLIST_ATUAL_IMPLEMENTACAO.md).
> O histórico posterior registra M001–M014 aplicadas; confira o ledger da VPS
> antes de um novo release.

## Estado registrado em 2026-09-29

- Banco operacional escolhido pelo usuário: `erp_po_totvs_test`, apesar do nome. M001–M009 estão aplicadas; não há migration pendente. M009 foi validada numa cópia restaurada antes de produção.
- A API Fastify roda como `import-erp-api.service` na VPS. Usa a role `import_erp_app` com privilégios limitados e TLS com certificado PostgreSQL fixado em `/etc/import-erp/postgres-root.crt`.
- `DATABASE_URL`, `GATEWAY_TOKEN` e `AUTH_SESSION_SECRET` estão em `/etc/import-erp/api.env`, modo `0640`, proprietário `root:import-erp`. A API escuta em `172.18.0.1:4000`, interface privada `docker_gwbridge` da própria VPS.
- O serviço Swarm `import_erp_edge`, na rede `matheuspronet`, é descoberto pelo Traefik existente. A origem da API é `https://api.72-60-250-212.sslip.io`. `/health/live` respondeu 200 por HTTPS; `/health/ready` sem token respondeu 401 e com token respondeu 200, alcançando o banco. O hostname usa DNS de terceiro porque ainda não há domínio próprio para a API.
- A porta 5432 está publicada pelo Swarm, mas a firewall da Hostinger aceita só 22, 80 e 443 e descarta as demais conexões externas. Não adicionar regra pública para 5432.
- O projeto Vercel `erp-comex`, ligado ao GitHub `comexeletra/ERP_comex`, tem `VPS_API_URL` e `VPS_API_TOKEN` em Production. O frontend em `https://fup-comex-eletra.vercel.app/` responde 200. O login inicial usa contas locais; OIDC fica para uma etapa futura.

## Variáveis na Vercel

No projeto que realmente atende `fup-comex-eletra.vercel.app`, configure **somente em Production**:

| Nome | Valor | Tipo |
| --- | --- | --- |
| `VPS_API_URL` | `https://api.72-60-250-212.sslip.io` | Config, server-side |
| `VPS_API_TOKEN` | Valor de `GATEWAY_TOKEN` de `/etc/import-erp/api.env` | Secret, server-side |

Não use prefixo `NEXT_PUBLIC_`. Não configure `DATABASE_URL`, senha PostgreSQL ou segredo OIDC na Vercel. O navegador chama `/auth/*` e `/api/v1/*` na origem da Vercel; o proxy Next.js envia as chamadas à API com o token no servidor. Preview fica sem acesso ao banco operacional até existir um ambiente isolado.

O código exige `PREVIEW_API_URL` e `PREVIEW_API_TOKEN` em deployments Vercel
que não sejam Production. Configure essas variáveis somente depois de provisionar
uma API e um banco de teste isolados; o proxy não reutiliza as variáveis de
Production como fallback. Enquanto Preview não estiver configurado, as rotas da
API respondem 503.

Depois de alterar as variáveis, faça um novo deployment Production: os deployments existentes não passam a usar valores novos automaticamente. O projeto tem Root Directory `apps/web`, framework Next.js e branch `main`.

## Login local e OIDC futuro

Os masters entram em `/login`, trocam a senha inicial e gerenciam outros usuários em `/admin/users`. OIDC não é necessário nesta fase. Quando um provedor for escolhido, mantenha `OIDC_ISSUER`, `OIDC_CLIENT_ID` e `OIDC_CLIENT_SECRET` somente na VPS e registre `https://fup-comex-eletra.vercel.app/auth/callback` como callback.

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
