# Plano de implementação — Limite de requisições por cliente real

| Item | Valor |
|---|---|
| Data | 2026-10-26 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + Traefik `import_erp_hml_edge`) e Preview Vercel |
| Depende de | [PLANO_INVOICE_CANDIDATOS_LOTE.md](PLANO_INVOICE_CANDIDATOS_LOTE.md) — executar **depois** dele (os dois alteram `apps/api/src/server.ts`) |
| Status | **Implementado em HML; validação manual em duas redes pendente** |

## Sumário

1. [Resumo](#1-resumo)
2. [Diagnóstico](#2-diagnóstico)
3. [Por que `trustProxy` não resolve](#3-por-que-trustproxy-não-resolve)
4. [Especificação](#4-especificação)
5. [Etapas](#5-etapas)
6. [Deploy e validação](#6-deploy-e-validação)
7. [Arquivos afetados](#7-arquivos-afetados)
8. [Riscos e cuidados](#8-riscos-e-cuidados)

---

## 1. Resumo

| | Problema | Solução |
|---|---|---|
| 1 | Todos os usuários dividem uma única cota de 120 requisições/min da API | Contar o limite pelo IP real de cada cliente |
| 2 | O limite de login (10/min) também é coletivo: quem erra a senha várias vezes, ou um robô, bloqueia o login de **todos** | Mesmo ajuste: 10 tentativas/min **por IP de cliente** |

A Vercel, que já é o único caminho até a API (gateway token), passa a enviar o IP do cliente num cabeçalho próprio. A API só aceita esse cabeçalho quando o gateway token é válido e, sem ele, mantém o comportamento atual.

## 2. Diagnóstico

Levantamento feito em 2026-10-26, somente leitura, na VPS e no código.

### Caminho de uma requisição

```
Navegador
  → Vercel (apps/web/proxy.ts: copia os cabeçalhos do navegador, injeta x-import-erp-gateway-token, rewrite)
    → Traefik público  traefik_traefik (:443, rede overlay matheuspronet 10.0.1.34)
      → Traefik edge HML  import_erp_hml_edge (:8080, /opt/import-erp/homologation-edge.yml)
        → API HML  http://172.18.0.1:4001  (o edge chega pela docker_gwbridge como 172.18.0.16)
```

### Evidências

- **A API vê um único endereço.** `request.ip` é sempre `172.18.0.16`, o edge HML (log de `import-erp-hml-api`). `@fastify/rate-limit` usa `req.ip` como chave por padrão ([server.ts:66](../apps/api/src/server.ts#L66)), então existe **um único balde** para todo mundo.
- **Quem conecta no Traefik público é a Vercel, não o usuário.** As últimas 2.000 requisições do access log para o HML vieram de 7 IPs da AWS sa-east-1 (`54.207.107.89`, `54.232.8.44`, `54.232.151.94`, …), que variam a cada requisição.
- **Nenhum dos Traefiks confia em `X-Forwarded-For` recebido.** Não há `entryPoints.*.forwardedHeaders.trustedIPs` nem `insecure`. Cada salto descarta o `X-Forwarded-*` que chega e grava o próprio.
- **O plugin roda antes de tudo.** `rateLimit` é registrado antes do hook do gateway token e da sessão (`auth.ts`, hook `onRequest` com `UPDATE identity.auth_session`), então requisições sem token também consomem e são barradas pelo limite.
- **Não dá para empilhar dois limitadores.** O plugin (v10.3.0) marca a requisição com `rateLimitRan`, e um segundo limitador criado com `app.rateLimit()` é ignorado na mesma requisição. Por isso o desenho usa **um só limitador** com uma chave melhor.

## 3. Por que `trustProxy` não resolve

Ativar `trustProxy` no Fastify faria `request.ip` vir do `X-Forwarded-For`. Mas o que chega à API nesse cabeçalho é o endereço do Traefik público (`10.0.1.34`): o edge descarta o valor anterior. Mesmo configurando os dois Traefiks para confiar um no outro, o máximo que se obtém é o **IP da Vercel**, que muda a cada requisição e nunca é o do usuário. Ou seja:

- sem mudar o Traefik: a cota continua única;
- mudando o Traefik: a cota vira aleatória, inclusive para o login, e um atacante passa a "renovar" a cota de graça.

**Decisão: não ativar `trustProxy` e não alterar a configuração dos Traefiks.** O IP real só é conhecido pela Vercel, que o repassa num cabeçalho próprio protegido pelo gateway token.

## 4. Especificação

### Objetivo
O limite global e o de login contam requisições por IP do cliente final, sem permitir que o navegador escolha esse IP e sem mudar a infraestrutura da VPS.

### Requisitos

1. **Web (`proxy.ts`)**, nas requisições encaminhadas para `/auth/*` e `/api/v1/*`:
   - Grava `x-import-erp-client-ip` com o IP do cliente informado pela Vercel (`x-real-ip`; se ausente, o primeiro item de `x-forwarded-for`), só se for um IPv4/IPv6 válido.
   - **Sempre** remove qualquer `x-import-erp-client-ip` vindo do navegador antes, porque `proxy.ts` copia todos os cabeçalhos da requisição original.
   - Em desenvolvimento local, ou sem IP válido, o cabeçalho não é enviado.
   - A lógica fica numa função pura `forwardedClientIp(headers: Headers): string | null` em `apps/web/lib/`, sem imports de valores de outros módulos de `lib/`, testável com `node --test`.
2. **API: chave do limitador** em um módulo novo `apps/api/src/rate-limit-key.ts`:
   - `rateLimitKey(request, gatewayToken)` devolve `client:<ip>` quando o gateway token da requisição é válido (comparação em tempo constante) **e** `x-import-erp-client-ip` é um único valor com `net.isIP() !== 0`; caso contrário, `peer:<request.ip>`, que é o comportamento atual.
   - A comparação do token sai do hook em `server.ts` para uma função exportada (`gatewayTokenMatches`) usada pelo hook e pela chave, para evitar duas implementações.
3. **API: configuração** em `server.ts`: `rateLimit` com `keyGenerator: request => rateLimitKey(request, gatewayToken)`.
   - **Limite global: 300/min por chave** (hoje são 120/min para todos juntos). Usuários do mesmo escritório saem pelo mesmo IP público (NAT) e dividem a cota, e 300 cobre esse caso com folga depois do plano de candidatos em lote. Para outro valor, altere aqui antes de executar.
   - Login continua `10/min` ([auth.ts:236](../apps/api/src/auth.ts#L236)), agora por chave, porque a configuração por rota herda o `keyGenerator` global.
4. **Erro 429**, já tratado no plano de candidatos em lote: o `detail` informa a espera, e nada muda aqui.

### Restrições
- Sem `trustProxy`, sem mudança nos Traefiks, nas variáveis da Vercel ou nas units da VPS.
- O IP do cliente não vai para o corpo das respostas nem para logs novos. Os logs atuais do Fastify continuam como estão.
- A mudança é compatível nas duas ordens de deploy: uma API sem suporte ignora o cabeçalho, e uma API nova sem o cabeçalho volta para `peer:<ip>`.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | `forwardedClientIp` usa `x-real-ip`, cai para o primeiro item de `x-forwarded-for` e recusa valores inválidos, vazios ou com várias entradas em `x-real-ip` | `apps/web/test/forwarded-client-ip.test.mjs` (novo) |
| 2 | `proxy.ts` remove o `x-import-erp-client-ip` do navegador e grava o calculado | teste estático do `proxy.ts` no mesmo arquivo (verifica `headers.delete` antes de `headers.set`, como os demais testes estáticos da web) |
| 3 | `rateLimitKey`: token válido + IP válido → `client:<ip>`; token ausente ou errado → `peer:<ip>`; IP inválido ou cabeçalho repetido → `peer:<ip>` | `apps/api/test/rate-limit-key.test.mjs` (novo, incluído no script `test`) |
| 4 | Com o plugin registrado e o `keyGenerator`: dois IPs de cliente têm cotas independentes; o mesmo IP esgota a sua; um cabeçalho forjado sem token cai na cota `peer` compartilhada | mesmo arquivo, com `app.inject` e `max` baixo |
| 5 | O hook do gateway continua respondendo `401` com token ausente ou errado | teste existente ou novo usando `gatewayTokenMatches` |
| 6 | **No HML:** depois do deploy, o login de um segundo navegador ou rede continua funcionando enquanto um primeiro cliente atinge o limite de login | validação manual (seção 6) |

### Fora do escopo
- Cota por usuário autenticado (exigiria mover o limitador para depois da sessão e perderia a proteção contra tráfego sem sessão; ver [seção 8](#8-riscos-e-cuidados)).
- Store compartilhado (Redis). A API roda em processo único por ambiente, e o store em memória continua.
- Produção: só pelo PR de promoção, depois da aprovação no HML.

## 5. Etapas

Cada etapa termina com testes, lint, type-check e build passando e com um commit na `homologacao`.

| Etapa | Conteúdo | Verificação |
|---|---|---|
| 0 | Confirmar na documentação da Vercel ([Request headers](https://vercel.com/docs/headers/request-headers)) que `x-real-ip` e `x-forwarded-for` são sobrescritos pela borda da Vercel (o cliente não consegue forjá-los). **Se a documentação disser o contrário, parar e perguntar.** | anotar o trecho no PR |
| 1 | Testes da web (critérios 1 e 2), que falham | em `apps/web`: `pnpm test` |
| 2 | `lib/forwarded-client-ip.ts` + uso em `proxy.ts` | test, lint, `tsc --noEmit` e build da web |
| 3 | Testes da API (critérios 3 a 5), que falham | em `apps/api`: `pnpm run build && pnpm test` |
| 4 | `rate-limit-key.ts` (`gatewayTokenMatches` + `rateLimitKey`), hook do gateway usando `gatewayTokenMatches`, `keyGenerator` e `max: 300` em `server.ts` | test e build da API |
| 5 | Revisão do próprio diff: spoofing (cabeçalho do navegador, token errado), IPv6, cabeçalho repetido, fallback | — |

## 6. Deploy e validação

1. Publicar `hml-release-<sha>` da API na VPS seguindo [deploy/hostinger/README.md](../deploy/hostinger/README.md) (drop-in novo e backup do anterior). Conferir o health `200`.
2. `git push production homologacao` e acompanhar o Preview até `Ready`, conferindo branch e commit.
3. **Validar que o cabeçalho atravessa os dois Traefiks.** Custom headers não são alterados por eles, mas isso precisa ser confirmado: fazer login no Preview e, por algumas requisições, verificar no log da API (`journalctl -u import-erp-hml-api`) que as chaves de rate limit seguem o formato `client:` — por exemplo, com uma linha de debug **temporária e não commitada** num release de teste, ou pelos headers `x-ratelimit-remaining` de dois clientes diferentes, que devem ser independentes. Não registrar IPs em commits nem no README.
4. Critério 6: errar a senha 11 vezes num navegador e confirmar que outro navegador, em outra rede (por exemplo, o celular no 4G), ainda faz login.
5. Registrar o release e o resultado no README de deploy, sem IPs.

**Rollback:** remover o drop-in novo, `systemctl daemon-reload` e reiniciar `import-erp-hml-api`; reverter o commit da web. Os dois lados são independentes.

## 7. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/web/lib/forwarded-client-ip.ts` | Novo: `forwardedClientIp` |
| `apps/web/proxy.ts` | Remove o cabeçalho do navegador e grava `x-import-erp-client-ip` |
| `apps/web/test/forwarded-client-ip.test.mjs` | Novo |
| `apps/api/src/rate-limit-key.ts` | Novo: `gatewayTokenMatches` e `rateLimitKey` |
| `apps/api/src/server.ts` | Hook do gateway usa `gatewayTokenMatches`; `rateLimit` com `keyGenerator` e `max: 300` |
| `apps/api/test/rate-limit-key.test.mjs` | Novo |
| `apps/api/package.json` | Inclui o teste novo no script `test` |
| `deploy/hostinger/README.md` | Registro do release HML |

## 8. Riscos e cuidados

- **Spoofing:** o navegador não escolhe o IP porque (a) `proxy.ts` sempre remove o valor recebido e (b) a API só confia no cabeçalho com o gateway token, que só a Vercel e a VPS conhecem. Se o token vazar, o risco já é maior que este: o token dá acesso direto à API.
- **Mesmo IP para vários usuários:** usuários atrás do mesmo NAT, como o escritório, continuam dividindo a cota daquele IP. Por isso o limite sobe para 300/min. Uma cota por usuário autenticado exigiria rodar o limitador depois da sessão; com isso, requisições com sessão inválida deixariam de ser limitadas e cada uma faria uma consulta ao banco. Esse custo não compensa agora.
- **IPv6:** um cliente IPv6 pode trocar de endereço dentro do mesmo /64. Aceitável para uma ferramenta interna e fácil de ajustar depois (agrupar por /64 na chave).
- **Produção:** o `proxy.ts` de produção passa a enviar o cabeçalho para a API de produção só depois da promoção. Até a API de produção ser atualizada, o cabeçalho é ignorado, sem efeito colateral.

## 9. Resultado da execução (2026-10-26)

- A documentação oficial da Vercel confirmou que `x-forwarded-for` é
  sobrescrito com o IP público do cliente e que `x-real-ip` recebe o mesmo
  valor.
- API implementada no commit `443b927` e publicada no HML como
  `hml-release-443b927`; banco confirmado como `erp_po_totvs_hml`, serviço
  `active` e health 200.
- Web implementada no commit `9febc70`; Preview
  `dpl_JCzSL1yGsikwGgHi696p1Rcedsba` ficou `Ready` no alias estável da branch
  `homologacao`.
- Os testes automatizados cobrem IPv4, IPv6, valores inválidos e repetidos,
  spoofing sem token, cotas independentes e manutenção do 401 do gateway.
- No runtime HML, uma chave atingiu o limite global de 300/min e outra
  permaneceu disponível; no login, uma chave atingiu 10/min e outra permaneceu
  disponível. Uma chamada do Preview foi classificada como `client` por um
  diagnóstico temporário sem IP, depois removido, confirmando o trânsito do
  cabeçalho pelos proxies.
- Pendente: executar o critério 6 com dois navegadores em redes físicas
  distintas. A validação não usou credenciais reais nem alterou senhas.
