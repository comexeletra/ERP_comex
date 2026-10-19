# ERP Comex — acompanhamento de POs TOTVS

Aplicação de acompanhamento de pedidos de compra e processos de importação. A
arquitetura alvo usa Next.js/React na Vercel Free e uma API Fastify com
PostgreSQL privado na VPS Hostinger. O browser chama a mesma origem; o proxy
Next encaminha `/auth/*` e `/api/v1/*` à VPS com token server-only.

## Estado atual

A API Fastify roda na VPS com PostgreSQL, gateway HTTPS, sessões no banco e
login por contas locais. Duas contas Master foram criadas para administrar os
demais usuários, seus papéis e seus escopos de importadoras. O frontend Next.js
roda na Vercel e usa o proxy server-side para a API. O banco operacional, o
banco de testes e a base de homologação estão em M001–M034. A homologação
`erp_po_totvs_hml` preserva a estrutura e começa sem registros de aplicação.
OIDC/PKCE continua no código para integração futura. O estado vigente e as pendências estão em
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
na Vercel. O banco de homologação tem credenciais próprias em
`/etc/import-erp/homologation-db.env`; mantenha Preview separado de Production.
Mantenha a porta PostgreSQL bloqueada pela firewall externa.

Os modelos `systemd`/Nginx e o procedimento de instalação estão em
[deploy/hostinger/README.md](deploy/hostinger/README.md). API, PostgreSQL e
proxy HTTPS devem iniciar automaticamente na VPS; assim a operação não depende
do computador pessoal. Detalhes e limites estão em [VERCEL_SETUP.md](VERCEL_SETUP.md).

## Migrations

As migrations PostgreSQL reaproveitáveis estão em `apps/api/migrations` e são
aplicadas pelo runner explícito em `apps/api/src/migrate.ts`. Não são executadas
automaticamente no startup. M016 e M017 foram validadas em cópia restaurada e
aplicadas ao banco operacional após backup verificado. O ledger está em 17/17.
O runner exige
`MIGRATION_ENV` e uma credencial dedicada para produção. Consulte o runbook
antes de aplicar novas migrations.

## Dados locais e Git

Arquivos de ambiente, bancos locais, planilhas e arquivos ZIP são ignorados pelo
Git. A planilha histórica e o ZIP local foram preservados no computador; eles
não fazem parte do snapshot do repositório. Não coloque credenciais, arquivos
reais ou backups em commits.

## Teste ponta a ponta

O workflow API CI executa o sistema completo em um PostgreSQL descartável: inicia a API Fastify, o Next.js e o worker de exportação, autentica pelo login real e percorre o proxy até o banco. O cenário cobre solicitação de compra, criação de PO com itens, distribuição entre dois IPs, saldos, datas independentes, encerramento, indicadores e exportação Excel (`.xlsx`) processada pela fila. Ele roda em pull requests e em pushes para `main` quando API ou frontend mudam.

Para reproduzir localmente, instale as dependências, aplique as migrations em um PostgreSQL local descartável chamado `*_ci` ou `*_test` e compile a API. Defina `DATABASE_URL` para esse banco e execute `bash .github/scripts/run-system-e2e.sh`. O script valida o destino, inicia API e frontend com credenciais de teste e encerra os processos ao terminar.
