# Tarefa: Conferência de quantidades, pesos e valores da invoice na auditoria

| Item | Valor |
|---|---|
| Data | 2026-11-10 |
| Branch de trabalho | `homologacao` |
| Status | Aprovada e implementada (2026-11-10); conferência na tela pendente |

## Objetivo

Hoje o sistema já confere parte das colunas da invoice (QTY × Price = Total, soma das linhas × linha "Total", líquido ≤ bruto), mas o analista só vê algo quando dá erro, e a aba PKL e o valor pelo preço da PO não são conferidos. Decisão do usuário (2026-11-10): mostrar essas conferências ao analista na hora da auditoria da invoice, sem gravar nada novo no IP; divergência entre INV e PKL pede aceite com motivo.

## Requisitos

1. **Painel "Conferência da invoice"**, sempre visível na auditoria, depois da leitura do arquivo. Uma tabela com as linhas Quantidade, Peso líquido (kg), Peso bruto (kg) e Total (CNY) e as colunas:
   - soma das linhas da INV;
   - total declarado na linha "Total" da INV;
   - total da PKL (só quantidade e pesos);
   - situação: "confere" ou a diferença com sinal.
2. **Conferências por linha**, no mesmo painel, em contagem: "QTY × Price = Total: 62 de 62 linhas" e "Peso líquido ≤ bruto: 62 de 62 linhas". As linhas que falham são citadas pelo número da linha da planilha. As regras são as que já existem no parser (tolerância de 0,011 CNY no total da linha); só passam a ser mostradas.
3. **INV × PKL.** O parser lê a aba `PKL`: cabeçalho com `No.`, `QTY`, `Net Weight (KG)` e `Gross Weight (KG)`, linhas até a linha "Total", e no rodapé `TOTAL PACKED IN … PACKAGES` e `VOLUME: … CBM`.
   - As linhas são pareadas pelo `No.`. Divergem quando a quantidade ou um dos pesos difere da INV, mesmo que por 0,00000001, ou quando um `No.` está só numa das abas.
   - Cada linha divergente vira um ponto de auditoria com os valores da INV e da PKL, a confirmação e o motivo, como na diferença de quantidade (motivo com ao menos 3 caracteres). Sem todos confirmados, a tela não grava.
   - Volumes e CBM aparecem como informação.
   - Sem aba `PKL`, o painel mostra "Invoice sem packing list (aba PKL)", só como informação, sem bloquear.
4. **Valor pelo preço da PO**, informativo, no mesmo painel, com quantidade destinada × preço:
   - "Valor destinado pelo preço da invoice" e "Valor destinado pelo preço da PO", com a diferença em CNY e em %;
   - entram só destinos em PO com moeda CNY e preço informado; os demais são contados ("3 destinos fora da conta: PO em outra moeda ou sem preço");
   - não pede aceite: cada diferença de preço já é aceita no ponto "Preço".
5. **Nada novo no IP.** Sem migration e sem coluna nova. As decisões INV × PKL vão nos metadados da invoice (`packingListDecisions: [{ invoiceRow, packingRow, lineNumber, fields, invoice, packing, reason }]`; `invoiceRow` ou `packingRow` é `null` na linha que só existe numa das abas), que a API já guarda no JSON do documento (`process_document.notes`) junto com as linhas e os pesos.
6. Cálculos em decimal exato (BigInt, como na tolerância de preço), sem ponto flutuante.
7. Textos novos nos três dicionários.

## Restrições

- A API não muda: ela não recebe a PKL, então o aceite INV × PKL é exigido só pela tela. Isso fica registrado aqui e no AGENTS.md.
- As regras de bloqueio que já existem não mudam.
- Módulos de `lib/` sem import de valores entre si; regras de layout e tokens do projeto.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | IPH037A real (o arquivo fica fora do Git, `*.xlsx`; o teste roda onde ele existir): painel com 16.778.006 / 39.576,04… kg / 48.620,86 kg / 6.255.872,98 CNY, tudo "confere", 62 de 62 nas duas conferências, 158 volumes e 157,73 CBM, nenhuma divergência INV × PKL | web (parser com o arquivo real) |
| 2 | PKL com uma linha de peso diferente e um `No.` a mais: dois pontos INV × PKL; sem confirmação e motivo, a gravação fica bloqueada | web (`lib/`) |
| 3 | Invoice sem aba PKL: aviso informativo, sem bloqueio | web |
| 4 | Valor pela PO: soma exata, % com sinal, destinos fora de CNY ou sem preço contados à parte | web (`lib/`) |
| 5 | `packingListDecisions` no payload; a API aceita e grava sem mudança (teste de contrato existente) | web e API |
| 6 | Textos nos três idiomas; suítes, lint, type-check e build | web |

## Fora do escopo

Gravar pesos, volumes ou CBM em colunas do IP; conferir o peso por unidade contra invoices anteriores; exigir o aceite INV × PKL na API; promoção para `main`.

## Plano

1. Testes e leitura da aba PKL no parser (`china-invoice-xlsx.ts`), com a IPH037A real.
2. Testes e regras em `lib/` (pareamento INV × PKL, decisões, valor pela PO).
3. Painel na tela, pontos INV × PKL, bloqueio e payload; textos.
4. Verificação completa, push e Preview.

## Resultado

- Parser: `declaredTotals` (linha TOTAL da INV) e `packingList` (aba PKL: linhas, Total, volumes e CBM); pesos das linhas lidos como o Excel mostra (15 algarismos).
- Regras em `apps/web/lib/china-invoice-mapping.ts`: `invoiceConferenceTotals`, `invoiceLineChecks`, `invoicePackingDivergences`, `invoicePackingDecisionsReady`, `invoicePackingListDecisions` e `invoiceValueByPo`, em decimal exato.
- Tela: `components/InvoiceConference.tsx`, logo após os avisos da invoice; a gravação fica bloqueada enquanto houver divergência INV × PKL sem confirmação e motivo.
- API sem mudança; o teste de contrato confirma que `packingListDecisions` chega ao JSON do documento.
- IPH037A: 62 linhas, totais e PKL conferem, 158 volumes, 157,73 CBM, nenhuma divergência.
