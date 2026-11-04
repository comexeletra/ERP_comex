# Visual dos gráficos do End to End

Redesenho dos três gráficos do resumo de `/end-to-end` a partir do pacote do web designer (`e2e-charts-handoff`, 2026-11-04). Só a camada visual mudou: dados, filtros, tabela, filtro cruzado (clique e Ctrl+clique) e cartões de Tooltip continuam como em `docs/PLANO_E2E_RESUMO_FILTRO_CRUZADO.md`.

Este plano substitui, naquele documento, a decisão D2 (pizza compacta de 120 px) e a ordem das faixas de atraso "da maior para a menor, como no Power BI".

## Decisões

| # | Decisão |
|---|---|
| V1 | **Status:** barra empilhada de 12 px (3 px entre segmentos, mínimo de 4 px) e, abaixo dela, uma trilha com um card por status, na ordem do fluxo físico: "Etapa N", rótulo, quantidade, mini barra e %. Nunca ordenar por valor. O maior status recebe destaque e aparece no chip "Maior concentração". Status vazio mostra "—" e "Nenhum item no filtro". Os cards são os botões de teclado do gráfico. |
| V2 | **Situação do prazo:** rosca (raio 70, traço 22, 3 px entre fatias; uma única fatia fecha o anel sem gap), com o % "no prazo" no centro. Legenda com quantidade, % e mini barra; item vazio esmaecido, com amostra tracejada e sem barra. |
| V3 | **Aviso dos atrasados:** no rodapé do prazo, "X% dos atrasados estão em até 30 dias · A de B", com Até 30 dias ÷ soma das faixas em atraso (Até 30 a 120+). Só aparece com atraso e com a API que envia as faixas. |
| V4 | **Faixas de atraso:** ordem cronológica (escolha do usuário), em três grupos: Sem atraso (Adiantado, No prazo), Em atraso (Até 30 a 120 dias ou mais, com o total no título) e Sem informação (Sem dados). As barras são escaladas pelo maior valor, com mínimo de 6 px. Faixa vazia só aparece se estiver selecionada e, nesse caso, sem barra. O chip "Acima de 30 dias" soma 30–45 a 120+. |
| V5 | **Cores:** os tokens de status e prazo já existentes. As faixas ganham `--color-chart-on-time-strong` (Adiantado e % do centro da rosca, texto AA) e a rampa `--color-chart-range-1` a `-6` (âmbar → vinho no tema claro; no escuro, sobe para rosa para manter o contraste). "No prazo" usa o mesmo verde da rosca. `--color-chart-range` deixou de existir. |
| V6 | **Regras do projeto acima do pacote:** cores literais só em `tokens.css`, misturas com `color-mix(in srgb, var(--chart-color) N%, var(--color-surface))` para seguir o tema escuro, escalas `--fs-*`/`--radius-*`, classes `e2e-overview-*`/`e2e-status-step-*`/`e2e-donut-*`/`e2e-range-*` e os formatos de `overviewShares`, que respeitam o idioma. |

## Movimento (pedido do usuário, 2026-11-04)

| # | Decisão |
|---|---|
| M1 | Ao trocar um filtro ou a seleção, nada muda de uma vez: totais, quantidades e % contam do valor na tela até o novo (`useTweenedNumber`, `lib/motion.ts`); larguras, `flex-grow`, arcos da rosca e cores passam por transição. Uma duração e uma curva para tudo: `--motion-chart` (.6s) e `--ease-organic` (ease-out quint, a mesma de `easeOrganic`). |
| M2 | Status e rosca mantêm todas as categorias desenhadas: a vazia encolhe até zero (o segmento devolve o espaço entre barras; o arco fica com comprimento 0 na sua posição) e cresce de novo quando volta. |
| M3 | Na primeira carga: os cards sobem em sequência, as etapas entram uma após a outra (60 ms cada), as barras crescem da esquerda, a rosca se desenha e os números contam a partir de zero. O chip "Maior concentração" reaparece com fade quando outro status assume a liderança. |
| M4 | As faixas de atraso que entram na lista sobem com fade; a que zera sai sem animação, porque faixa vazia não fica na tela. |
| M5 | Com "reduzir movimento" no sistema, tudo troca direto: o CSS desliga animações e transições do resumo, e o contador mostra o valor final no quadro seguinte. Os `aria-label` sempre trazem o valor final, nunca o contado. |

## Onde fica

- Componente: `apps/web/components/E2eOverviewCharts.tsx` (mesmas props; `E2eLinesView` não mudou).
- Lógica pura: `apps/web/lib/e2e-overview-format.ts` (`delayRangeGroups`, `delayRangeRows`, `delayRangeInsight`, `largestIndex`, `formatShare`) e `apps/web/lib/donut-chart.ts` (substitui `pie-chart.ts`).
- Estilos: `apps/web/app/styles/features/e2e.css`; tokens em `apps/web/app/styles/tokens.css`.
- Testes: `test/e2e-overview-format.test.mjs`, `test/donut-chart.test.mjs`, `test/e2e-lines-view.test.mjs` e `test/layout-consistency.test.mjs`.
