# Pós-embarque do IP nos produtos — análise de cobertura e plano

Situação em 2026-10-22, branch `homologacao` (`1168576`). Consultas somente leitura (`BEGIN READ ONLY` … `ROLLBACK`, apenas contagens) no HML `erp_po_totvs_hml` (M001–M067) e, com autorização do usuário, no banco operacional `erp_po_totvs_test` (M001–M034). Nenhum dado foi gravado ou copiado.

## 1. Regra de negócio

- Um IP reúne produtos de várias POs, na quantidade total ou parcial de cada item. A parcela de um item dentro de um IP é a **distribuição** (`procurement.po_item_allocation`: item × IP × quantidade).
- Os dados de pós-embarque pertencem ao IP. Cada distribuição herda os dados do seu IP. A parcela do mesmo item em outro IP herda os dados desse outro IP. O saldo ainda não distribuído não tem pós-embarque.
- A planilha `Follow Up Import 2026 - Copiar.xlsx` faz essa ligação nos dois sentidos:
  - **Pré Embarque** (uma linha por produto) busca no IP, por `VLOOKUP` do IP Number: ETA, Arrival, Duimp, Duimp Date, Channel, Clearance, NF Request, NF, NF Issue Date e Delivery Date.
  - **Pós Embarque** (uma linha por IP) agrega das linhas de produto, por `UNIQUE(FILTER(...))`: Mode, Incoterm, POL, POD, Broker, BL Number, ETD, ETE e BL Date. Invoice vem por `TEXTJOIN` e Total Amount por `SUMIFS`. Quando duas linhas do mesmo IP divergem, a fórmula devolve mais de um valor. No sistema, o IP é o dono único desses dados, e essa divergência deixa de existir.

## 2. Onde cada dado está hoje

| Dado pedido | Fonte no sistema | Dono |
|---|---|---|
| ETD | `import_process.etd` | IP |
| ETA | `eta_confirmed`; sem ele, ETD + 55 dias (modal SEA) ou + 10 dias (outros modais) — [followup-calculations.ts:66](../apps/api/src/followup-calculations.ts#L66) | IP |
| ETE | `ete_confirmed`; sem ele, ETA + 10 dias — [followup-calculations.ts:67](../apps/api/src/followup-calculations.ts#L67) | IP |
| Departure | `actual_port_departure_date` (M024) | IP |
| BL date | menor `issue_date` dos BLs ativos do IP (gerais ou do item) — [followup-calculations.ts:62](../apps/api/src/followup-calculations.ts#L62) | documento BL do IP |
| Arrived | `arrival_date` | IP |
| Saída da fábrica | `po_item_allocation.factory_ship_date` (M025) | distribuição |

**Modelo atual: herança por referência.** Nenhuma data é copiada para o item. `GET /purchase-orders/:id/followup` junta cada distribuição ativa ao seu IP e calcula os indicadores por parcela (`shipments`, [followup.ts:543](../apps/api/src/followup.ts#L543)). `GET /processes/:id/followup` faz o mesmo pelo lado do IP ([followup.ts:418](../apps/api/src/followup.ts#L418)). Uma alteração no IP aparece imediatamente em todas as POs e produtos dele, sem rotina de sincronização. Cancelar ou reduzir uma distribuição devolve a quantidade ao saldo, que fica sem pós-embarque.

### Demais dados do IP e como chegam ao produto

| Grupo | Campos | Na linha do produto |
|---|---|---|
| Identificação | nº do IP, data do IP no TOTVS, status logístico, prioridade do IP, fornecedor do IP | exibir |
| Embarque | modal, Incoterm, despachante, POL, POD, ETD, Departure, BL nº/data, agente de carga, container/tipo | exibir |
| Chegada e aduana | ETA, Arrival, DUIMP/data, canal, desembaraço, ETE, vencimento da armazenagem, documentação conferida | exibir |
| Fechamento | solicitação da NF, NF nº/emissão/homologação, entrega | exibir |
| Invoice | nº; quantidade e preço quando a linha da invoice aponta para o item | exibir por item |
| Custos | frete, impostos, multa, armazenagem, demurrage, qtd. de containers | **não propagar**; mostrar só no IP (somar por produto duplica o valor) |
| Calculados | status, alerta, risco de ruptura, trânsito, lead time, etapas T2–T5, desvios, gargalo, mês de chegada | calcular por parcela (datas do IP + necessidade e metas do item) |

## 3. Cobertura por tela e rota

| Ponto de consulta | Mostra os dados do IP por produto? | Observação |
|---|---|---|
| PO › Acompanhamento, linhas por IP ([FollowupPanel.tsx](../apps/web/components/FollowupPanel.tsx)) | Parcial | Na tabela: status, ETA e entrega. No detalhe: campos do IP, exceto Departure. BL date só em "Indicadores calculados" |
| PO › Preenchimento operacional, distribuições ([OperationalPoPanel.tsx](../apps/web/components/OperationalPoPanel.tsx)) | Não | Mostra IP, quantidade e saída da fábrica |
| IP › Pós-Embarque, tabela de itens ([ProcessPostShipmentPanel.tsx](../apps/web/components/ProcessPostShipmentPanel.tsx)) | Parcial | Mostra quantidade, saída da fábrica, status e alerta. Não mostra a ETA/ETE calculadas |
| Carteira de POs: lista e resumo ([purchase-orders.ts:146](../apps/api/src/purchase-orders.ts#L146)) | Não | Contagens por PO |
| Exportação da carteira ([purchase-order-exports.ts](../apps/api/src/purchase-order-exports.ts)) | Não | Contagens por PO |
| Relatórios Pré/Pós ([source-audit.ts:106](../apps/api/src/source-audit.ts#L106)) | Não | Contagens de POs e de IPs |
| Histórico da PO | Sim | Os eventos dos IPs vinculados aparecem na PO |

## 4. Lacunas

- **L1 — Não há visão por produto.** A herança só aparece dentro de cada PO. Não existe uma lista de todas as linhas (produto × IP, mais o saldo) com as datas do IP, filtros e exportação. Essa lista substitui a aba Pré Embarque e é a principal lacuna.
- **L2 — O status manual congela o status do produto.** O cálculo usa `logistics_status` sempre que ele está preenchido ([followup-calculations.ts:115](../apps/api/src/followup-calculations.ts#L115)), e a carga de invoice grava `WAITING SHIPMENT` ([operations.ts:1311](../apps/api/src/operations.ts#L1311), [:1331](../apps/api/src/operations.ts#L1331)). Depois disso, lançar BL, chegada ou entrega muda o alerta, mas não o status da linha. Na planilha, o status é sempre derivado das datas. No histórico de produção, os status estão coerentes com as datas; o problema afeta os IPs novos.
- **L3 — Departure não aparece na PO.** A lista de campos de [FollowupPanel.tsx:14](../apps/web/components/FollowupPanel.tsx#L14) omite `actualPortDepartureDate`, presente em [ProcessPostShipmentPanel.tsx:33](../apps/web/components/ProcessPostShipmentPanel.tsx#L33). O valor não é apagado, porque o PATCH grava só as chaves enviadas. A causa é que as duas listas de campos são cópias independentes.
- **L4 — BL, Invoice e NF não são colunas da linha.** A BL date fica nos indicadores, e os números só na lista de documentos do IP. O cálculo devolve `billDate` e `nfIssueDate`, mas não os números. A regra para mais de um BL aplicável não está definida.
- **L5 — Não há consolidação por item nem por PO.** Exemplo: um item de 100 unidades com 60 entregues e 40 em trânsito. Faltam a quantidade por fase, a próxima ETA e um status agregado.
- **L6 — A distribuição pode mudar depois do embarque.** PATCH e DELETE em `/allocations` exigem apenas IP aberto e ativo ([operations.ts:2353](../apps/api/src/operations.ts#L2353), [:2391](../apps/api/src/operations.ts#L2391)). Com BL ou Departure lançados, a quantidade embarcada pode ser alterada, e a tela envia uma justificativa automática. A revisão de invoice também recria distribuições.
- **L7 — Não há validação de sequência das datas.** `validateFields` confere só o tipo ([followup.ts:57](../apps/api/src/followup.ts#L57)).
- **L8 — O IP não mostra a ETA/ETE calculadas.** Elas aparecem apenas nas linhas da PO.
- **L9 — Eventos.** Alterar o IP gera somente `comex.import_process.followup_update`. Isso basta enquanto não houver consumidor externo por item.

## 5. Dados reais (2026-10-22)

| Medida | Produção (M034) | HML (M067) |
|---|---:|---:|
| IPs | 204 abertos (200 da planilha) | 3, todos `DELETED` |
| POs | 342 | 12 (11 `DELETED`) |
| Itens / cancelados na origem | 6.800 / 642 | 446 / — |
| Distribuições ativas (itens, IPs) | 5.155 (5.154, 199) | 0 |
| Itens em mais de um IP / com saldo restante | 1 / 1 | 0 / 0 |
| IPs com mais de uma PO | 91 | 0 |
| Vínculos PO–IP sem distribuição | 0 | 0 |
| Itens com IP na origem e sem distribuição | 0 | — |
| Datas antigas gravadas no item (`actual_*` em `purchase_order_item`) | 0 | 0 |
| IPs com ETD / ETA / ETE / modal | 199 cada | 0 |
| IPs com Departure / Arrival / entrega | 0 / 165 / 170 | 0 |
| BL / Invoice / NF ativos (ligados a item) | 190 / 190 / 159 (todos gerais, nenhum ligado a item) | 0 |
| Invoices com data de emissão | 0 de 190 | — |
| IPs com mais de um BL | 0 | 0 |
| Chegada antes do ETD / desembaraço antes da chegada / ETE antes da ETA | 8 / 17 / 2 | — |
| Chegada antes da Departure / entrega antes da chegada / ETA antes do ETD | 0 / 0 / 0 | — |
| Distribuições ativas em IP com BL ou Departure | 4.893 | 0 |
| Conflitos da planilha abertos (`IP_SOURCE_CONFLICT` / `PO_SOURCE_CONFLICT`) | 242 / 10 | — |

"—" indica medida não feita ou que não se aplica a esse banco.

O que esses números mostram:

- Não há data antiga no item para reconciliar, e todo item com IP na origem já tem distribuição. O histórico já herda por referência.
- O HML não tem nenhuma distribuição ativa, então a validação depende de dados sintéticos (ou de cópia autorizada de entidades específicas).
- Departure é um dado novo: a planilha não tinha essa coluna no Pós Embarque.
- Uma validação rígida de sequência bloquearia IPs históricos. Ver D6.
- Produção está 33 migrations atrás do HML. Este trabalho depende da promoção de M035–M067.

## 6. Decisões pendentes

Cada decisão traz a opção recomendada primeiro.

- **D1 — Herança por referência (recomendado).** O IP continua sendo o dono único dos dados, e as datas não são copiadas para o item nem para a distribuição. Toda leitura por produto passa pela distribuição. A alternativa (copiar as datas para cada item) exige rotina de sincronização e cria divergência.
- **D2 — Um IP corresponde a um embarque (recomendado).** Toda a quantidade de um IP compartilha as mesmas datas. Se parte da carga sair ou chegar em outra data, essa parte é redistribuída para outro IP. A alternativa é permitir data própria por distribuição, com mais campos e regras.
- **D3 — BL date vem do documento BL (recomendado).** Um BL ligado ao item prevalece sobre o BL geral do IP. Com mais de um BL aplicável, usa-se a menor data e a linha recebe um aviso. A NF segue o mesmo critério. A alternativa é criar um campo próprio no IP (migration).
- **D4 — Status do produto derivado das datas (recomendado).** O status manual passa a valer só para `CANCELLED`, e o status informado aparece ao lado do calculado. A carga de invoice deixa de gravar `WAITING SHIPMENT`, ou esse valor deixa de prevalecer sobre o calculado.
- **D5 — Distribuição em IP embarcado.** Com BL date ou Departure lançados, alterar, cancelar ou criar distribuição (inclusive pela revisão de invoice) exige confirmação explícita e justificativa digitada pelo usuário (recomendado). A alternativa é bloquear. Hoje isso afetaria 4.893 distribuições.
- **D6 — Sequência das datas.** Bloquear somente o que é fisicamente impossível entre datas efetivas, e apenas quando a edição altera uma das datas envolvidas: chegada antes da Departure, entrega antes da chegada e ETA antes do ETD. Os demais casos (chegada antes do ETD, desembaraço antes da chegada, ETE antes da ETA) geram apenas aviso, porque existem no histórico.
- **D7 — Custos ficam no IP (recomendado).** Frete, impostos e demurrage não aparecem por produto. Um eventual rateio é tarefa separada.
- **D8 — ETA/ETE calculadas (recomendado).** Manter a regra atual e mostrar "confirmada" e "calculada" lado a lado. A planilha também projeta a ETE sem ETD (hoje + 10 + trânsito + 10); essa projeção só deve ser replicada se a operação confirmar.
- **D9 — Saldo sem IP na carteira por produto (recomendado).** Mostrar uma linha "A distribuir" com a quantidade restante e sem datas.

## 7. Spec

```markdown
# Tarefa: pós-embarque do IP visível e coerente em cada produto
## Objetivo
Cada parcela de produto dentro de um IP mostra os dados de pós-embarque desse IP
(ETD, Departure, BL date, ETA, Arrival, ETE, entrega e demais campos), em todas as
telas e exportações, sem cópia de dados e com regras que mantêm datas e quantidades coerentes.
## Requisitos
- Uma única montagem da linha produto × IP na API, usada por PO, IP, carteira por produto e exportação.
- Linha: dados do item + quantidade no IP + todos os campos do IP + BL/Invoice/NF + calculados; saldo sem IP como "A distribuir".
- Status calculado a partir das datas (D4); BL/NF pela regra D3.
- Catálogo único de campos do IP no web, igual ao aceito pela API (corrige Departure na PO).
- ETA/ETE calculadas visíveis no IP.
- Validação de sequência (D6) e confirmação para mudar distribuição de IP embarcado (D5).
- Carteira por produto com filtros, consolidação por item e exportação XLSX.
## Restrições
- IP continua dono único; nenhuma gravação em purchase_order_item ao editar o IP.
- Manter campos atuais das respostas; campos novos opcionais (web publicada pode falar com API antiga).
- Escopo por importadora, auditoria e versionamento iguais aos atuais.
- Sem migration, salvo índice comprovadamente necessário (somente no HML até aprovação).
## Critérios de aceite
- Item dividido em dois IPs mostra datas independentes; itens de POs diferentes no mesmo IP mostram as mesmas datas.
- Alterar uma data do IP reflete em todas as linhas sem atualizar purchase_order_item.
- Status da linha avança com BL/chegada/entrega em IP criado por invoice.
- Datas impossíveis retornam IP_DATE_SEQUENCE_INVALID; casos históricos só geram aviso.
- Mudança de distribuição em IP embarcado sem confirmação retorna 409.
- Teste garante que o catálogo de campos do web é igual ao processFields da API.
- Carteira por produto e exportação respeitam filtros, escopo e paginação; custos não aparecem por produto.
## Fora do escopo
- Rateio de custos por produto; integração TOTVS; datas próprias por distribuição (se D2 confirmado);
  eventos outbox por produto; mudança no layout da planilha.
## Plano
Fases 0–7 abaixo.
```

## 8. Plano de implementação

Cada fase segue o mesmo ciclo: testes primeiro; `pnpm test` e `pnpm build` em `apps/api`; `pnpm test`, `pnpm lint` e `pnpm build` em `apps/web`; commit na `homologacao`.

**Fase 0 — Decisões e linha de base**
1. Confirmar D1–D9.
2. Linha de base registrada em 2026-10-22 (`1168576`): API com build ok e 210 testes aprovados, 0 falhas; web com 94 testes aprovados, lint com 0 erros (40 avisos preexistentes) e build ok.
3. Definir os dados de validação no HML: cenário sintético com prefixo `HMLVAL-` e limpeza ao final, ou cópia de IPs/POs escolhidos da produção, somente se solicitada explicitamente.

**Fase 1 — Linha produto × IP única na API** (sem migration)
1. Criar `apps/api/src/shipment-lines.ts`. Ele monta uma linha por distribuição ativa e uma por saldo restante, juntando PO, item, distribuição, IP e documentos, e aplica D3 (BL/NF/Invoice por linha) e D4 (status).
2. `calculateFollowup` passa a devolver também `billNumber`, `invoiceNumbers`, `nfNumber`, `statusSource` (calculado/informado) e avisos de regra (vários BLs, sequência).
3. `GET /purchase-orders/:id/followup` e `GET /processes/:id/followup` passam a usar esse módulo, mantendo os campos atuais da resposta.
4. Testes em `followup-calculations.test.mjs`: BL do item × BL geral, vários BLs, sem BL, status derivado com `WAITING SHIPMENT`, ETA/ETE confirmada × calculada. Criar `shipment-lines.test.mjs` no padrão de `operations.test.mjs`.

**Fase 2 — Telas atuais**
1. Criar `apps/web/lib/ip-post-shipment-fields.ts` com o catálogo único, usado por FollowupPanel e ProcessPostShipmentPanel (corrige L3).
2. PO › linhas por IP: colunas ETD, Departure, BL date, ETA, Arrival, ETE, entrega e status. No detalhe, os números de Invoice, BL e NF.
3. IP › Pós-Embarque: ETA/ETE calculadas ao lado das confirmadas (L8). Na tabela de itens, BL e Invoice por item quando houver documento ligado ao item.
4. Testes: contrato API × web para que as chaves de `processFields` coincidam com o catálogo (`web-route-contract.test.mjs`), e testes de rótulos no padrão de `invoice-review-layout.test.mjs`.

**Fase 3 — Regras de integridade** (D5, D6)
1. `PATCH /processes/:id/followup` valida a sequência sobre o estado resultante (valores atuais + enviados), só para as datas alteradas. O erro é `IP_DATE_SEQUENCE_INVALID` (400) com a lista de campos; os avisos voltam na resposta.
2. POST, PATCH e DELETE em `/allocations`, e a revisão de invoice, em IP com BL date ou Departure: respondem `IP_ALREADY_SHIPPED_UNCONFIRMED` (409) sem `confirmShippedChange: true` e justificativa digitada. A confirmação fica registrada na auditoria.
3. Telas: mensagens e diálogo de confirmação com justificativa obrigatória.
4. Testes em `operations.test.mjs` e um teste novo para a sequência de datas.

**Fase 4 — Carteira por produto**
1. Criar `GET /api/v1/purchase-order-lines`, com filtros de importadora, PO, IP, produto, status, período de ETA/chegada e "somente com saldo", além de paginação, escopo por importadora e permissão `purchase-orders.read`. Filtrar por status calculado exige que a regra exista também em SQL, com teste de paridade contra `calculateFollowup`.
2. Criar a tela `/purchase-orders/lines` ("Carteira por produto"), com link no AppSidebar, colunas agrupadas Pré | Pós, links para PO e IP, e consolidação por item (L5): a distribuir, quantidade por fase e próxima ETA.
3. O índice único `uq_active_po_item_process (item, IP) WHERE ACTIVE` já cobre a busca por item. Só criar índice novo se o `EXPLAIN` no volume real mostrar necessidade.
4. Testes da rota (filtros, escopo, paginação, saldo) e do contrato web × API.

**Fase 5 — Exportação por produto**
1. Criar o job `purchase-order-lines-xlsx` em `export-jobs.ts` e `worker.ts`, com os mesmos filtros e as colunas na ordem da aba Pré Embarque (B:AZ), para facilitar a comparação com a planilha.
2. Testes em `purchase-order-export.test.mjs`.

**Fase 6 — Pendências do histórico**
1. O módulo de Qualidade ([data-issues.ts](../apps/api/src/data-issues.ts)) já lista e revisa pendências por código. No IP e na linha do produto, mostrar um aviso quando houver `IP_SOURCE_CONFLICT` aberto (242 em produção), com link para a revisão nesse módulo. Nada é corrigido automaticamente.
2. Usar os avisos de sequência (D6) para sinalizar os 8 IPs com chegada antes do ETD, os 17 com desembaraço antes da chegada e os 2 com ETE antes da ETA, para revisão pela operação.

**Fase 7 — Homologação**
1. `git push production homologacao`; acompanhar o Preview até `Ready` no domínio estável.
2. Publicar a API na VPS HML (o Preview não atualiza a VPS) e conferir as rotas novas e alteradas.
3. Criar o teste opt-in `test/post-shipment-propagation-hml.integration.mjs` com este roteiro:
   - PO-A com item de 100: 60 no IP-1 e 40 no IP-2. PO-B com item de 50, todo no IP-1.
   - As datas do IP-1 aparecem nas linhas da PO-A (60) e da PO-B (50), e não na linha do IP-2.
   - Alterar a ETA do IP-1 reflete nas duas POs.
   - Reduzir de 40 para 30 devolve 10 ao saldo, sem datas.
   - Mudar a distribuição depois de lançar a Departure exige confirmação.
   - Limpar os dados ao final.
4. Validar no Preview a carteira por produto e a exportação.

## 9. Riscos

- **D4 muda o status exibido nos IPs criados por invoice.** O status fixo `WAITING SHIPMENT` passa a ser substituído pelo calculado; é preciso comunicar a operação.
- **Divergência entre TS e SQL.** As regras de status em TS e os filtros em SQL podem divergir; o teste de paridade é obrigatório na Fase 4.
- **Validação só com dados sintéticos.** O HML não tem distribuições, então o volume real (cerca de 6,8 mil itens) só será exercitado com dados autorizados ou em cópia restaurada.
- **Promoção para produção.** A produção está em M034; liberar este trabalho em produção exige promover antes M035–M067.
- **Compatibilidade de versões.** O web publicado pode conversar com uma API antiga na VPS. Por isso, os campos novos são opcionais, e a ausência deles é tratada pelo padrão `compatibilityWarning` já usado nas telas.
