# Plano — Distribuição da invoice entre POs e PO como referência

| Item | Valor |
|---|---|
| Data | 2026-10-29 |
| Branch de trabalho | `homologacao` |
| Status | Etapa 1 publicada em HML/Preview (`5615d9b`); etapa 2 especificada, aguardando aprovação |

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

Permitir que o analista, a partir da divergência encontrada, decida quanto de cada linha da invoice vai para cada PO com saldo daquele produto, com o sistema sugerindo a distribuição e mostrando o saldo antes e depois, sem planilha paralela. A invoice fica gravada como veio e a quantidade pedida da PO continua a do Protheus; só o saldo da PO baixa pelo que foi distribuído.

### Decisões (2026-10-29)

1. Candidatas: só as POs citadas na invoice (em qualquer linha), ativas, da mesma importadora e do mesmo fornecedor, que tenham o produto com saldo. POs que não estão na invoice não recebem quantidade dela (correção do usuário em 2026-10-29).
2. Sugestão: primeiro a PO citada na linha até o saldo; o restante nas outras POs citadas na invoice, da mais antiga para a mais nova (data da PO; sem data, data de cadastro).
3. O analista decide a quantidade de cada PO; a soma pode ser diferente da quantidade da linha da invoice.
4. O saldo do item da PO é o limite de cada parte: não se distribui mais que o saldo.
5. Quando a soma distribuída difere da invoice, gravar exige confirmação e um motivo escrito por linha.

### Requisitos

1. **Partes da linha.** Cada linha da revisão tem uma ou mais partes (PO, item e quantidade). "Dividir entre POs" acrescenta uma parte; cada parte pode ser removida. As partes que vêm da célula PO da invoice continuam sendo o ponto de partida.
2. **POs candidatas.** A escolha de item de cada parte mostra os itens do mesmo produto em todas as POs citadas na invoice (decisão 1), com saldo e data da PO. A rota de lote atual já carrega essas POs; ela passa a devolver também a data da PO. Não há rota nova.
3. **Sugerir distribuição.** Botão por linha (e um para todas as linhas com falta de saldo) que monta as partes pela decisão 2. O analista aceita, ajusta ou desfaz.
4. **Ponto "PO diferente da linha".** Parte numa PO citada em outra linha da invoice, e não na desta, aparece na auditoria da linha, com os dois números, e exige confirmação.
5. **Ponto "quantidade distribuída diferente da invoice".** Quando a soma das partes difere da linha (para mais ou para menos, inclusive linha sem nenhuma parte), a linha mostra invoice × distribuído e exige confirmação e motivo (mínimo de 3 caracteres).
6. **Limite de saldo.** Nenhuma parte passa do saldo do item; a soma das partes no mesmo item, em todas as linhas, também não.
7. **Resumo por produto.** Quadro acima das linhas: por produto, quantidade da invoice, total distribuído e, por PO, saldo antes, quanto esta invoice tira e saldo depois.
8. **Gravação.** A API aceita associação em outra PO citada na invoice quando confirmada, e recusa PO que não esteja em nenhuma célula PO da invoice; e soma diferente da linha quando confirmada com motivo; recalcula fornecedor, importadora, saldos e confirmações. O metadado guarda, por linha, quantidade da invoice, quantidade distribuída, confirmação e motivo; cada associação guarda a PO citada e a escolhida. Auditoria e outbox como hoje.

### Restrições

- A invoice não altera a PO (etapa 1); a quantidade pedida não muda.
- Um fornecedor por IP (M061/M062); POs de outro fornecedor não são candidatas.
- A API não confia na tela: recusa PO que não esteja citada na invoice, de outra importadora ou fornecedor, parte acima do saldo, PO diferente sem confirmação e diferença de quantidade sem confirmação e motivo.
- Os totais da invoice (cabeçalho e linhas) continuam conferidos contra o documento, sem mudança.
- Sem migration: as decisões ficam no metadado da invoice e na auditoria.
- Textos nos três dicionários; regras de cálculo em `lib/` com `m` por parâmetro.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | As candidatas de uma linha são os itens do produto nas POs citadas na invoice, do mesmo fornecedor, com saldo; a rota de lote devolve a data da PO | API e web (`lib/`) |
| 2 | A sugestão preenche a PO citada até o saldo e o restante nas outras POs pela data | web (`lib/`) |
| 3 | Parte em outra PO citada na invoice sem confirmação: 400; com confirmação: 201 e metadado com as duas POs | API |
| 4 | PO não citada na invoice, de outro fornecedor ou importadora, ou parte acima do saldo: recusada | API |
| 5 | Soma diferente da linha sem confirmação ou sem motivo: 400; com ambos: 201 e motivo no metadado e na auditoria | API |
| 6 | Linha sem parte só grava com confirmação e motivo | API e web |
| 7 | O resumo por produto mostra saldo antes, desta invoice e depois por PO | web (`lib/`) |
| 8 | Contrato web/API da rota de lote com a data da PO; textos nos três idiomas | `web-route-contract.test.mjs`, i18n |
| 9 | Aceite no HML com a IPH034A: uma linha dividida entre duas POs e uma linha com quantidade diferente, confirmadas | validação manual no Preview |

### Plano

1. Funções de `lib/` (sugestão, resumo por produto, pontos de auditoria novos) e testes.
2. Data da PO na rota de lote e testes.
3. Gravação: validações novas e metadado, com testes.
4. Tela: partes, sugestão, pontos novos e resumo; textos.
5. Verificação completa, release da API no HML, push e Preview.
6. Dados de aceite no HML: como a IPH034A cita só a PO 030201, a divisão entre POs é exercitada com uma cópia da invoice de teste que cite também uma segunda PO de teste do EX000135 na GALPAO-FORTALEZA; a diferença de quantidade é exercitada na própria IPH034A.

### Fora do escopo

Alterar PO pela invoice, tolerância de preço, correção do número da invoice lido como `INVOICE` (tratados à parte).
