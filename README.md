# ERP Comex — acompanhamento de POs TOTVS

Aplicação de acompanhamento de pedidos de compra e processos de importação. A
arquitetura alvo usa Next.js/React na Vercel Free e uma API Fastify com
PostgreSQL privado na VPS Hostinger. O browser chama a mesma origem; o proxy
Next encaminha `/auth/*` e `/api/v1/*` à VPS com token server-only.

## Estado atual

A limpeza removeu do snapshot principal o backend ASP.NET Core, os projetos
SQLite, o runner .NET, Docker Compose, Keycloak/Azurite locais e scripts de
bootstrap vinculados a essa stack. A API Fastify tem health checks, validação
do gateway, login OIDC/PKCE e sessão PostgreSQL parciais, CSRF, logout, runner
explícito de migrations e bootstrap manual do primeiro administrador. Migrations
foram aplicadas e reaplicadas no banco isolado da VPS; issuer OIDC, autorização
de negócio e endpoints operacionais seguem pendentes. **Não usar em produção operacional ainda.** O
progresso e o histórico anterior estão em
[CHECKLIST_IMPLEMENTACAO.md](CHECKLIST_IMPLEMENTACAO.md); o desenho completo está
em [Plano_Implementacao_ERP_PO_TOTVS.md](Plano_Implementacao_ERP_PO_TOTVS.md).

## Requisitos

- Node.js 24.x e Corepack/pnpm.
- PostgreSQL de desenvolvimento/teste isolado, caso queira iniciar a API.
- GitHub e projeto Vercel configurado separadamente.
- Docker e .NET não são requisitos da stack alvo.

## Desenvolvimento

Instale os lockfiles de cada aplicação:

```powershell
corepack pnpm --dir apps/web install --frozen-lockfile
corepack pnpm --dir apps/api install --frozen-lockfile
```

Inicie o frontend:

```powershell
corepack pnpm --dir apps/web dev
```

Para iniciar a API em desenvolvimento, copie `apps/api/.env.example` para
`apps/api/.env`; configure um banco de teste e um `GATEWAY_TOKEN` aleatório com
pelo menos 32 bytes. Nunca use as credenciais ou a base operacional para
experimentação local.

```powershell
corepack pnpm --dir apps/api dev
```

A API escuta em `127.0.0.1:4000`. `/health/live` é público e não consulta o
banco; `/health/ready` exige o header do gateway. Rotas OIDC existem, mas
dependem de configuração de issuer e validação de sessão/CSRF em PostgreSQL.
Endpoints de negócio ainda estão pendentes. O Next.js usa `API_DEV_ORIGIN` para
reescrever as chamadas durante desenvolvimento local.

## Publicação

Configure o projeto Vercel com Root Directory `apps/web`. Cadastre somente
`VPS_API_URL` e `VPS_API_TOKEN` no painel Vercel, server-side e separados por
Preview/Production. Na VPS, configure `DATABASE_URL`, `GATEWAY_TOKEN`, OIDC e o
segredo de sessão; mantenha PostgreSQL em loopback e não abra a porta 5432 à
internet.

Os modelos `systemd`/Nginx e o procedimento de instalação estão em
[deploy/hostinger/README.md](deploy/hostinger/README.md). API, PostgreSQL e
proxy HTTPS devem iniciar automaticamente na VPS; assim a operação não depende
do computador pessoal. Detalhes e limites estão em [VERCEL_SETUP.md](VERCEL_SETUP.md).

## Migrations

As migrations PostgreSQL reaproveitáveis estão em `apps/api/migrations` e são
aplicadas pelo runner explícito em `apps/api/src/migrate.ts`. Não são executadas
automaticamente no startup. M001–M007 passaram por status inicial, aplicação e
reaplicação no banco isolado de teste da VPS; checksum, concorrência, upgrade e
TLS de produção ainda precisam de validação. O runner
exige `MIGRATION_ENV`; alvos remotos isolados também exigem
`ALLOW_REMOTE_MIGRATIONS=true`. Consulte o runbook antes de aplicar qualquer
migration.

## Dados locais e Git

Arquivos de ambiente, bancos locais, planilhas e arquivos ZIP são ignorados pelo
Git. A planilha histórica e o ZIP local foram preservados no computador; eles
não fazem parte do snapshot do repositório. Não coloque credenciais, arquivos
reais ou backups em commits.
