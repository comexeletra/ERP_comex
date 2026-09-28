# Publicação alvo: Vercel Free + API e PostgreSQL na Hostinger

## Arquitetura

- **Vercel Free:** Next.js/React/TypeScript, Root Directory `apps/web`.
- **VPS Hostinger:** API Fastify persistente e PostgreSQL. A API escuta em
  `127.0.0.1:4000`; PostgreSQL permanece em loopback/privado.
- **Conexão:** `apps/web/proxy.ts` encaminha `/auth/*` e `/api/v1/*` por HTTPS e
  acrescenta `x-import-erp-gateway-token`. A Vercel não abre conexão direta ao
  PostgreSQL. Não exponha a porta 5432.
- **Independência do PC:** instale API, PostgreSQL e Nginx/túnel como serviços
  com início automático na VPS. Depois do deploy/configuração, o computador
  pessoal pode ficar desligado.
- **Docker:** não é necessário para build ou produção.

O backend ASP.NET Core, SQLite, Compose e Keycloak/Azurite locais foram removidos
do snapshot do repositório. As migrations PostgreSQL reaproveitáveis estão em
`apps/api/migrations`. A API Fastify contém rotas OIDC/PKCE, sessão PostgreSQL,
CSRF, logout, runner explícito de migrations e comando manual de bootstrap do
primeiro administrador. Esses fluxos ainda não foram validados contra PostgreSQL
ou issuer real. Autorização de negócio e endpoints operacionais seguem
pendentes. Não publicar para uso operacional até completar e validar esses
fluxos.

## Variáveis de ambiente

Cadastre Preview e Production separadamente no painel da Vercel. O arquivo
`apps/web/.env.example` lista placeholders; não contém valores utilizáveis.

| Nome | Onde fica | Uso |
|---|---|---|
| `VPS_API_URL` | Vercel, server-only | Origem HTTPS da API, sem caminho, query ou credenciais |
| `VPS_API_TOKEN` | Vercel como Secret | Token de gateway enviado pelo proxy; exclusivo por ambiente |
| `DATABASE_URL` | Serviço API na VPS | Conexão local/privada PostgreSQL com role de menor privilégio |
| `GATEWAY_TOKEN` | Serviço API na VPS | Mesmo token de gateway do ambiente Vercel correspondente |
| `OIDC_ISSUER` | Serviço API na VPS | Issuer HTTPS permitido |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Serviço API na VPS | Credenciais do cliente OIDC |
| `AUTH_SESSION_SECRET` | Serviço API na VPS | Segredo aleatório para sessão, separado por ambiente |
| `APP_PUBLIC_ORIGIN` | Serviço API na VPS | Origem HTTPS do Preview ou Production para redirects/callback |

Nunca coloque secrets em `NEXT_PUBLIC_*`, Git, logs, plano, checklist ou na URL
do banco enviada ao browser. Preview deve usar dados de teste e segredo/token
separados; não deve gravar no banco operacional.

## Configurar a VPS

1. Confirmar sistema operacional, Node 24, versão PostgreSQL, DNS, TLS e espaço
   de armazenamento.
2. Criar role e banco exclusivos da aplicação; confirmar backup e restauração.
3. Instalar/compilar `apps/api` e instalar o serviço
   `deploy/hostinger/import-erp-api.service` como usuário sem privilégios.
4. Criar `/etc/import-erp/api.env` somente na VPS, modo `0640`, com os valores
   reais. Não copiar `.env.example` sem substituir e revisar os placeholders.
5. Configurar Nginx com `deploy/hostinger/nginx-api.conf.example` e certificado
   válido, ou escolher Cloudflare Tunnel. Expor apenas HTTPS à API e manter os
   listeners da API/banco em loopback.
6. Habilitar o serviço no `systemd`; validar health checks sem registrar tokens.
7. Cadastrar `VPS_API_URL`/`VPS_API_TOKEN` no Vercel por ambiente e configurar
   o issuer/callback OIDC correspondente.

O roteiro operacional está em [deploy/hostinger/README.md](deploy/hostinger/README.md).

## Migrations e dados

As migrations SQL PostgreSQL estão em `apps/api/migrations`. Ainda falta um
runner Node com ledger/checksum e validação contra uma base descartável da
mesma versão da VPS. Não aplique os scripts na base operacional antes de backup,
restore de prova e revisão de compatibilidade. A API não executa DDL no startup.

Imports de XLSX/documentos não podem depender do filesystem da Vercel. O parser,
storage privado e processamento durável ainda precisam ser definidos/portados
antes de ativar importações ou workers em produção.

## Checklist de deploy

- [ ] Implementar OIDC Authorization Code + PKCE, callback, sessão persistida,
      logout, CSRF e autorização por papel/escopo na API Node.
- [ ] Portar endpoints de carteira/detalhe, qualidade, workflow, auditoria e
      importação; validar contratos e regras.
- [ ] Implementar e validar migration runner em PostgreSQL de teste.
- [ ] Instalar e habilitar a API como serviço persistente na VPS.
- [ ] Configurar HTTPS, DNS, firewall, gateway token e variáveis separadas.
- [ ] Executar build Vercel, smoke/E2E, backup e restore de prova.
- [ ] Fazer UAT e só então liberar Production.

O MCP da Vercel consta em `~/.codex/config.toml`, mas não apareceu como
ferramenta carregada nesta sessão; nenhum projeto, variável ou deployment da
conta foi inspecionado.
