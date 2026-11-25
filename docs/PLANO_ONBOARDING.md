# Tarefa: Guia de primeiros passos (onboarding)

## Objetivo

Uma tela que explica a quem chega para que serve a plataforma, como funciona o processo de
importação (T0–T5, Brasil → China → Brasil), qual tela usar em cada etapa, como funcionam os
cadastros e o que a plataforma faz com a NCM.

## Requisitos

1. Rota `/onboarding`, no grupo "Comece aqui", no topo do menu, visível a todos os papéis.
2. Capítulo 1 – Para que serve: entradas → plataforma → áreas, benefícios e glossário (SC, PO,
   produto, IP, invoice e packing list, DUIMP, MTS/Não MTS, data de necessidade).
3. Capítulo 2 – O processo: no mesmo padrão do capítulo 3 (pedido do usuário em 2026-11-25), um
   passo a passo sobre os prints do HML que percorre T0 a T5 e mostra onde cada etapa é registrada
   (`ONBOARDING_PROCESS_STEPS`). Responsável e prazo de cada etapa vêm do modelo do End to End
   (`lib/e2e-flow.ts`), e cada passo abre a tela do print. Os dois capítulos usam o mesmo
   componente, `OnboardingWalkthrough`.
4. Capítulo 3 – As telas: uma tela por vez, com resumo, "quando usar" e o passo a passo sobre prints
   do HML. Em cada passo a área do controle fica iluminada, o resto escurece, um contorno pulsa e o
   número do passo fica ao lado; o destaque desliza entre áreas do mesmo print, e o print troca com
   um fade quando o passo usa outro. A animação percorre os passos e para com movimento reduzido.
4a. Capítulo 4 – Cadastros (2026-11-25, `ONBOARDING_CATALOG_STEPS`): com um exemplo genérico, a pedido
   do usuário, porque os demais cadastros são intuitivos. O passo a passo mostra os atalhos e a lista de
   produtos de Cadastros e um campo de Valores das entidades (Importadora): escolher o campo, a lista e a
   busca, editar e excluir, e incluir um valor. O aviso diz que toda alteração fica na auditoria e quem
   mantém os valores. As perguntas frequentes trazem as regras que surpreendem: fornecedor da PO vem da
   SC, tipo de demanda é da PO, a invoice só preenche o que está vazio, unidades equivalentes, Cargas de
   referência e o vínculo importadora → UF do ICMS pelo nome. Sem tabela das 25 entidades.
4b. Capítulo 5 – NCM (2026-11-25, `ONBOARDING_NCM_STEPS`): no padrão do
   capítulo 2, um passo a passo sobre os prints do HML que percorre o ciclo da NCM. Começa nos atalhos de
   Cadastros e segue pela lista e pelo histórico, pela NCM em Valores das entidades (sincronização,
   vigência, informações exigidas, busca oficial e cadastro manual), por Alíquotas por NCM (fontes, II
   aplicado e condicionais, ICMS por UF e "não revisado") e termina na auditoria de invoice, onde a
   DATABASE manda na NCM. Cada passo abre a tela do print (`ONBOARDING_NCM_TARGETS`). Antes do passo a
   passo, um aviso diz que a alíquota é de referência e não é o imposto devido; depois dele vêm as
   perguntas frequentes (NCM do produto que mudou, IPI NT, estimativa, limite do Siscomex, qualidade
   dos dados e quem altera cada parte). Os capítulos 4 e 5 usam o mesmo componente,
   `components/OnboardingTopic.tsx`.
5. Espaço para vídeo em cada capítulo e em cada tela, aberto por link.
5a. Ajuda dentro das telas (2026-11-25): o `PageHeader` mostra "Como usar esta tela" nas telas do
   capítulo 3, inclusive nas de detalhe (PO, IP, análise por PO). O link abre
   `/onboarding?tela=<chave>`, que vai direto para o passo a passo daquela tela. A tela é descoberta
   pelo endereço (`onboardingHelpForPath`); telas sem passo a passo não mostram o link. `?tela=catalog`
   e `?tela=ncm` abrem os capítulos Cadastros e NCM. As páginas de `/catalog` abrem Cadastros, menos
   Alíquotas por NCM, que abre NCM; Cadastros e Valores das entidades passam `help="ncm"` ao
   `PageHeader` enquanto a NCM está escolhida, porque o endereço delas não diz o que a tela mostra.
6. Capítulo aberto e capítulos vistos lembrados no navegador (`localStorage`), sem gravar no banco.
7. Três idiomas, tema claro e escuro, tokens e breakpoints do projeto.

## Decisões do usuário (2026-11-25)

- Imagens: a primeira versão usava desenhos SVG esquemáticos; o usuário preferiu prints do HML, que
  ele mesmo tirou (tema escuro, pt-BR). Os prints mostram dados da homologação e ficam iguais nos três
  idiomas; os textos dos passos são traduzidos.
- Vídeos: animações na própria página e espaço para vídeo gravado pela equipe, aberto por link.
- NCM (pedido do usuário): os prints de NCM entraram primeiro, num capítulo próprio, sem nada
  borrado.
- Cadastros (pedido do usuário): um exemplo genérico só, com os prints de Importadora que ele tirou
  (mostram os CNPJs das importadoras da empresa, dado de empresa, sem borrar); sem passo a passo por
  entidade nem tabela das 25 entidades.

## Prints

- Ficam em `apps/web/public/onboarding/<nome>.png`, recortados sem o menu lateral (e sem a barra da
  Vercel e avisos do Windows). O tamanho de cada um está em `ONBOARDING_SHOT_SIZES`, e o teste confere
  que o arquivo existe com esse tamanho e que nenhum arquivo da pasta fica sem uso.
- Cada passo aponta um print e a área destacada em porcentagem da imagem (`x`, `y`, `w`, `h`). Para
  medir a área, abra o print num editor de imagem, anote os pixels do canto superior esquerdo e do
  inferior direito e divida pela largura e altura do print.
- Quando uma tela mudar, tire o print de novo, recorte do mesmo jeito, mantenha o nome do arquivo e
  confira as áreas dos passos que usam esse print.

## Onde fica

- Conteúdo que não é texto (ordem dos capítulos, etapas de cada tela, prints e áreas de cada passo e
  links dos vídeos): `apps/web/lib/onboarding.ts`.
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
  chave e o mesmo endereço do item do menu, as etapas que ela acompanha, um print e uma área por
  passo, e os textos nos três dicionários. O teste confere chave, endereço e número de passos.
- Prazo de etapa muda só em `lib/e2e-flow.ts`; os textos do guia não citam prazos em dias.

## Fora do escopo

Tour sobreposto às telas reais, guia obrigatório no primeiro acesso, conteúdo por papel e controle
de conclusão no banco.
