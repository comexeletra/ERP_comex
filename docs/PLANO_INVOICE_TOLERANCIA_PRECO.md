# Tarefa: Diferença de preço em % e tolerância de 20% na carga da invoice

| Item | Valor |
|---|---|
| Data | 2026-11-10 |
| Branch de trabalho | `homologacao` |
| Status | Implementada (web `8b5701b`, API `04acff6`); API HML no release `04acff6`; conferência na tela pendente |

## Objetivo

O ponto de auditoria "Preço" mostra só os dois preços (ex.: `0.364192307692308 CNY` × `0.36420000 CNY`), e o analista não vê de quanto é a diferença. A área usa tolerância de 20% como referência. Decisão do usuário (2026-11-10): o sistema mostra a diferença em % e se ela está dentro ou acima da tolerância, e **toda** diferença continua pedindo o aceite do analista, que decide.

## Requisitos

1. **Diferença no ponto de preço.** O ponto "Preço" ganha a linha "Diferença": a variação do preço da invoice sobre o da PO, com sinal, em % (ex.: `−16,09%`; abaixo de 0,01%, `< 0,01%`), e "dentro da tolerância de 20%" ou "acima da tolerância de 20%".
2. **Aceite sempre.** Toda diferença de preço (acima de 0,00000001 CNY, como hoje) continua exigindo a confirmação do analista, dentro ou acima da tolerância. Sem confirmação, a tela não grava e a API recusa (`INVOICE_PRICE_MISMATCH_UNCONFIRMED`, agora com a % na mensagem).
3. **Limite inclusivo.** Diferença de exatamente 20% está dentro da tolerância; acima disso, fora. O cálculo é decimal exato (sem ponto flutuante), na tela e na API.
4. **PO com preço 0.** Qualquer preço de invoice maior que 0 fica acima da tolerância, sem %.
5. **Só PO em CNY.** PO em outra moeda continua sem conferência de preço (decisão de 2026-11-09).
6. **Auditoria.** A API recalcula a diferença e grava na auditoria da alocação, ao lado de `confirmedPriceMismatch`, `priceDifferencePercent` e `priceWithinTolerance`.
7. **Uma constante.** O limite de 20% fica em `apps/api/src/invoice-price.ts` e no espelho `apps/web/lib/china-invoice-mapping.ts`, com teste que garante o mesmo valor e o mesmo resultado.
8. Textos novos nos três dicionários.

## Restrições

- Sem migration. A PO continua sendo a referência.
- A regra de bloqueio não muda: só passa a mostrar e registrar a %.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | IPH034A linha 149 (0,364192307692308 × 0,3642): `< 0,01%`, dentro; linha 36 (30,08 × 35,85): −16,09%, dentro; ambas ainda pedem aceite | web (`lib/`) e API |
| 2 | Exatamente 20% (0,6 × 0,5): dentro; 20,01%: acima | web e API |
| 3 | PO com preço 0: acima, sem % | web e API |
| 4 | Sem confirmação a API recusa, mesmo dentro da tolerância; com confirmação grava a % e a tolerância na auditoria | API |
| 5 | Constante e resultados iguais na API e na web | API (espelho) |
| 6 | Linha "Diferença" no ponto de preço; textos nos três idiomas; suítes, lint, type-check e builds | web |
| 7 | Ensaio da gravação da IPH034A no HML (ROLLBACK) antes de ativar o release | ensaio no HML |

## Fora do escopo

Dispensar a confirmação dentro da tolerância, tolerância por fornecedor ou produto, aceite em lote, promoção para `main`.

## Plano

1. Testes da web e regra em `lib/` (diferença e tolerância), linha "Diferença" na tela e textos.
2. Testes da API, `invoice-price.ts`, uso na conferência e na auditoria da rota.
3. Verificação completa; release da API no HML com o ensaio da IPH034A; push e Preview.
