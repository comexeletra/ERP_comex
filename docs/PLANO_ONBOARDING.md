# Tarefa: Guia de primeiros passos (onboarding)

## Objetivo

Uma tela que explica a quem chega para que serve a plataforma, como funciona o processo de
importação (T0–T5, Brasil → China → Brasil) e qual tela usar em cada etapa.

## Requisitos

1. Rota `/onboarding`, no grupo "Comece aqui", no topo do menu, visível a todos os papéis.
2. Capítulo 1 – Para que serve: entradas → plataforma → áreas, benefícios e glossário (SC, PO,
   produto, IP, invoice e packing list, DUIMP, MTS/Não MTS, data de necessidade).
3. Capítulo 2 – O processo: o fluxo T0–T5 com as mesmas peças e prazos do End to End
   (`lib/e2e-flow.ts`, `E2eModelPanels`, `E2eFlowRail`) e as telas que acompanham a etapa
   selecionada.
4. Capítulo 3 – As telas: uma tela por vez, com resumo, "quando usar", desenho esquemático em SVG
   com os pontos do passo a passo numerados e animação que percorre os passos.
5. Espaço para vídeo em cada capítulo e em cada tela, aberto por link.
6. Capítulo aberto e capítulos vistos lembrados no navegador (`localStorage`), sem gravar no banco.
7. Três idiomas, tema claro e escuro, tokens e breakpoints do projeto.

## Decisões do usuário (2026-11-25)

- Imagens: ilustrações SVG esquemáticas, não capturas de tela. Seguem o tema e o idioma, não
  mostram dados reais e não ficam desatualizadas a cada mudança de layout.
- Vídeos: animações na própria página e espaço para vídeo gravado pela equipe, aberto por link.

## Onde fica

- Conteúdo que não é texto (ordem dos capítulos, etapas de cada tela, desenhos, pontos e links dos
  vídeos): `apps/web/lib/onboarding.ts`.
- Textos: `onboarding` nos três dicionários de `apps/web/lib/i18n/`.
- Componentes: `apps/web/components/Onboarding*.tsx`. Estilos: `app/styles/features/onboarding.css`.
- Testes: `apps/web/test/onboarding.test.mjs`.

## Como acrescentar um vídeo

Grave o vídeo, publique-o no SharePoint ou no Microsoft Stream da empresa e cole o link
compartilhado no espaço correspondente de `ONBOARDING_VIDEO_URLS` (`purpose`, `process` ou a chave
da tela). Só links HTTPS desses domínios são aceitos; o teste falha com outro endereço. Vídeos não
entram no repositório.

## Como manter o guia em dia

- Tela nova no menu que faça parte do dia a dia: acrescente-a a `ONBOARDING_SCREENS` com a mesma
  chave e o mesmo endereço do item do menu, as etapas que ela acompanha, o desenho e um ponto por
  passo, e os textos nos três dicionários. O teste confere chave, endereço e número de passos.
- Prazo de etapa muda só em `lib/e2e-flow.ts`; os textos do guia não citam prazos em dias.

## Fora do escopo

Tour sobreposto às telas reais, guia obrigatório no primeiro acesso, conteúdo por papel e controle
de conclusão no banco.
