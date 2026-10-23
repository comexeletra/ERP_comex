# Plano de implementação — Varredura e padronização de layout e web design

| Item | Valor |
|---|---|
| Data | 2026-10-23 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | Preview Vercel (`erp-comex-git-homologacao-eletra-comex.vercel.app`) |
| Escopo técnico | `apps/web` (somente front-end; nenhuma rota da API, migration ou dado muda) |
| Status | **Implementado na `homologacao`; aguardando validação visual no Preview** (ver [seção 10](#10-execução-e-validação)) |

## Sumário

1. [Resumo](#1-resumo)
2. [Como a varredura foi feita](#2-como-a-varredura-foi-feita)
3. [Mapeamento das inconsistências](#3-mapeamento-das-inconsistências)
4. [Matriz por tela](#4-matriz-por-tela)
5. [Especificação da tarefa](#5-especificação-da-tarefa)
6. [Ciclos de correção](#6-ciclos-de-correção)
7. [Testes e verificação](#7-testes-e-verificação)
8. [Decisões](#8-decisões)
9. [Riscos e cuidados](#9-riscos-e-cuidados)
10. [Execução e validação](#10-execução-e-validação)

---

## 1. Resumo

Todo o visual do sistema vem de um único arquivo, `apps/web/app/styles.css` (1.270 linhas), que cresceu
por camadas: cada nova tela acrescentou um bloco que **sobrescreve** regras anteriores em vez de
reaproveitá-las. O resultado é um sistema sem tokens de design, com o mesmo componente desenhado de
formas diferentes em cada tela e com o tema escuro definido duas vezes.

| Indicador (medido em 2026-10-23) | Valor |
|---|---|
| Cores hexadecimais distintas | **347** |
| Tamanhos de fonte distintos | **40** |
| Valores de `padding` distintos | **90** |
| `border-radius` distintos | 18 |
| `box-shadow` distintos | 19 |
| Breakpoints distintos | 8 (480, 560, 600, 620, 680, 760, 900, 1100) |
| Seletores redefinidos fora de `@media`/tema | ~120 (ex.: `.card` ×3, `.button` ×3, `.metric` ×4) |
| `!important` | 12 |
| Classes usadas no JSX **sem nenhuma regra CSS** | 9 |
| Classes no CSS **sem uso** aparente | ~12 |
| Blocos de tema escuro | 2, com paletas diferentes |
| Avisos `.notice` sem variante (sem fundo nem borda) | 41 |

A correção proposta é feita em **7 ciclos pequenos**, do mais seguro (tokens, sem mudança visual) ao
mais visível (estrutura de página), cada um com testes automatizados e validação no Preview.

---

## 2. Como a varredura foi feita

### 2.1 Fase estática (executada nesta sessão)

- Leitura integral de `apps/web/app/styles.css`, `app/layout.tsx`, `components/AuthGate.tsx` e
  `components/AppSidebar.tsx`.
- Script de varredura (fora do repositório) que cruzou as classes usadas em `app/**/*.tsx` e
  `components/**/*.tsx` com as classes definidas no CSS e contou cores, fontes, espaçamentos, raios,
  sombras, breakpoints, `z-index`, `!important` e seletores redefinidos.
- Contagem por arquivo de botões, tabelas, avisos, títulos (`h1`–`h5`), `<details>`, `window.confirm`,
  estados de carregamento e cabeçalhos de página.

### 2.2 Fase visual (a executar no Ciclo 0)

A fase estática não enxerga sobreposição, quebra de linha, contraste real nem comportamento em telas
estreitas. A fase visual percorre **todas as rotas** da [matriz](#4-matriz-por-tela) em:

| Dimensão | Valores |
|---|---|
| Largura | 1440 px, 1024 px, 768 px, 390 px |
| Tema | claro e escuro |
| Barra lateral | expandida e recolhida |
| Idioma | pt-BR (textos longos em en/zh-CN conferidos nas telas de formulário) |
| Estados | carregando, vazio, com dados, erro, somente leitura |

Cada achado visual entra na tabela da seção 3 com um novo ID, captura de tela anexada ao PR (sem dados
sensíveis) e o seletor CSS responsável.

---

## 3. Mapeamento das inconsistências

Severidade: **A** = afeta uso ou leitura (texto invisível, aviso que não parece aviso, elemento sem
estilo); **M** = inconsistência visível entre telas; **B** = dívida técnica sem efeito visual direto.

### 3.1 Fundação (tokens de design)

| ID | Sev. | Achado | Evidência | Correção proposta |
|---|---|---|---|---|
| F-01 | M | Não existem tokens de cor. A cor primária aparece em 6 tons quase iguais | `#087889` ×13, `#0d7885` ×13, `#086d7e` ×12, `#0e7482`, `#075f70`, `#075969` | Criar `--color-primary`, `--color-primary-hover`, `--color-primary-soft` em `:root` e substituir |
| F-02 | M | Texto secundário em ~12 cinzas diferentes | `#526371`, `#617985`, `#627381`, `#526b78`, `#526a77`, `#627987`, `#647984`, `#647987`… | Reduzir a `--text`, `--text-muted`, `--text-subtle` |
| F-03 | M | Bordas em ~10 tons | `#dce6eb`, `#dce4eb`, `#d9e3e9`, `#e0e8ed`, `#dce5ea`, `#d3e4e6`… | `--border`, `--border-strong`, `--divider` |
| F-04 | M | 40 tamanhos de fonte, muitos com 0,01 rem de diferença | `.82`, `.83`, `.84`, `.85`, `.86`, `.88rem`; `.75`, `.76`, `.78rem` | Escala de 7 passos (`--fs-xs` … `--fs-2xl`) |
| F-05 | B | 90 valores de `padding` e 30 de `gap` sem escala | ver seção 1 | Escala de espaçamento de 4 px (`--space-1` … `--space-8`) |
| F-06 | M | Raio do card muda conforme a camada: 12 → 14 → 16 px; botões 7, 8 e 9 px | `styles.css:4`, `:133`, `:652`; `:6`, `:184`, `:649` | `--radius-sm/md/lg/pill` |
| F-07 | B | 19 sombras diferentes | ver seção 1 | `--shadow-sm/md/lg/popover` |
| F-08 | M | 8 breakpoints; telas mudam de layout em larguras diferentes | 480, 560, 600, 620, 680, 760, 900, 1100 | Padronizar em 3–4 (ex.: 480, 760, 1100) |
| F-09 | B | `z-index` sem escala (1, 2, 5, 8, 30, 1000, 1001, 1100, 1101) | `styles.css:431`, `:440`, `:106-107`, `:767` | `--z-sticky`, `--z-sidebar`, `--z-menu`, `--z-popover` |
| F-10 | B | Cor hexadecimal malformada | `.po-workflow-nav { background: #f4f7faeF }` (`styles.css:469`) | Corrigir junto com F-01 |
| F-11 | M | Fonte `Arial` no app; o protótipo `FluxoE2E.css` (não versionado) usa Quicksand e IBM Plex Mono e outra paleta (azul `#0A86BF` e verde-limão) | `styles.css:1`; `FluxoE2E.css:2-10` | Decisão D-02 |

### 3.2 Cascata do CSS e código morto

| ID | Sev. | Achado | Evidência | Correção proposta |
|---|---|---|---|---|
| C-01 | B | Componentes base definidos em 2–4 blocos que se sobrescrevem | `.button` (`:6`, `:184`, `:649`), `.card` (`:4`, `:133`, `:652`), `.metric` (`:4`, `:6`, `:140-143`), `.page-header` (`:3`, `:136-138`) | Fundir cada componente em uma única regra |
| C-02 | M | `.secondary` nasceu cinza com `margin-left: 8px` e foi "zerado" caso a caso | `:8` (cinza), `:650` (claro); `margin-left: 0` em `:48`, `:126`, `:409`, `:468`, `:650`; `4px` em `:41` | Remover a margem da variante; espaçamento pelo contêiner (`gap`) |
| C-03 | B | 12 `!important` usados para vencer a própria cascata | `.eyebrow`, `.source-detail-row > td`, `.source-row-has-gap .source-pin`, `.product-catalog-search` | Eliminar após C-01 |
| C-04 | A | Classes usadas no JSX sem regra CSS (o elemento fica sem layout) | `button-row` (`app/pcm/page.tsx:236`, `:271`; `DeletedPurchaseOrderActions.tsx:85`), `form-error` (`NcmTaxTreatments.tsx:68`, erro sem cor), `source-disclosure` (`app/quality/page.tsx:86-87`), `po-lifecycle-actions`, `po-reimport`, `po-item-removal`, `po-common-fields` (`OperationalPoPanel.tsx`), `pcm-sc-selector` (`PurchaseRequestSelect.tsx`), `totvs-sc-create` (`NewOperationalRecord.tsx`) | Criar a regra ou trocar pela classe padrão (`notice error`, `.actions`) |
| C-05 | B | CSS sem uso (resto de telas antigas) | `.session-bar`, `.session-identity` (barra superior substituída pela lateral), `.field-form`, `.operational-summary`, `.shipment-milestones`, `.source-values`, `.po-entry-summary`, `.risk.*` | Confirmar com busca por classe dinâmica e remover |
| C-06 | B | Ícones da barra lateral sem item correspondente | `reports`, `quality`, `noIp`, `noPo` em `AppSidebar.tsx:44-63` | Remover ou usar conforme D-04 |
| C-07 | B | Menus de seleção duplicados com CSS quase idêntico | `.catalog-product-*` (`:429-436`, usado por `OperationalOptionSelect`) e `.searchable-select-*` (`:437-446`) | Uma única família de classes de menu |
| C-08 | B | Regra que nunca vence: `.page-header p` com `max-width: 880px` dentro de `.page-header` com `max-width: 760px` | `:3`, `:138` | Definir uma largura de leitura única (F-05/E-06) |

### 3.3 Tema escuro

| ID | Sev. | Achado | Evidência | Correção proposta |
|---|---|---|---|---|
| T-01 | M | Tema escuro definido duas vezes, com paletas diferentes; o segundo bloco sobrescreve parte do primeiro | Bloco 1 `:245-394` (superfície `#19262f`), bloco 2 `:836-1036` (`--dark-surface: #1d2d37`) | Um único bloco que só redefine os tokens de F-01…F-07 |
| T-02 | **A** | Campos genéricos ficam **brancos no tema escuro**: a regra global `input, select, textarea { background-color: #fff }` não tem par escuro; só contextos listados um a um foram cobertos | `:634-648`; ficam brancos campos em `.operational-fields`, `.ip-entry-grid`, `.entity-value-edit`, `.po-lifecycle-reason`, `.ncm-tax-form`, `.shipment-date-form`, `.invoice-match-table`, `.allocation-*`, `.sc-list-filter`, `input[readonly]` | Resolvido por T-01 (campo usa token) |
| T-03 | A | Superfícies claras sem par escuro | `.po-workflow-nav` (barra fixa), `.po-ip-line-detail`, `.ncm-attribute-card`, `.ncm-domain-options`, `.ncm-tax-result`, `.catalog-candidates`, `.sc-list-filter`, `.report-status-track`, `.source-option-hint` | Resolvido por T-01 |
| T-04 | M | Cores fixas dentro de componentes com tokens próprios | `.e2e-segmented button[aria-pressed="true"] { background: #087889 }` (`:1142`) | Usar token |

### 3.4 Componentes

| ID | Sev. | Achado | Evidência | Correção proposta |
|---|---|---|---|---|
| K-01 | **A** | `.notice` sem variante não tem fundo nem borda: avisos importantes ("PO excluída", "somente leitura", "divergência de exportador", rascunho, cancelado) parecem texto comum | 41 usos de `className="notice"`; regra em `:7` e `:213` | Variantes `notice info` e `notice warning` (com ícone opcional) e revisão dos 41 usos |
| K-02 | M | Seis implementações de "pílula de status", cada uma com tamanho e espaçamento próprios | `.risk` (`.78rem`, `4px 8px`), `.quality-status` (`.78rem`, `5px 9px`), `.product-catalog-status` (`.76rem`, `5px 9px`), `.po-item-status` (`.75rem`, `5px 10px`), `.source-gap-tag` (`.67rem`, `3px 6px`), `.e2e-pill` (`.7rem`, `4px 10px`) | Componente único `.badge` com variantes `success`, `warning`, `danger`, `neutral`, `info` |
| K-03 | M | Três linguagens de foco | contorno laranja `#e88415` (`:58`), contorno `#f2a23a` na lateral (`:784`), contorno verde translúcido (`:1046`, `:1071`, `:1082`), anel por sombra nos campos com `outline: 0` (`:640`) | Um token `--focus-ring` aplicado a todos os elementos interativos |
| K-04 | M | Confirmação de ação destrutiva em três padrões | `window.confirm` nativo (`catalog/values/page.tsx:617`, `OperationalPoPanel.tsx:305`), `<form className="notice" role="dialog">` (`pcm/page.tsx:265`), componente `ShippedChangeConfirmation` | Decisão D-05 |
| K-05 | M | Quatro estilos de "expandir/recolher" | `+`/`−` (`.historical-disclosure`, `.po-header-disclosure`, `.catalog-candidates`), chevron (`.process-action-trigger`), glifo girado (`.po-item-toggle`), marcador nativo do navegador (`.operational-panel details`, `.quality-item`, `.ncm-*`, `.totvs-import-details`) | Um padrão de `summary` com chevron |
| K-06 | M | Dois estilos de abas | aba de pasta (`.source-tab`, `:63-65`) e aba sublinhada (`.request-tabs`, `:614-617`) | Um único componente de abas |
| K-07 | B | Estado "carregando" é só texto, com e sem `role="status"` | `<p role="status">` em 26 lugares; `app/quality/page.tsx:83` sem `role` | Componente/classe `.loading` com indicador e `role="status"` |
| K-08 | M | Grades de indicadores com colunas diferentes por tela, e uma implementação paralela no E2E | `.metric-grid` 4 col., `.report-metrics` 3, `.quality-metrics` 3, `.source-audit-metrics` 5, `.e2e-kpi` (cópia do `.metric`) | Grade única `auto-fit` + reaproveitar `.metric` no E2E |
| K-09 | B | Cabeçalho fixo de tabela (`position: sticky`) sem rolagem vertical no contêiner, então não fixa | `.table-scroll th` (`:146`) com `.table-scroll` sem `max-height` | Definir quando a tabela rola (ou retirar o `sticky`) |
| K-10 | M | Títulos de seção com tamanhos diferentes para o mesmo nível | `h2`: `.card > h2` 1.2 rem, `.report-section-heading h2` 1.55 rem, `.e2e-flow h2` 1.05 rem, `.quality-heading h2` 1.2 rem | Escala tipográfica de F-04 por nível |

### 3.5 Estrutura de página e navegação

| ID | Sev. | Achado | Evidência | Correção proposta |
|---|---|---|---|---|
| E-01 | M | Três nomes de produto ao mesmo tempo | Aba do navegador "TMS - Supply Chain \| Eletra" (`layout.tsx:6`), login "TMS / Supply Chain" com logotipo Eletra (`login/page.tsx:47-48`), lateral "ERP Comex" com selo de texto "EC" (`AppSidebar.tsx:93-95`), sobretítulo "ERP Comex" em 9 telas | Decisão D-01 |
| E-02 | M | Sobretítulo (`.eyebrow`) sem regra: fixo "ERP Comex" em 9 telas e contextual nas demais; as duas telas de Administração divergem | `admin/users/page.tsx:128` ("ERP Comex") × `admin/outbox/page.tsx:63` (`m.admin.eyebrow`) | Sobretítulo = grupo da barra lateral (Operação, Gestão, Administração, PCM) |
| E-03 | M | Link "Voltar" em três posições e com regras diferentes | Acima do cabeçalho com `.back` (`ProcessWorkspace`, `PurchaseOrderWorkspace`, `NewOperationalRecord`, `quality`, `LegacyQueue`); dentro do cabeçalho com `.text-link` (`requests/[id]/page.tsx:132`, `catalog/values/page.tsx:703`, `:769`, `:903`, `:961`); em `/processes`, que é item de primeiro nível da lateral, aparece "Voltar à carteira" (`ProcessDirectory.tsx:79`) | Voltar só em telas de detalhe, sempre acima do título, com o mesmo componente |
| E-04 | M | Telas fora da navegação | `/quality`, `/reports/pre`, `/reports/post`, `/pending-import-items`, `/unassigned-po-items` só são alcançáveis por links de texto no cabeçalho (`app/page.tsx:201`, `ProcessDirectory.tsx:83`); `/source-audit` não tem nenhum link | Decisão D-04 |
| E-05 | M | Telas de carregamento/erro da sessão aparecem **sem a barra lateral**, causando salto de layout na abertura de qualquer página | `AuthGate.tsx:82-86` | Esqueleto com a lateral reservada |
| E-06 | M | Larguras de conteúdo arbitrárias por tela | `.page-header` 760, `.portfolio-header` 1160, `.request-form` 900, `.entity-values-card` 960, `.allocation-po-search` 760, `.process-action > .stack-form` 620, `.po-lifecycle-reason` 520; `.source-audit-shell` muda o `padding` lateral | 2 larguras: leitura (~72ch) e formulário (~960 px); a página usa toda a largura |
| E-07 | B | Cabeçalho de página escrito à mão em 20 lugares, com variações de estrutura (intro, ações, links) | ver matriz da seção 4 | Componente `PageHeader` (decisão D-03) |

### 3.6 Responsivo e acessibilidade visual

| ID | Sev. | Achado | Evidência | Correção proposta |
|---|---|---|---|---|
| R-01 | M | Em ≤ 760 px a lateral vira um bloco no topo com toda a navegação aberta; recolhida, a navegação some | `styles.css:822-834` | Validar na fase visual; avaliar menu compacto |
| R-02 | M | `td { white-space: nowrap }` global força rolagem horizontal até em textos longos | `:5` | Quebra permitida por coluna de texto |
| R-03 | B | Grades com colunas fixas e quebras próprias (`.operational-fields` 8→4→2→1, `.po-header-fields` 5→3→1) | `:422-427`, `:725-727` | Validar na fase visual |
| R-04 | M | Contraste a medir: textos `.source-excel-col` `#81919c` em `.65rem`, `.source-value-option small` `#81919c` em `.7rem`, placeholders `#8697a1` | `:99`, `:122`, `:638` | Medir (WCAG AA 4,5:1) na fase visual e ajustar tokens |
| R-05 | B | 10 estilos inline, todos de posicionamento dinâmico (aceitáveis) | `E2eFlowDemo.tsx`, `SearchableSelect.tsx:134`, `OperationalOptionSelect.tsx:94`, `ReportsView.tsx:33` | Manter; impedir novos estilos inline de cor/tipografia |

---

## 4. Matriz por tela

Guia para a fase visual e para validar cada ciclo. "IDs" lista os achados que afetam a tela.

| Rota | Componente | Grupo na lateral | IDs |
|---|---|---|---|
| `/login` | `app/login/page.tsx` | — | E-01, K-03, T-01 |
| `/change-password` | `app/change-password/page.tsx` | conta | E-02 |
| `/` (Pré-embarque) | `app/page.tsx` | Operação | E-02, E-04, K-08 |
| `/purchase-orders/lines` | `ProductLinesView.tsx` | Operação | E-02, E-06, R-02 |
| `/purchase-orders/new` | `NewOperationalRecord.tsx` | — | K-01, C-04, T-02, E-06 |
| `/purchase-orders/[id]` | `PurchaseOrderWorkspace.tsx`, `OperationalPoPanel.tsx`, `FollowupPanel.tsx` | — | K-01, K-04, K-05, C-04, T-02, T-03, F-10, R-03 |
| `/processes` (Pós-embarque) | `ProcessDirectory.tsx` | Operação | E-03, E-04, K-01 |
| `/processes/new` | `NewOperationalRecord.tsx` | — | K-01, T-02 |
| `/processes/[id]` | `ProcessWorkspace.tsx`, `ProcessPostShipmentPanel.tsx` | — | K-01, K-05, T-02 |
| `/end-to-end` | `E2eFlowDemo.tsx` | Operação | F-11, K-08, T-04 |
| `/requests` | `app/requests/page.tsx` | Gestão | K-01, K-06 |
| `/requests/[id]` | `app/requests/[id]/page.tsx` | — | E-03 |
| `/catalog` | `app/catalog/page.tsx` | Gestão | E-02, K-05, T-03 |
| `/catalog/values?entity=…` | `app/catalog/values/page.tsx`, `NcmTaxTreatments.tsx` | — | E-03, K-02, K-04, C-04, T-02, T-03 |
| `/pcm` | `app/pcm/page.tsx` | PCM | K-01, K-04, C-04, T-02 |
| `/admin/users` | `app/admin/users/page.tsx` | Administração | E-02 |
| `/admin/outbox` | `app/admin/outbox/page.tsx` | Administração | E-02, K-08 |
| `/quality` | `app/quality/page.tsx` | fora da lateral | E-04, K-02, K-07, C-04 |
| `/reports/pre`, `/reports/post` | `ReportsView.tsx` | fora da lateral | E-04, K-08, K-10, T-03 |
| `/source-audit` | `app/source-audit/page.tsx` | sem link | E-04, E-06, K-06, R-04 |
| `/pending-import-items`, `/unassigned-po-items` | `LegacyQueue.tsx` | fora da lateral | E-03, E-04 |

---

## 5. Especificação da tarefa

```markdown
# Tarefa: Padronizar layout e web design do apps/web

## Objetivo
Eliminar as inconsistências visuais mapeadas na seção 3, criando uma base única de tokens e
componentes visuais, sem alterar regras de negócio, contratos com a API ou textos.

## Requisitos
- Tokens de cor, tipografia, espaçamento, raio, sombra, z-index e foco em :root, com um único
  bloco de tema escuro que só redefine tokens.
- Cada componente base (botão, card, métrica, aviso, badge, abas, disclosure, menu, campo) com
  uma única definição no CSS.
- Nenhuma classe usada no JSX sem regra; nenhuma regra sem uso.
- Todos os campos e superfícies legíveis no tema escuro.
- Cabeçalho de página, sobretítulo e link "Voltar" com uma regra única.

## Restrições
- Sem nova dependência de runtime; CSS puro, como hoje (sem Tailwind, CSS-in-JS ou biblioteca de UI).
- Textos continuam vindo de apps/web/lib/i18n/ nos três idiomas (AGENTS.md).
- Nenhuma mudança em apps/api, banco ou variáveis da Vercel.
- Os 10 estilos inline de posicionamento dinâmico permanecem.
- Trabalho na branch homologacao, commits pequenos, promoção para main só por PR após aprovação.

## Critérios de aceite
1. Teste estático: toda classe estática usada em app/ e components/ tem regra em styles.css.
2. Teste estático: cores hexadecimais aparecem somente no bloco de tokens (com lista de exceções
   documentada, ex.: ícones SVG embutidos).
3. Teste estático: nenhum seletor de componente base definido mais de uma vez fora de @media.
4. Teste estático: zero !important (ou exceções documentadas).
5. Teste estático: breakpoints apenas dos valores aprovados.
6. Fase visual sem achados de severidade A nas rotas da seção 4, nos dois temas e quatro larguras.
7. lint, type-check, test e build do apps/web passando; Preview Ready e validado.

## Fora do escopo
- Redesenho de fluxos, mudança de textos ou de regras de negócio.
- Integrar o protótipo FluxoE2E.jsx/.css (depende de D-02).
- Biblioteca de componentes ou troca de stack de estilos.
- Planilhas TOTVS/INV exportadas.

## Plano
Ver seção 6 (Ciclos 0 a 7).
```

---

## 6. Ciclos de correção

Cada ciclo termina com o ciclo de verificação do AGENTS.md (lint, type-check, testes, build), commit na
`homologacao`, push para `production homologacao` e validação no Preview. Nenhum ciclo depende de
backend.

### Ciclo 0 — Rede de segurança e fase visual

1. Criar `apps/web/test/layout-consistency.test.mjs` (estilo `node --test` de
   `i18n-coverage.test.mjs`) com os critérios 1 a 5. Os testes 2 a 5 começam com a **contagem atual
   como limite máximo** (catraca): só podem diminuir, e cada ciclo reduz o limite.
2. Executar a fase visual (seção 2.2) e registrar os achados novos na seção 3.
3. Guardar capturas de referência das rotas da seção 4 (fora do repositório; ver D-06).

### Ciclo 1 — Tokens sem mudança visual

1. Declarar em `:root` os tokens de F-01 a F-09 e K-03 com os valores **mais usados hoje**.
2. Substituir valores literais pelos tokens onde o valor já é idêntico.
3. Esperado: nenhuma diferença nas capturas.

### Ciclo 2 — Consolidar a cascata e remover código morto

1. Fundir as definições repetidas de `.button`, `.secondary`, `.card`, `.metric`, `.page-header`,
   `table`, campos e demais seletores de C-01 em uma regra cada.
2. Retirar a margem de `.secondary` (C-02) e os `!important` (C-03).
3. Remover o CSS sem uso de C-05 e os ícones de C-06 (conforme D-04).
4. Unificar os menus de seleção (C-07).
5. Organizar `styles.css` por seções na ordem: tokens → base → layout → componentes → telas → tema
   escuro (ou dividir em arquivos, conforme D-03).

### Ciclo 3 — Tema escuro único

1. Substituir os dois blocos (`:245-394` e `:836-1036`) por um bloco que redefine apenas os tokens.
2. Corrigir T-02, T-03 e T-04 por meio dos tokens.
3. Validar todas as rotas no tema escuro.

### Ciclo 4 — Componentes base

1. Avisos: variantes `info` e `warning`; revisar os 41 usos de `.notice` sem variante e escolher a
   correta para cada um (K-01).
2. Badge único substituindo as 6 pílulas (K-02), mantendo os valores de status vindos da API.
3. Foco único (K-03), disclosure único (K-05), abas únicas (K-06), carregamento padrão (K-07).
4. Regras para as classes órfãs de C-04 (`button-row` → contêiner de ações com `gap`;
   `form-error` → `notice error`).
5. Confirmação destrutiva conforme D-05 (K-04).

### Ciclo 5 — Estrutura de página

1. Padronizar cabeçalho, sobretítulo (E-02), link "Voltar" (E-03) e larguras (E-06, C-08).
2. Esqueleto de carregamento com a lateral reservada (E-05).
3. Nome do produto conforme D-01 (E-01) e navegação conforme D-04 (E-04).
4. Textos novos (se houver) nos três dicionários de `lib/i18n/`.

### Ciclo 6 — Tipografia, responsivo e contraste

1. Aplicar a escala tipográfica por nível de título (F-04, K-10) e grade de indicadores única (K-08).
2. Reduzir breakpoints (F-08) e tratar R-01 a R-03.
3. Ajustar tokens que falharem no contraste AA (R-04).

### Ciclo 7 — Validação final e promoção

1. Repetir a fase visual completa e anexar as comparações antes/depois ao PR.
2. Após aprovação, PR `homologacao` → `main`; depois, atualizar `homologacao` com `main`.
3. Atualizar o AGENTS.md com as regras de estilo aprendidas (tokens obrigatórios, sem `!important`,
   badge/aviso padrão), para evitar regressão.

---

## 7. Testes e verificação

| Verificação | Como | Quando |
|---|---|---|
| Classes sem regra / regras sem uso | `test/layout-consistency.test.mjs` | Todo ciclo |
| Cores, `!important`, breakpoints, seletores repetidos (catraca) | `test/layout-consistency.test.mjs` | Todo ciclo |
| Textos nos três idiomas | `test/i18n-coverage.test.mjs`, `test/i18n.test.mjs` e type-check | Ciclos 4 e 5 |
| Lint, testes, build (o build faz o type-check) | `corepack pnpm lint`, `corepack pnpm test`, `corepack pnpm build` em `apps/web`, como no `web-ci.yml` | Todo ciclo |
| Regressão visual | Capturas das rotas da seção 4 (D-06) | Ciclos 0, 1, 3 e 7 |
| Preview | `npx --yes vercel@50.1.6 ls erp-comex --environment preview`; status `Ready` e commit conferido | Todo push |

Testes de layout não acessam banco nem API; a fase visual usa apenas dados já existentes no HML pelo
Preview, sem criar ou alterar registros.

---

## 8. Decisões

Respondidas pelo usuário em 2026-10-23.

| ID | Pergunta | Decisão |
|---|---|---|
| D-01 | Nome do produto | **TMS - Supply Chain** (aba, login, barra lateral). Sobretítulos passam a mostrar a área da tela. |
| D-02 | Protótipo `FluxoE2E` | O fluxo E2E segue a identidade do projeto (tokens, fonte e cores da logo). Os arquivos `FluxoE2E.*` locais não foram alterados. |
| D-03 | Componentes e arquivos de estilo | O que for mais profissional e escalável: tokens + CSS dividido por camada/área + componentes `PageHeader` e `ConfirmDialog`. |
| D-04 | Telas fora da lateral | Ganham entrada própria: novo grupo **Análise** na barra lateral. |
| D-05 | Confirmação destrutiva | Janela própria do sistema (`<dialog>` nativo). |
| D-06 | Capturas de tela | Não fazer; o usuário valida no Preview e ajustamos em seguida. |

Diretriz adicional: as cores secundárias saem da logo do login (`public/logo-eletra.png`): o azul mais
escuro das faixas e o verde das letras.

---

## 9. Riscos e cuidados

- **Regressão visual em cascata:** remover uma regra repetida pode mudar uma tela que dependia da
  ordem. Mitigação: Ciclo 1 sem mudança visual, catraca nos testes e capturas antes/depois.
- **Classes montadas dinamicamente** (ex.: `quality-status ${item.status}`, `side-${side}`) parecem
  "sem uso" na busca estática. Conferir cada item de C-05 antes de remover.
- **Valores da API** usados como classe (`OPEN`, `RESOLVED`, `ESCALATED`) continuam em português/inglês
  como hoje; só a aparência muda.
- **Diff grande:** cada ciclo vira um ou mais commits revisáveis; o Ciclo 4 pode ser dividido por
  componente.
- **Alterações locais não versionadas** (`FluxoE2E.*`, `eletra-logo.png`, `docs/PLANO_CICLO_VIDA_PO.md`)
  não fazem parte desta tarefa e não serão incluídas nos commits.

---

## 10. Execução e validação

### 10.1 Paleta derivada da logo

Cores medidas nos pixels de `apps/web/public/logo-eletra.png`. As cores da logo são claras demais
para texto sobre branco; por isso texto e botões usam tons mais escuros com o mesmo matiz.

| Token | Cor | Origem / uso | Contraste no branco |
|---|---|---|---|
| `--brand-blue` | `#02A0D1` | Faixa azul mais escura da logo. Barras de destaque, foco, trilhas | 3,0:1 (não usar em texto) |
| `--brand-blue-mid` / `--brand-blue-light` | `#01BCE7` / `#48CDF4` | Demais faixas da logo | decorativo |
| `--color-primary` / `--color-link` | `#037599` | Mesmo matiz da faixa escura. Botões, links, item ativo da lateral | 5,2:1 ✓ |
| `--color-primary-hover` | `#13637C` | Hover dos botões | 6,8:1 ✓ |
| `--brand-green` | `#9FC916` | Verde das letras "eletra". Indicador do item ativo, lado Brasil no E2E | 1,9:1 (não usar em texto) |
| `--brand-green-light` | `#B2D440` | Verde de "energy solutions" | decorativo |
| `--color-accent-text` | `#516218` | Mesmo matiz do verde. Sobretítulos, textos de sucesso | 6,8:1 ✓ |

O teste `layout-consistency` confere o contraste AA de todos os pares de texto/fundo nos temas claro e
escuro.

### 10.2 Estrutura entregue

| Arquivo | Conteúdo |
|---|---|
| `app/styles/tokens.css` | Único arquivo com cores literais; tema escuro só redefine tokens |
| `app/styles/base.css` | Elementos (campos, tabelas, foco, textos auxiliares) |
| `app/styles/layout.css` | Moldura: `.shell`, cabeçalho de página, barra lateral, login |
| `app/styles/components.css` | Botões, cards, métricas, avisos, badges, abas, disclosure, tabelas, seletores, diálogo, históricos |
| `app/styles/features/*.css` | Operações (PO/IP), cadastros, auditoria da planilha, análise (relatórios, qualidade, solicitações, IP) e E2E |
| `components/PageHeader.tsx` | Cabeçalho único: sobretítulo, título, intro, ações e "voltar" só em detalhe |
| `components/ConfirmDialog.tsx` | Janela de confirmação (`<dialog>`), também como `useConfirmDialog()` |
| `public/brand-mark.png` | Símbolo (três faixas) recortado da logo, usado na barra lateral |
| `test/layout-consistency.test.mjs` | Cores só nos tokens, escalas de fonte/raio/camada, breakpoints 480/760/1100, sem `!important`, uma regra por seletor, classes usadas × definidas, contraste AA, uso de `PageHeader` e do diálogo |

### 10.3 Situação de cada achado

- **Resolvidos:** F-01 a F-04, F-06 a F-10, C-01 a C-08, T-01 a T-04, K-01 a K-08, K-10, E-01 a E-07, R-04.
- **Parciais:** F-05 (tokens de largura criados; espaçamentos continuam em px, sem escala obrigatória);
  F-11 (fonte Arial mantida, agora no token `--font-sans`).
- **Mantidos para validar no Preview:** K-09 (cabeçalho fixo de tabela), R-01 (lateral no celular),
  R-02 (`nowrap` nas células), R-03 (grades de campos). R-05 mantido de propósito.

### 10.4 Onde validar no Preview

Validar nos temas claro e escuro, com a lateral expandida e recolhida.

| Onde | O que conferir |
|---|---|
| Login e aba do navegador | Nome "TMS - Supply Chain"; cartão do login no tema escuro |
| Barra lateral | Símbolo da logo, item ativo azul com faixa verde, grupo **Análise** com 5 itens |
| Abertura de qualquer página | A lateral não "pisca" nem desloca a página durante a verificação da sessão |
| Pré-embarque, Carteira por produto, Pós-embarque | Cabeçalho com sobretítulo verde e botão "Nova PO/Novo IP" à direita |
| Detalhe da PO | "Voltar" acima do título; avisos de ciclo em amarelo; status dos itens em badge; seta de expandir à direita do item; **Excluir PO** abre a janela de confirmação |
| Novo registro de PO/IP | Avisos de duplicidade e pendências em amarelo; campos legíveis no tema escuro |
| Detalhe do IP | Avisos de exportador/cancelado/excluído em amarelo; botões de ação com a seta padrão |
| Cadastros → Valores das entidades | "Voltar" para Cadastros; status em badge; **Excluir** abre a janela de confirmação |
| PCM | **Excluir SC** abre a janela com campo de motivo |
| Indicadores | Abas Pré/Pós embarque; barras de status no azul da logo |
| Qualidade, Auditoria, Linhas sem IP/PO | Acesso pela lateral; badges de status; abas da auditoria iguais às de Solicitações |
| End-to-end | Lado Brasil em verde e lado China em azul da logo, nos dois temas |
