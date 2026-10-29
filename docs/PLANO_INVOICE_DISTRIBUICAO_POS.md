# Plano — Distribuição da invoice entre POs e PO como referência

| Item | Valor |
|---|---|
| Data | 2026-10-29 |
| Branch de trabalho | `homologacao` |
| Status | Etapa 1 publicada em HML/Preview (`5615d9b`); etapa 2 em especificação, aguardando decisões |

## 1. Contexto

A invoice é feita na China depois da PO do Protheus e se baseia nela. A PO é a referência; as inconsistências costumam estar na invoice. Hoje o analista confere cada produto da invoice contra as POs, calcula o saldo restante de cada PO e de cada produto (um produto pode vir dividido entre embarques) e, na planilha de follow-up, cria uma linha a mais da PO para a parte embarcada, deixando o restante parado até chegar o embarque que traga esse saldo. Isso é feito à mão e com PROCV, com risco de erro.

No sistema, a parte "linha a mais com o restante" já é automática: cada embarque grava uma alocação no item da PO (`procurement.po_item_allocation`), e o saldo do item é a quantidade pedida menos as alocações ativas. O restante fica disponível para o próximo IP e aparece na Carteira por produto.

## 2. Etapa 1 — A PO é a referência (feito, `5615d9b`)

- A carga da invoice não altera mais o item da PO: a opção "Atualizar este item da PO" saiu da revisão, e a API recusa `catalogUpdates.poItems` com `INVOICE_PO_ITEM_UPDATE_NOT_ALLOWED`. Correção de PO vem do Protheus, pela tela "Atualizar PO pela planilha TOTVS".
- "Completar o cadastro do produto com os dados da invoice" só preenche NCM, fabricante, endereço e país do fabricante que estejam vazios no cadastro; nunca troca a descrição nem sobrescreve dado cadastrado. A opção só aparece quando há algo a preencher.
- Testes: `apps/api/test/operations.test.mjs` (PO recusada, nome recusado, preenchimento só do vazio, nada a preencher não grava), `apps/web/test/invoice-po-authority.test.mjs` e `apps/web/test/invoice-audit-points.test.mjs`.

## 3. Etapa 2 — Distribuir a quantidade da invoice entre POs (proposta)

### Situação atual

- Uma linha da invoice só se divide entre POs quando a própria célula PO traz a divisão (`PO030201=100 pcs, PO030305=50 pcs`).
- Cada parte só pode ir para um item da PO citada na célula: a API exige que a PO escolhida seja a da invoice (`operations.ts`, validação das associações e dos itens travados).
- Se a PO citada não tem saldo para a quantidade inteira, a linha fica bloqueada ("saldo insuficiente") e o analista não tem como mandar o excedente para outra PO.
- Não há visão consolidada do saldo de cada produto somando todas as POs.

### Objetivo

Permitir que o analista, a partir da divergência encontrada, distribua a quantidade de cada linha da invoice entre as POs que têm saldo daquele produto, com o sistema sugerindo a distribuição e mostrando o saldo antes e depois, sem planilha paralela.

### Requisitos propostos

1. **Dividir a linha.** Cada linha da revisão ganha "Dividir entre POs": o analista acrescenta partes, escolhe PO e item e informa a quantidade de cada uma. A soma das partes tem de bater com a quantidade da linha (regra que já existe).
2. **POs candidatas.** Além da PO citada na invoice, a escolha mostra as POs ativas da mesma importadora que têm o produto com saldo, do mesmo fornecedor da PO citada (as regras M061/M062 exigem um fornecedor por IP).
3. **Sugestão automática.** Quando a PO citada não tem saldo para a linha inteira, o sistema propõe: primeiro o saldo da PO citada, depois o restante nas outras POs com saldo, na ordem definida na decisão 2. O analista aceita, ajusta ou desfaz.
4. **Ponto de auditoria.** Parte destinada a uma PO diferente da citada na invoice vira o ponto "PO diferente da invoice", com os dois números lado a lado, e exige confirmação. A API grava a PO citada e a PO escolhida em cada associação (o metadado já tem `sourcePoNumber` e `poNumber`) e recalcula tudo na gravação.
5. **Resumo por produto.** Um quadro acima das linhas mostra, por produto: quantidade da invoice, saldo de cada PO antes, quanto esta invoice tira de cada uma e o saldo depois. É a conta que hoje se faz com PROCV.
6. **Saldo restante.** O restante de cada item continua na PO, disponível para o próximo IP, como já acontece.
7. **Excedente.** Quando a soma dos saldos de todas as POs candidatas for menor que a quantidade da invoice, ver a decisão 3.

### Decisões pendentes

1. Outras POs: qualquer PO ativa da importadora com o produto e o mesmo fornecedor (proposta), ou só as citadas na invoice?
2. Ordem da sugestão: PO mais antiga primeiro, pela data da PO (proposta), ou outra ordem (número da PO, ETA, prioridade)?
3. Excedente: bloquear a gravação até a PO ser corrigida no Protheus ou a invoice ser corrigida (proposta), ou aceitar o excedente como pendência registrada?

### Restrições

- A PO não é alterada pela invoice (etapa 1).
- Um fornecedor por IP (M061/M062); POs de outro fornecedor não entram como candidatas.
- A API recalcula saldos, POs e confirmações na gravação e não confia na tela.
- Textos nos três dicionários.

### Critérios de aceite (rascunho)

| # | Critério | Teste |
|---|---|---|
| 1 | Uma linha pode ser dividida entre a PO citada e outra PO do mesmo fornecedor com saldo | API e web |
| 2 | A sugestão preenche a PO citada até o saldo e o restante nas outras POs, na ordem decidida | web (função de `lib/`) |
| 3 | Parte em PO diferente da citada exige confirmação; sem ela a API responde 400 | API |
| 4 | PO de outro fornecedor ou de outra importadora é recusada | API |
| 5 | O resumo por produto mostra saldo antes, desta invoice e depois por PO | web |
| 6 | Excedente segue a decisão 3 | API e web |
| 7 | Rota nova de candidatos por produto registrada no contrato web/API | `web-route-contract.test.mjs` |

### Fora do escopo

Alterar PO pela invoice, tolerância de preço, correção do número da invoice lido como `INVOICE` (tratados à parte).
