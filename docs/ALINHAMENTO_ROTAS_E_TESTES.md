# Alinhamento de rotas e teste do fluxo base

Verificação em 2026-10-05. O contrato de métodos/caminhos usados pelo Next.js é executado em `apps/api/test/web-route-contract.test.mjs` contra o roteador Fastify real. O build do Next.js verifica as páginas. O teste `apps/api/test/gateway-flow.integration.mjs` atravessa Next.js, gateway, API e um PostgreSQL **local descartável**.

> Atualização em 2026-10-10: foi validado o ledger M031 da base operacional e executados testes de relatórios e do fluxo PO/IP em cópias descartáveis. A evidência detalhada dos indicadores, comandos, resultados e limitações está em [VALIDACAO_DASHBOARDS_E_E2E_PO_IP.md](VALIDACAO_DASHBOARDS_E_E2E_PO_IP.md). O ledger M031 confirma o schema observado; por si só, não identifica o commit do código de API ativo na VPS. As observações de compatibilidade abaixo foram registradas em 2026-10-05 e devem ser lidas como o estado conhecido naquela data.

## Caminho de cada ação

| Etapa | Tela Next.js | API | Persistência e releitura |
| --- | --- | --- | --- |
| Identidade | `/login` e `/auth/*` pelo proxy | `POST /auth/local/login`, `GET /auth/me`, `GET /auth/csrf` | Sessão PostgreSQL; todas as escritas exigem token CSRF da mesma origem. |
| SC | `/requests`, `/requests/[id]` | `POST/GET /api/v1/requests`, `GET/PATCH /api/v1/requests/:id` | Solicitação e seus itens em uma transação; número de SC retorna da API. |
| PO | `/purchase-orders/new`, `/purchase-orders/[id]` | `POST /api/v1/purchase-orders/complete`, `PATCH /:id/items/followup`, `GET /:id/operational` e `GET /:id/followup` | Cadastro completo e campos compartilhados em transações. A interface relê os produtos e campos após salvar. As rotas antigas por etapa permanecem disponíveis para a API M021. |
| PO → IP | Formulário da PO | `POST/PATCH/DELETE /api/v1/purchase-orders/:id/allocations` | A distribuição liga **ID do item da PO**, **ID do IP** e quantidade; saldo não pode ficar negativo. Cada IP pode receber itens de várias POs. |
| Pós embarque | `/processes`, `/processes/[id]` | `GET/PATCH /api/v1/processes/:id/followup`, rotas de documentos | Uma operação por IP; ETD, partida efetiva, ETA, chegada e entrega ficam no IP. Invoice/BL/NF pertencem ao IP. |
| Ciclo do IP | `/processes/[id]` | `POST /api/v1/processes/:id/close` e `/reopen` | Decisão do analista. IP encerrado bloqueia edição e novas distribuições; reabertura exige motivo. |

`proxy.ts` encaminha `/auth/*` e `/api/v1/*` com o token de gateway. Versões enviadas pelo navegador em `X-Record-Version` são traduzidas para `If-Match` no encaminhamento. Em desenvolvimento, o mesmo proxy usa `API_DEV_ORIGIN` e `API_DEV_TOKEN`; esses valores devem apontar para a **mesma** API local. As rotas de página e a rota Next `/api/health` não usam esse gateway.

## Regra de negócio conferida

- A solicitação nasce antes da PO. O número da SC é transcrito no item da PO; o sistema **ainda não cria chave estrangeira automática** entre a solicitação e a PO. Conferir o número da SC ao cadastrar a PO.
- A PO pode ser distribuída em vários IPs, inclusive em quantidades parciais. Um IP pode conter itens de várias POs. Identidade do IP vem do vínculo por ID, não de repetir o texto do número na PO.
- Datas logísticas pertencem a cada IP. O teste grava partidas e entregas diferentes para dois IPs da mesma PO e confirma que uma data não é copiada para o outro.
- Se uma API antiga não retornar `lifecycleStatus`, a interface mantém a consulta do IP, marca o ciclo como indisponível e oculta as ações de edição/encerramento. A gravação do ciclo é relida antes do aviso de sucesso.

## Evidências executadas

1. Build da API e do Next.js; testes unitários de ambos.
2. Registro de todos os métodos/caminhos usados pelo Next.js no Fastify (contrato automatizado).
3. Bancos PostgreSQL 17 descartáveis: M001–M024 aplicadas em branco, `operations.integration.mjs` e `followup.integration.mjs` aprovados. O teste de acompanhamento lê **diretamente** do banco aprovação da SC, partidas distintas dos IPs e encerramento/reabertura. A atualização compartilhada foi testada em dois itens; uma falha forçada no segundo item desfez as alterações dos dois e preservou a versão da PO. O cadastro completo gravou cabeçalho, dois produtos e campos; uma falha forçada no segundo produto desfez também o cabeçalho e o recibo de idempotência.
4. Outra base descartável com M001–M021 e PO/IP/datas/quantidade existentes: M022–M024 aplicadas e dados preservados (`PO.version=7`, `IP.version=4`, `SC=2026-08-01`, `ETD=2026-09-01`, `quantidade=40`).
5. Teste HTTP integrado: login local, CSRF, criação da SC, cadastro atômico de PO com dois produtos e aprovação da SC, criação de outra PO e dois produtos, distribuição `40+60` entre dois IPs e `25` de outro produto no mesmo IP, datas independentes, encerramento, bloqueio de edição, reabertura e leitura direta das linhas gravadas no PostgreSQL. Passou usando somente o banco descartável.

A CI da API agora executa o contrato de rotas e o teste de acompanhamento após instalar as migrations. Há também um gate específico que parte de M021 com dados existentes e exige a preservação de PO, item, distribuição, datas e permissões ao chegar em M024.

Para repetir o teste HTTP, suba uma instância PostgreSQL local **descartável** com M001–M024 e ao menos uma PO importadora de teste, inicie a API e o Next.js apontando para ela e execute:

```powershell
$env:GATEWAY_FLOW_DB_URL = 'postgresql://usuario@127.0.0.1:55432/import_erp_ci'
$env:GATEWAY_FLOW_WEB_ORIGIN = 'http://localhost:3000'
node apps/api/test/gateway-flow.integration.mjs
```

O script recusa bancos sem sufixo `_ci`/`_test` ou fora de `localhost`. Cria somente dados de teste na base descartável.

A automação visual no navegador não foi concluída neste ambiente: `npx` ficou aguardando a instalação do Playwright CLI. O teste HTTP acima exercita a aplicação Next.js e a API com sessão/CSRF reais, mas não substitui o aceite dos formulários por um analista.

## Compatibilidade de publicação

A última API **documentada** como instalada na VPS usa M021. O Next.js atual chama campos/rotas de M022–M024 (`events`, ciclo do IP, `GET /processes/:id/followup`, partida efetiva do porto). O teste local confirma que o conjunto atual funciona unido; ele não comprova que essa versão esteja ativa na VPS. Antes do aceite na URL pública, consultar o commit ativo da API e o ledger real, validar M022–M024 em cópia restaurada com backup, publicar API/migrations de modo coordenado e repetir o fluxo com conta autorizada. Não usar os dados da PO `TEST-PO-SPLIT-2026-01` como prova até fazer a releitura autenticada.

O validador preparado para a VPS é `deploy/hostinger/validate-m024-on-copy.py`. Ele exige a base em M021, cria backup verificável, restaura uma cópia isolada, aplica M022–M024 na cópia, confere preservação dos dados e executa os testes de PO/IP. **Ele não publica no banco operacional.**

O release coordenado está em `deploy/hostinger/release-m024.sh`. Ele repete o validador, aplica as migrations aditivas, troca o código da API e restaura a versão anterior do código se a nova API não passar na verificação de saúde. A publicação não foi executada neste levantamento.

O cadastro inicial usa `POST /purchase-orders/complete`, que grava cabeçalho, produtos, campos operacionais, auditoria e recibo de idempotência em uma transação. O formulário relê todos os produtos antes de navegar e guarda o rascunho e a chave de idempotência para repetir a mesma tentativa sem duplicar a PO. Se a rota ainda não existir na API M021, a interface recorre ao cadastro antigo em etapas e informa quando alguma etapa pode ter sido gravada. A aplicação de campos compartilhados usa a rota transacional na API atual; na M021 mantém o salvamento por item com aviso de falha parcial.
