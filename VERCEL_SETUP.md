# Publicação: Vercel + API e PostgreSQL na Hostinger

## Arquitetura

- **Vercel:** frontend Next.js/React, Root Directory **apps/web**, framework Next.js.
- **VPS Hostinger:** API Fastify persistente e PostgreSQL privado. A API escuta em **127.0.0.1:4000** e acessa o PostgreSQL localmente.
- **Conexão:** o proxy do Next encaminha **/auth/** e **/api/v1/** por HTTPS e acrescenta o header **x-import-erp-gateway-token**. A variável **DATABASE_URL** fica somente na API da VPS; a Vercel não conecta diretamente ao PostgreSQL. A porta 5432 permanece fechada externamente.
- **Independência do computador:** frontend, API, banco e proxy HTTPS devem operar em serviços hospedados. Nenhum serviço de produção depende do computador de desenvolvimento.

O projeto Vercel **erp-comex** já está configurado com Root Directory **apps/web** e framework Next.js. Production e Preview ainda não têm variáveis configuradas. Há dois deployments Production Ready anteriores à correção do Root Directory; ainda não houve redeploy. A API ainda precisa ser instalada/configurada na VPS, conectada ao banco adequado, publicada por hostname HTTPS e validada com OIDC.

A API Fastify já implementa OIDC/PKCE, sessão PostgreSQL, CSRF, logout, autorização por identidade/escopos, leitura de POs e fila de qualidade. O login real ainda depende de issuer e credenciais OIDC; M001–M007 foram validadas apenas no banco isolado **erp_po_totvs_test**. M008 está pendente de validação isolada. Não liberar para uso operacional até validar banco, API e identidade de produção.

## Contrato de variáveis

### Vercel Production

Cadastre somente estas variáveis server-side no projeto **erp-comex**:

| Nome | Tipo | Valor |
|---|---|---|
| **VPS_API_URL** | Texto server-side | Origem HTTPS real da API, sem caminho, query ou credenciais |
| **VPS_API_TOKEN** | Secret | Igual ao **GATEWAY_TOKEN** da API de produção na VPS |

Não cadastre **DATABASE_URL**, segredos OIDC ou senha PostgreSQL na Vercel. Nunca use prefixo **NEXT_PUBLIC_** nessas variáveis. O browser chama a origem Vercel; o proxy server-side encaminha a chamada e injeta o token.

O proxy valida que **VPS_API_URL** é HTTPS e uma origem sem caminho. Se **VPS_API_URL** ou **VPS_API_TOKEN** estiver ausente, retorna HTTP 503 para as rotas de API e autenticação; não existe fallback para localhost em produção.

### Serviço API de produção na VPS

O arquivo **/etc/import-erp/api.env**, modo **0640** e proprietário **root:import-erp**, contém:

| Nome | Valor/finalidade |
|---|---|
| **DATABASE_URL** | PostgreSQL de produção por loopback, com role de aplicação de menor privilégio |
| **DATABASE_POOL_MAX** | Limite de conexões do pool da API |
| **GATEWAY_TOKEN** | Mesmo valor de **VPS_API_TOKEN** da Vercel Production, com pelo menos 32 bytes |
| **OIDC_ISSUER** | Issuer HTTPS corporativo |
| **OIDC_CLIENT_ID** / **OIDC_CLIENT_SECRET** | Credenciais do cliente OIDC; o segredo fica somente na VPS |
| **AUTH_SESSION_SECRET** | Segredo aleatório independente para sessões |
| **APP_PUBLIC_ORIGIN** | **https://erp-comex.vercel.app**; registrar também callback **/auth/callback** no provedor |
| **HOST** / **PORT** | **127.0.0.1** / **4000**, atrás de Nginx ou túnel HTTPS |

**MIGRATION_DATABASE_URL** e **MIGRATION_ENV** pertencem somente ao job manual de release, com role separada. Não devem permanecer no ambiente do serviço da API.

Gere os segredos no servidor e transfira o token de gateway para a Vercel por sessão autenticada, marcando-o como Secret. Não imprima ou inclua segredos em terminal/logs, Git, documentação ou conversa.

### Vercel Preview

Deixe **VPS_API_URL** e **VPS_API_TOKEN** ausentes em Preview até instalar uma API de staging ligada a banco isolado, token próprio e cliente OIDC de teste. Não aponte Preview para a API ou banco de produção. Cada instância da API aceita um único **GATEWAY_TOKEN**, então reutilizar o serviço de produção para Preview quebra o isolamento dos segredos.

## Configuração da VPS

1. Confirmar domínio/hostname da API, DNS, certificado TLS válido, Node 24 e PostgreSQL.
2. Confirmar qual banco será usado em produção, role da aplicação, backup e restauração.
3. Revisar e aplicar migrations pelo job explícito de release. M001–M007 foram validadas no banco isolado; validar M008 isoladamente. Não aplicar DDL no startup da API.
4. Instalar a API compilada como serviço persistente usando **deploy/hostinger/import-erp-api.service**.
5. Criar **/etc/import-erp/api.env** na VPS com valores reais; não copiar placeholders sem substituí-los e revisar.
6. Configurar Nginx com certificado válido ou Cloudflare Tunnel. Expor HTTPS da API; manter API em loopback e PostgreSQL privado.
7. Configurar OIDC para a origem Vercel Production e callback **https://erp-comex.vercel.app/auth/callback**.
8. Cadastrar **VPS_API_URL** e **VPS_API_TOKEN** somente em Vercel Production.

O roteiro operacional está em **deploy/hostinger/README.md**. Use o projeto Vercel ligado ao GitHub para publicar a revisão validada; não dependa de execução local contínua.

## Validação antes do uso operacional

- [ ] API persistente ativa na VPS, acessível pelo hostname HTTPS escolhido.
- [ ] PostgreSQL apropriado para produção escolhido e acessível localmente pela API.
- [ ] Backup restaurável confirmado antes de migrations de produção.
- [ ] OIDC de produção, callback, usuário autorizado e escopos provisionados.
- [ ] Vercel Production contém **VPS_API_URL** e **VPS_API_TOKEN** como valores server-side.
- [ ] Preview permanece sem acesso à produção até existir staging separado.
- [ ] Build/deployment Vercel e smoke/E2E autenticado validados na URL publicada.
- [ ] UAT concluído antes de liberar uso operacional.