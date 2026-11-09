# Tarefa: Correções da auditoria da gravação de IP pela invoice

| Item | Valor |
|---|---|
| Data | 2026-11-09 |
| Branch de trabalho | `homologacao` |
| Status | Aprovada e implementada (web `537a143`, API `b62d03e`); API HML no release `b62d03e`; aceite da IPH034A no Preview pendente |

## Contexto (auditoria de 2026-11-09)

A auditoria rodou o parser da tela sobre os arquivos reais (`IPH034A 2026 INV+PL.xlsx` e as duas `IPH034B`) e reproduziu a rota `POST /api/v1/processes/import-invoice` compilada (`dist`) com banco falso, sem tocar no HML.

| # | Achado | Evidência |
|---|---|---|
| 1 | Valores calculados no Excel saem do parser com resíduo binário (`4485.599999999999`, preço `0.0033607169529499626`) e a API recusa a gravação com `INVALID_INVOICE_LINES`, mensagem "Invoice lines are required." | IPH034A: 13 valores; IPH034B: 3 valores e 2 preços. Linha 21 da IPH034A reproduzida: 400; com o valor arredondado, passa da validação |
| 2 | O número da invoice é lido como `INVOICE`: o título da linha 3 (células mescladas) normalizado é igual ao rótulo `INVOICE:`. O número real está em `K5` (`PWBR260205-10A`, `PWBR260205-10B`) | Os três arquivos reais. Toda invoice nova do mesmo Exporter aparece como duplicata da anterior |
| 3 | A API confere só o total da linha, não cada parte da célula PO dividida | Célula `PO030201=3 pcs, PO030305=2 pcs`, pedido 5 + 0 sem confirmação: 201, sem decisão na auditoria |
| 4 | `1,000` na célula PO é lido como 1 | `PO030201=1,000 pcs, PO030305=999 pcs` numa linha de 1000 vira 1 + 999 sem aviso |
| 5 | Mensagens da rota em inglês | "Invoice lines are required.", "IP REF must match the invoice header." etc. |

### Decisões do usuário (2026-11-09)

- PO em moeda diferente de CNY continua sem conferência de preço; o ponto de moeda segue só informativo.
- A quantidade destinada à PO pode ser maior que a da invoice, com confirmação e motivo, limitada ao saldo da PO, porque a invoice nem sempre vem correta.

## Objetivo

Permitir gravar as invoices reais (IPH034A/B) pela tela, com o número correto da invoice, e fazer a API conferir cada parte da célula PO como a tela já confere, sem aceitar divisões erradas por leitura de milhar.

## Requisitos

1. **Números do Excel.** O parser arredonda todo número lido de célula a 15 algarismos significativos (a precisão que o Excel mostra) e o escreve sem notação exponencial. Quantidade e valor ficam com no máximo 8 casas; preço com no máximo 18. Quantidade que continue com mais de 8 casas depois disso vira problema da linha na tela, sem arredondamento silencioso.
2. **Número da invoice.** O rótulo de cabeçalho com dois-pontos (`INVOICE:`, `DATE:`, `IP REF.:` …) só corresponde a uma célula que traga os dois-pontos; o título `INVOICE` da linha 3 deixa de ser lido como rótulo. Na IPH034A o número passa a ser `PWBR260205-10A`.
3. **Milhar.** Um número no formato `1,000`, `12,500` ou `1,000,000` (grupos de 3 dígitos separados por vírgula, com ou sem `.decimais`) é milhar, na célula PO e nas células de texto da linha. Os demais formatos seguem a regra atual. A soma das partes continua conferida com a quantidade da linha.
4. **Parte da célula na API.** A API lê a célula PO de cada linha com a mesma regra da tela (inclusive milhar). Quando a célula cita quantidades por PO, a soma destinada a cada PO da linha tem de ser igual à citada; a diferença só passa com a confirmação e o motivo da linha (`lineDecisions`), como já acontece com o total. Linha cuja parte difere entra na auditoria da invoice como decisão de quantidade, mesmo que o total da linha seja igual.
5. **Mensagens.** As mensagens da rota `import-invoice` passam para português. `INVALID_INVOICE_LINES` diz a linha da invoice e o campo inválido.

## Restrições

- Sem migration e sem mudança no banco.
- A regra de leitura da célula PO fica duplicada na API e na web (módulos de `lib/` não se importam); um teste garante que as duas leem os mesmos exemplos igual, como em `unit-equivalence`.
- Códigos de erro não mudam; só os textos.
- Mantidas as decisões acima (moeda e quantidade maior que a invoice).
- Textos de tela novos nos três dicionários.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Os valores e preços de todas as linhas da IPH034A e das IPH034B lidos pelo parser passam nos formatos da API | web: teste com os valores reais das linhas 21, 23 (IPH034A) e 20, 48, 78 (IPH034B) num fixture anonimizado |
| 2 | Número da invoice da IPH034A = `PWBR260205-10A`; o fixture atual continua lendo `INV-ANON-001` | web: fixture com título `INVOICE` mesclado na linha 3 |
| 3 | `PO1=1,000 pcs, PO2=999 pcs` numa linha de 1999 dá 1000 + 999; numa linha de 1000 dá erro de soma | web e API |
| 4 | Célula 3 + 2 com pedido 5 + 0 sem confirmação: 400 `INVOICE_QUANTITY_MISMATCH_UNCONFIRMED`; com confirmação e motivo: 201 e decisão na auditoria | API |
| 5 | Linha com valor de mais de 8 casas: 400 `INVALID_INVOICE_LINES` com a linha e o campo na mensagem, em português | API |
| 6 | Mesmos exemplos de célula PO lidos igual na API e na web | API (teste de espelho) |
| 7 | Suítes completas, lint, type-check e builds passando | — |
| 8 | Aceite no HML: IPH034A gravada pela tela no Preview com o número `PWBR260205-10A` | validação manual (precisa de sessão de usuário) |

## Fora do escopo

- Conferir NCM e fabricante de `catalogUpdates` contra as linhas da invoice.
- Trocar as somas de alocação em ponto flutuante por decimal exato (sem efeito nos volumes atuais).
- Corrigir no HML documentos já gravados com número `INVOICE` (se houver, tratar à parte depois de conferir no banco).
- Promoção para `main`.

## Plano

1. Testes da web (critérios 1 a 3) e correção do parser: números, rótulo com dois-pontos e milhar.
2. Testes da API (critérios 3 a 6) e correção da rota: leitura da célula PO por parte, decisões na auditoria e mensagens em português.
3. Verificação completa (`apps/api`: build e test; `apps/web`: test, `tsc --noEmit`, lint e build) e revisão do diff.
4. Release da API no HML (seção de release de `deploy/hostinger/README.md`), conferência da versão e da rota com o `dist` do release, push da `homologacao` e Preview `Ready`.
5. Aceite da IPH034A no Preview, com a PO de teste 030201 já semeada no HML; antes, conferir no banco `erp_po_totvs_hml` se ela continua lá e com saldo.

## Resultado (2026-11-09)

- Web `537a143`: com o parser novo, IPH034A e as duas IPH034B saem sem nenhum valor, preço ou quantidade fora do formato da API, com os mesmos totais e o número da invoice (`PWBR260205-10A`, `PWBR260205-10B`). A célula PO só aceita `pcs`/`units` como unidade (regra anterior, mantida).
- API `b62d03e`: célula dividida conferida por PO; mensagens da rota em português; `INVALID_INVOICE_LINES` diz a linha e o campo.
- Verificação local: API 68 arquivos de teste, web 383 testes, type-check, lint (0 erros; os 42 avisos não vêm dos arquivos alterados) e builds.
- HML: release `b62d03e` (registro em `deploy/hostinger/README.md`). A PO de teste 030201 da importadora GALPAO-FORTALEZA não existe mais: o aceite da IPH034A precisa recriá-la com `deploy/hostinger/seed-hml-iph034a-acceptance.mjs apply`, ou usar outra PO com saldo.
