# ERP Comex — acompanhamento de POs TOTVS

Aplicação de acompanhamento de pedidos de compra e processos de importação. A
arquitetura alvo usa Next.js/React na Vercel Free e uma API Fastify com
PostgreSQL privado na VPS Hostinger. O browser chama a mesma origem; o proxy
Next encaminha `/auth/*` e `/api/v1/*` à VPS com token server-only.

## Estado atual

A limpeza removeu do snapshot principal o backend ASP.NET Core, os projetos
SQLite, o runner .NET, Docker Compose, Keycloak/Azurite locais e scripts de
bootstrap vinculados a essa stack. A API Fastify implementa health checks,
validação do gateway, OIDC/PKCE, sessão PostgreSQL, CSRF, logout, runner
explícito de migrations e bootstrap manual do primeiro administrador. Também
há autorização DEV04 por identidade `(issuer, subject)`, papel e escopo por
importador; leitura de carteira/overview/histórico de POs; e endpoints e tela
para fila/resolução auditada de qualidade. M001–M007 foram validadas no banco
isolado da VPS. M008, login contra issuer real, E2E autenticado e configuração
de produção permanecem pendentes. **Não usar em produção operacional ainda.** O
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
banco; `/health/ready` exige o header do gateway. Rotas OIDC dependem de um
issuer configurado para validação ponta a ponta. A autorização consulta grants
por identidade e exige política explícita; lista e recursos aplicam o escopo na
consulta SQL antes da paginação e retornam 401/403/404 conforme o contrato. O
Next.js usa `API_DEV_ORIGIN` para chamadas durante desenvolvimento local.

## Publicação

O projeto Vercel `erp-comex` está configurado com Root Directory `apps/web` e
framework Next.js. Em Production, cadastre somente `VPS_API_URL` (origem HTTPS
exata da API) e `VPS_API_TOKEN` (Secret que corresponde ao `GATEWAY_TOKEN` da
API). Não configure `DATABASE_URL` nem segredos OIDC na Vercel. Preview fica sem
acesso à API até existir uma API de staging com banco e tokens próprios. Na VPS,
configure `DATABASE_URL`, `GATEWAY_TOKEN`, OIDC e segredo de sessão; mantenha
PostgreSQL em loopback e não abra a porta 5432 à internet. Production e Preview
continuam sem variáveis cadastradas. Há dois deployments Production Ready
anteriores à correção do Root Directory; ainda não houve redeploy com a
configuração corrigida.

Os modelos `systemd`/Nginx e o procedimento de instalação estão em
[deploy/hostinger/README.md](deploy/hostinger/README.md). API, PostgreSQL e
proxy HTTPS devem iniciar automaticamente na VPS; assim a operação não depende
do computador pessoal. Detalhes e limites estão em [VERCEL_SETUP.md](VERCEL_SETUP.md).

## Migrations

As migrations PostgreSQL reaproveitáveis estão em `apps/api/migrations` e são
aplicadas pelo runner explícito em `apps/api/src/migrate.ts`. Não são executadas
automaticamente no startup. M001–M007 passaram por status inicial, aplicação e
reaplicação no banco isolado de teste da VPS. Também foram verificados checksum
divergente e execução concorrente/upgrade usando uma migration temporária de
prova, removida depois do banco de teste. A migration de produto M008 ainda não
foi aplicada. TLS de produção e execução da CI ainda precisam de validação. O runner
exige `MIGRATION_ENV`; alvos remotos isolados também exigem
`ALLOW_REMOTE_MIGRATIONS=true`. Consulte o runbook antes de aplicar qualquer
migration.

## Dados locais e Git

Arquivos de ambiente, bancos locais, planilhas e arquivos ZIP são ignorados pelo
Git. A planilha histórica e o ZIP local foram preservados no computador; eles
não fazem parte do snapshot do repositório. Não coloque credenciais, arquivos
reais ou backups em commits.
