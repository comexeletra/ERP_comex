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

## 3. Etapa 2 — Quantidade decidida pelo analista na PO da linha

### Situação atual

- Cada linha da invoice vai para a PO escrita na sua célula PO (ou para as POs da divisão escrita na célula, `PO030201=100 pcs, PO030305=50 pcs`). A API já exige isso.
- A quantidade destinada tem de ser igual à da linha da invoice. Se a PO não tem saldo para tudo, a linha fica bloqueada ("saldo insuficiente") e não há como gravar só o que cabe.
- Quando a PO citada está em outra importadora, a tela só diz "PO não cadastrada", sem apontar onde ela está.
- Não há visão por PO e produto de pedido, já embarcado, desta invoice e saldo depois.

### Objetivo

Permitir que o analista decida quanto de cada linha da invoice baixa do saldo da PO citada nela, com a diferença em relação à invoice auditada, e ver o saldo de cada PO e produto antes e depois, sem planilha paralela. A invoice fica gravada como veio, e a quantidade pedida na PO continua a do Protheus; só o saldo baixa pelo que foi destinado.

### Decisões (2026-10-29)

1. **A chave de destino é PO + código do produto.** A quantidade de uma linha só vai para o item com o mesmo código na PO citada nela. Nunca se usa o saldo de uma PO para outra. A PO recebe a quantidade de uma vez ou em partes, uma por invoice/embarque, até completar o total.
2. O analista digita a quantidade destinada; ela pode ser diferente da linha da invoice.
3. O saldo do item da PO é o limite.
4. Quantidade destinada diferente da invoice exige confirmação e motivo escrito por linha.
5. Fornecedor da PO diferente do Exporter: continua o ponto de auditoria "Fornecedor" com confirmação (o IP fica marcado com divergência, como o banco já permite).
6. PO citada que está em outra importadora: o banco não permite misturar importadoras num IP; a tela avisa em qual importadora a PO está e oferece trocar a importadora do IP ou abrir a PO.
7. Código da invoice que não existe na PO citada: a linha fica pendente até corrigir a PO (Protheus) ou o código na invoice, ou ser destinada com quantidade 0 e motivo. Deixa de existir a escolha de outro item da PO com confirmação de divergência de código.
8. Mesmo código em mais de um item da PO citada: o saldo da chave é a soma dos itens, e a quantidade preenche os itens na ordem das linhas da PO.

### Requisitos

1. **Quantidade destinada.** Cada linha mostra a quantidade da invoice e o campo "quantidade para a PO", preenchido com a da invoice. O analista pode alterá-lo, inclusive para 0 (a linha não baixa saldo neste IP).
2. **Saldo insuficiente.** Quando a quantidade da invoice passa do saldo do item, a linha mostra o saldo e o botão "Usar o saldo da PO (N)", que preenche o campo com o saldo. Não é possível gravar acima do saldo.
3. **Ponto "quantidade diferente da invoice".** Quando a quantidade para a PO difere da linha, a auditoria da linha mostra invoice × PO e exige confirmação e motivo (mínimo de 3 caracteres).
4. **Chave PO + código.** O destino de cada linha é o item com o mesmo código (normalizado como hoje) na PO citada; a escolha manual de item com outro código sai da tela e da API. Se o código aparece em mais de um item, o sistema preenche os itens na ordem das linhas da PO até a quantidade decidida; o limite é a soma dos saldos.
5. **Resumo por PO + código.** Quadro acima das linhas: para cada PO citada e código, quantidade pedida, já embarcada em outros IPs, desta invoice e saldo depois. Linhas com o mesmo produto e PO somam no mesmo saldo.
6. **PO em outra importadora.** Quando a PO citada não existe na importadora do IP mas existe em outra, o aviso diz em qual e oferece trocar a importadora do IP (que revalida as linhas) ou abrir a PO.
7. **Gravação.** A API aceita soma destinada diferente da linha quando confirmada com motivo (inclusive 0); recusa item com código diferente do da linha; continua recusando PO diferente da citada, acima do saldo, outra importadora e fornecedor sem confirmação. O metadado guarda, por linha, quantidade da invoice, quantidade destinada, confirmação e motivo; a auditoria registra a decisão.

### Restrições

- A invoice não altera a PO (etapa 1); a quantidade pedida não muda.
- Nenhuma quantidade vai para PO que não seja a citada na linha.
- Um IP pertence a uma importadora (regra do banco, M061/M062).
- A API não confia na tela e recalcula saldos e confirmações.
- Os totais da invoice continuam conferidos contra o documento.
- Sem migration: as decisões ficam no metadado da invoice e na auditoria.
- Textos nos três dicionários; cálculos em `lib/` com `m` por parâmetro.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Quantidade para a PO menor que a da linha, com confirmação e motivo: 201, alocação com a quantidade decidida e motivo no metadado e na auditoria | API |
| 2 | Quantidade diferente sem confirmação ou sem motivo: 400 | API |
| 3 | Quantidade 0 com confirmação e motivo grava a linha sem alocação | API |
| 4 | Acima do saldo, em PO diferente da citada ou em item com outro código: recusada (os testes atuais de confirmação de divergência de código mudam, porque a regra muda) | API |
| 4b | Código repetido em dois itens da PO: a quantidade preenche os itens na ordem das linhas, até a soma dos saldos | API e web (`lib/`) |
| 4c | Código ausente na PO citada: linha pendente, ou quantidade 0 com motivo | web e API |
| 5 | "Usar o saldo da PO" preenche o saldo; o ponto de diferença aparece até ser confirmado com motivo | web (`lib/`) |
| 6 | Resumo por PO e produto: pedida, já embarcada, desta invoice e saldo depois, somando linhas repetidas | web (`lib/`) |
| 7 | PO citada em outra importadora: aviso com o nome da importadora | API (rota de lote) e web |
| 8 | Textos nos três idiomas; contrato web/API atualizado | i18n, `web-route-contract.test.mjs` |
| 9 | Aceite no HML com a IPH034A: uma linha com quantidade menor que a da invoice, confirmada com motivo, e o saldo restante visível na PO | validação manual no Preview |

### Plano

1. Funções de `lib/` (quantidade destinada, pontos de auditoria, resumo por PO e produto) e testes.
2. Rota de lote: quantidade pedida e já embarcada por item, e importadora onde a PO existe quando não está na escolhida; testes.
3. Gravação: diferença de quantidade com confirmação e motivo; testes.
4. Tela: campo de quantidade, botão de saldo, destino pela chave PO + código, pontos novos, resumo e aviso de importadora; textos.
5. Verificação completa, release da API no HML, push e Preview.
6. Aceite com a IPH034A no HML.

### Fora do escopo

Alterar PO pela invoice, destinar quantidade a PO não citada na linha, tolerância de preço, correção do número da invoice lido como `INVOICE` (tratados à parte).
