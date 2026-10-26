# Plano de implementação — Modelo e linhas por produto na mesma tela do End to End

| Item | Valor |
|---|---|
| Data | 2026-10-26 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | Preview Vercel da `homologacao` (somente web; a API não muda) |
| Status | **Implementado e verificado localmente (testes, lint, type-check e build); validação no Preview pendente** |

## 1. Resumo

As abas "Linhas por produto" e "Modelo" do End to End passam a ser uma só tela em `/end-to-end`. A etapa escolhida ou animada no Modelo filtra a tabela de linhas com a mesma lógica que a aba de linhas já usa: contagem por etapa, Na etapa/Acumulada, Só atrasados, cache por etapa e filtros na URL. As abas ficam **Modelo · Análise por PO · Metas**.

## 2. Especificação

### Objetivo
Ver na mesma tela o fluxo de referência (prazos, régua, etapa ativa e marcos) e as linhas reais de cada etapa, sem trocar de aba.

### Requisitos

1. **Tela `/end-to-end`, de cima para baixo:**
   1. o cabeçalho e as abas;
   2. a barra com Não MTS/MTS, Marítimo/Aéreo, Na etapa/Acumulada, Só atrasados, Todas as etapas e ◀ Animar ▶;
   3. a ajuda da visão escolhida;
   4. os indicadores do Modelo (lead time, folga e horizonte);
   5. os sentidos Brasil→China e China→Brasil;
   6. o trilho e os cards das etapas;
   7. a régua do horizonte, a etapa ativa e os marcos;
   8. os filtros, a exportação, a tabela e a paginação.
2. **Cards das etapas:** cada card mantém o conteúdo do card do Modelo: código, situação (Em curso/Concluída/Próxima), ícone, nome, de/para, responsável e prazo. Abaixo vem a contagem das linhas ("N produtos na etapa" ou "N já concluíram", mais "N atrasados" ou "Nenhum atrasado"). Clicar seleciona a etapa, e clicar de novo na etapa selecionada desmarca.
3. **Estado inicial:** ao abrir, nenhuma etapa vem selecionada e nada anima. A tabela mostra todas as linhas. "Animar" começa no T0, e "Todas as etapas" volta a esse estado. Um link com `?stage=T3&view=reached&late=1` abre já filtrado, como hoje.
4. **Sem etapa selecionada:**
   - o trilho fica sem marcador;
   - nenhum sentido, segmento da régua ou marco aparece como ativo ou alcançado;
   - os cards não mostram a situação;
   - o painel "Fase ativa" mostra o texto novo `e2e.selectPhase`, nos 3 idiomas.
5. **Não MTS/MTS e Marítimo/Aéreo** mudam apenas os prazos teóricos do Modelo, inclusive o nome e o ícone do T4, e não filtram a tabela.
6. **Rotas:** `/end-to-end/model` redireciona para `/end-to-end`. As abas passam a ser Modelo (`/end-to-end`), Análise por PO e Metas.
7. **Sem mudança na API:** a tela continua chamando `GET /api/v1/purchase-order-lines` e `GET /api/v1/purchase-order-lines/e2e-stages` com os mesmos parâmetros.

### Restrições
- Textos nos três dicionários. Saem `e2eTabs.lines`, `e2e.eyebrow`, `e2e.title`, `e2e.intro` e `e2e.toolbar`, que ficam sem uso, e entra `e2e.selectPhase`.
- Estilos só em `app/styles/features/e2e.css` com tokens. Toda classe usada precisa de regra, e regra sem uso sai.
- A busca, o cache por etapa, a sincronização da URL e a exportação de [E2eLinesView.tsx](../apps/web/components/E2eLinesView.tsx) não mudam.

### Critérios de aceite
1. `/end-to-end` renderiza a tela unificada, com `E2eTabs current="model"` e os painéis do Modelo (`E2eModelSummary` e `E2eModelDetails`).
2. Os cards usam as fases de `buildE2eFlow` e mostram as contagens de `e2e-stages`.
3. O seletor de etapa começa sem etapa (`autoplay` falso), e os painéis aceitam `current === null`.
4. `/end-to-end/model` chama `redirect("/end-to-end")`.
5. As abas têm só `model`, `po` e `targets`.
6. `E2eFlowDemo.tsx` deixa de existir, e `E2E_PHASE_COUNT` e `autoplay` saem de `lib/e2e-flow.ts`.
7. `npm test`, `npm run lint`, `npx tsc --noEmit` e `npm run build` em `apps/web` passam.
8. No Preview, `/end-to-end` mostra o Modelo e as linhas, e `/end-to-end/model` redireciona.

### Fora do escopo
- Filtrar a tabela por MTS ou por modal.
- Mudanças na API, no cálculo das etapas ou nas metas.
- Mudanças em "Análise por PO" e "Metas".

## 3. Etapas

1. Atualizar os testes `e2e-lines-view`, `e2e-flow` e `e2e-analysis` para a tela unificada e confirmar que falham.
2. Criar `components/E2eModelPanels.tsx` com `E2eModelSummary` (indicadores e sentidos) e `E2eModelDetails` (régua, etapa ativa e marcos), aceitando `current: number | null`.
3. Fazer de `E2eLinesView.tsx` a tela unificada, com os controles de cenário, os cards juntos e os painéis.
4. Ajustar `E2eTabs.tsx`, `app/end-to-end/model/page.tsx` (redirecionamento), `e2e.css`, `lib/e2e-flow.ts` e os 3 dicionários. Remover `E2eFlowDemo.tsx`.
5. Rodar o ciclo de verificação, revisar o diff e fazer o commit.
6. Publicar na `homologacao` e validar no Preview.

## 4. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/web/components/E2eModelPanels.tsx` | novo |
| `apps/web/components/E2eLinesView.tsx` | vira a tela unificada |
| `apps/web/components/E2eFlowDemo.tsx` | removido |
| `apps/web/components/E2eTabs.tsx` | três abas |
| `apps/web/app/end-to-end/model/page.tsx` | redireciona para `/end-to-end` |
| `apps/web/app/styles/features/e2e.css` | contagem nos cards; sai `.e2e-stage-card` |
| `apps/web/lib/e2e-flow.ts` | saem `E2E_PHASE_COUNT` e `autoplay` |
| `apps/web/lib/i18n/{pt-BR,en,zh-CN}.ts` | sai `e2eTabs.lines` e `e2e.eyebrow/title/intro/toolbar`; entra `e2e.selectPhase` |
| `apps/web/test/e2e-{lines-view,flow,analysis}.test.mjs` | tela unificada |

## 5. Riscos e cuidados

- **Nomes diferentes:** os cards usam o nome da fase do Modelo (por exemplo, "Produção HQ"), enquanto o cabeçalho da tabela continua com o título da etapa da API ("T3 · Até a saída da China"). O código da etapa liga os dois.
- **Tela mais longa:** a tabela fica abaixo dos painéis do Modelo.
- **Favoritos de `/end-to-end/model`:** continuam funcionando pelo redirecionamento.
