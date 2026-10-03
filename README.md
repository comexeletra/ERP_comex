# ERP Comex — acompanhamento de POs TOTVS

Aplicação de acompanhamento de pedidos de compra e processos de importação. A
arquitetura alvo usa Next.js/React na Vercel Free e uma API Fastify com
PostgreSQL privado na VPS Hostinger. O browser chama a mesma origem; o proxy
Next encaminha `/auth/*` e `/api/v1/*` à VPS com token server-only.

## Estado atual

A API Fastify roda na VPS com PostgreSQL, gateway HTTPS, sessões no banco e
login por contas locais. Duas contas Master foram criadas para administrar os
demais usuários, seus papéis e seus escopos de importadoras. O frontend Next.js
roda na Vercel e usa o proxy server-side para a API. O histórico registra
M001–M013 aplicadas no banco operacional `erp_po_totvs_test`. OIDC/PKCE continua
no código para integração futura. O estado vigente e as pendências estão em
[CHECKLIST_ATUAL_IMPLEMENTACAO.md](CHECKLIST_ATUAL_IMPLEMENTACAO.md); a cronologia
está em [CHECKLIST_IMPLEMENTACAO.md](CHECKLIST_IMPLEMENTACAO.md) e o produto
completo em [Plano_Implementacao_ERP_PO_TOTVS.md](Plano_Implementacao_ERP_PO_TOTVS.md).
Para continuar o trabalho em outro computador, siga
[TRABALHAR_EM_DUAS_MAQUINAS.md](TRABALHAR_EM_DUAS_MAQUINAS.md).

## Operação

- Node.js 24.x e Corepack/pnpm.
- PostgreSQL e API na VPS Hostinger; frontend no projeto Vercel `erp-comex`.
- Docker apenas na VPS, onde já hospeda PostgreSQL e Traefik.

O computador corporativo é usado apenas para editar e acompanhar o Git. Builds,
testes integrados, migrations e serviço da API executam na VPS. `/health/ready`
verifica o banco e exige o token do gateway. As rotas de dados aplicam os escopos
de importadoras na consulta SQL.

## Publicação

O projeto Vercel `erp-comex` usa Root Directory `apps/web` e contém
`VPS_API_URL` e `VPS_API_TOKEN` somente em Production. Na VPS,
`/etc/import-erp/api.env` contém `DATABASE_URL`, `GATEWAY_TOKEN`,
`AUTH_SESSION_SECRET` e `APP_PUBLIC_ORIGIN`. Não configure credenciais do banco
na Vercel. Preview fica sem acesso à API operacional até existir ambiente isolado.
Mantenha a porta PostgreSQL bloqueada pela firewall externa.

Os modelos `systemd`/Nginx e o procedimento de instalação estão em
[deploy/hostinger/README.md](deploy/hostinger/README.md). API, PostgreSQL e
proxy HTTPS devem iniciar automaticamente na VPS; assim a operação não depende
do computador pessoal. Detalhes e limites estão em [VERCEL_SETUP.md](VERCEL_SETUP.md).

## Migrations

As migrations PostgreSQL reaproveitáveis estão em `apps/api/migrations` e são
aplicadas pelo runner explícito em `apps/api/src/migrate.ts`. Não são executadas
automaticamente no startup. O histórico registra M013 validada em cópia restaurada
e aplicada ao banco operacional após backup. O runner exige
`MIGRATION_ENV` e uma credencial dedicada para produção. Consulte o runbook
antes de aplicar novas migrations.

## Dados locais e Git

Arquivos de ambiente, bancos locais, planilhas e arquivos ZIP são ignorados pelo
Git. A planilha histórica e o ZIP local foram preservados no computador; eles
não fazem parte do snapshot do repositório. Não coloque credenciais, arquivos
reais ou backups em commits.
