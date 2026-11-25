# Prompt: onboarding de Cadastros e NCM

Cole o texto abaixo numa sessão nova do Claude Code, na raiz do repositório, na branch `homologacao`.

---

Leia o `AGENTS.md` inteiro antes de começar e siga o fluxo dele: especificação curta aprovada, testes
primeiro, commits pequenos na `homologacao`, push para `production` e validação do Preview.

## Contexto

O guia de primeiros passos (`/onboarding`) já existe e está publicado na homologação. Leia
`docs/PLANO_ONBOARDING.md` e a seção "Guia de primeiros passos" do `AGENTS.md`. Resumo do que já existe
e deve ser reaproveitado, sem duplicar:

- Capítulos em `ONBOARDING_CHAPTERS` (`apps/web/lib/onboarding.ts`): Para que serve, O processo de
  importação, As telas no dia a dia. O progresso (capítulo aberto e vistos) fica no navegador.
- Passo a passo sobre prints do HML: `components/OnboardingWalkthrough.tsx`, usado pelos capítulos 2 e 3.
  Cada passo é `{ shot, box }`: o print em `public/onboarding/<nome>.png`, com o tamanho em
  `ONBOARDING_SHOT_SIZES`, e a área destacada em porcentagem da imagem. O destaque ilumina a área,
  escurece o resto, pulsa e desliza entre passos; o print troca com fade.
- Botão "Como usar esta tela" no `PageHeader` (`components/ScreenHelpLink.tsx`): a tela é achada pelo
  endereço em `onboardingScreenForPath` e abre `/onboarding?tela=<chave>`. Hoje as telas de
  `/catalog` não têm passo a passo e não mostram o botão.
- Espaço para vídeo por link (`ONBOARDING_VIDEO_URLS`, só SharePoint ou Stream).
- Textos nos três dicionários (`onboarding` em `lib/i18n/pt-BR.ts`, `en.ts`, `zh-CN.ts`); os textos do
  guia não citam prazos em dias; `test/onboarding.test.mjs` cobre tudo isso.

## Objetivo

Criar o onboarding da área de **Cadastros**, com duas partes:

1. **Cadastros e valores das entidades**, o foco principal: o que cada cadastro é, de onde vem, quem
   pode alterar, onde ele aparece no resto da plataforma (PO, IP, invoice, indicadores) e o que acontece
   quando ele está errado ou faltando.
2. **NCM**, uma parte só para elas: tudo o que a plataforma faz com NCM.

## O que existe hoje (confira no código e no HML antes de escrever qualquer texto)

Não descreva comportamento só pela memória ou por este prompt: leia o componente, a rota da API e o
documento de cada item, e confira no banco HML o que for dado (quantidades, quais entidades estão
preenchidas). Na dúvida sobre uma regra, pergunte.

**Cadastros (`/catalog`, `app/catalog/page.tsx`)**
- Lista de cadastros por tipo (Produtos e NCM), com pesquisa, situação, vigência, versão, histórico
  auditado (antes e depois) e histórico de preços do produto; edição e inativação com evidência.
- Atalhos: Cadastrar PO do TOTVS, Cadastrar IP, Valores das entidades, Alíquotas por NCM e Cargas de
  referência (esta só para Master e Administrador).

**Valores das entidades (`/catalog/values`, `app/catalog/values/page.tsx`)**
- 25 entidades (lista `entities` no topo do arquivo; nomes em `entityValues.entities`): importadora,
  incoterm, modal, POL, POD, moeda, categoria, grupo de produto, group, finalidade, demanda, tipo de
  demanda (MTS), status logístico, canal aduaneiro, tipo de container, prioridade, unidade de medida,
  produto, NCM, solicitante, analista, centro de custo, despachante, agente de carga e fornecedor.
- Importadora com CNPJ, Import Cons e nome curto. O vínculo importadora → UF do ICMS compara o nome.
- Fornecedor com código `EX`, nome e apelidos do Exporter da invoice (`SupplierExporterAliases`,
  M074): quem edita, regra de ao menos 8 letras ou números, remoção que mantém o registro.
- Produto, inclusive a carga por JSON (`lib/catalog-products-json.ts`).
- Candidatos de origem (valores achados na planilha) e "Preparar revisão".
- Regras do `AGENTS.md` que o usuário precisa entender pela tela:
  - fornecedor da PO vem da SC;
  - tipo de demanda é da PO, não do produto;
  - unidades equivalentes na invoice;
  - a invoice só preenche no produto o que estiver vazio.

**Cargas de referência (`/catalog/reference-loads`, `components/ReferenceLoadsPanel.tsx`, M082)**
- DATABASE de produtos e lista de fabricantes: prévia do que muda antes de gravar, o que cada carga
  atualiza no cadastro (produtos: descrição e NCM; fornecedores `EX`: endereço e país, sem trocar o nome)
  e por que a auditoria de invoice lê a última carga, não o cadastro.

**NCM, a parte própria**
- NCM cadastrada × catálogo oficial: busca oficial (Siscomex e MDIC/Gecex), inclusão individual,
  descrição e vigências, atributos obrigatórios e condicionais para importação (forma de preenchimento,
  ato legal, condições; textos em `ncm` nos dicionários).
- Sincronização automática (06:00 e 12:00 no HML): atualiza só as NCMs já cadastradas, com auditoria;
  o que acontece quando o Siscomex limita acessos (503 com horário para tentar de novo). Veja a seção
  "Retomada da carga oficial de NCM" do `AGENTS.md`.
- Tratamentos tributários por NCM (`app/catalog/values/NcmTaxTreatments.tsx`, TTCE,
  `docs/TRATAMENTO_TRIBUTARIO_NCM_E_DESPACHO.md`).
- Alíquotas por NCM (`/catalog/ncm-rates`, `NcmRateDetail`, `docs/PLANO_ALIQUOTAS_NCM.md`):
  - II aplicado e exceções;
  - Ex, cota e conflitos como condicionais;
  - IPI `NT`, que não é 0%;
  - PIS/COFINS pela regra geral mais as exceções do fiscal;
  - quem edita (`tax-rates.manage`).
- ICMS de importação (`IcmsRatesPanel`, `docs/PLANO_ICMS_IMPORTACAO.md`): só CE, AM e PR, mantido por
  Master e Administrador, valores "não revisados" até o tributário conferir.
- Simulador de tributos da importação (`import-estimate`): estimativa, não imposto devido; sem alíquota
  vigente a estimativa sai incompleta.
- Onde a NCM aparece no resto da plataforma:
  - auditoria de invoice (DATABASE manda no NCM; NCM fora da DATABASE pede motivo);
  - qualidade dos dados ("Item sem NCM", "NCM não cadastrada");
  - produto da PO.

## Como estruturar (proponha e espere aprovação)

Proponha na especificação a estrutura que achar melhor. Sugestão de partida:

- Capítulo 4 **Cadastros**: uma visão geral de "o que é cadastro, quem mantém e onde aparece", depois um
  passo a passo por tela (Cadastros, Valores das entidades, Cargas de referência) e uma tabela de
  referência das 25 entidades, cada uma com o que significa, de onde vem, quem pode alterar e onde é
  usada.
- Capítulo 5 **NCM**: o ciclo da NCM (busca oficial → cadastro → atributos → sincronização →
  alíquotas e ICMS → simulador → uso na invoice e na qualidade), em passo a passo sobre os prints.
- "Como usar esta tela" também nas telas de `/catalog`, levando à parte certa do guia. Hoje
  `?tela=` só aceita as telas do capítulo 3: decida, na especificação, como o endereço aponta para os
  capítulos novos sem quebrar os links atuais.
- Perguntas frequentes curtas onde a regra surpreende, por exemplo:
  - "Por que troquei o fornecedor da PO e nada mudou?"
  - "Por que a NCM do produto mudou sozinha?"
  - "Por que o IPI aparece como NT?"

## Primeira entrega da sessão: a lista de prints

Antes de escrever código, passe ao usuário a lista de prints necessários, no mesmo formato da vez
anterior:

- **Formato:** tema escuro ou claro, mas o mesmo em todos; pt-BR; recorte sem o menu lateral.
- **Organização:** nome do arquivo sugerido, tela ou endereço e o estado que deve aparecer em cada um.
- **Telas a cobrir:**
  - Cadastros com a lista e um histórico aberto;
  - Valores das entidades com uma entidade simples, uma importadora, um fornecedor com apelidos e um
    produto;
  - NCM: busca oficial, NCM com atributos, sincronização, tratamentos tributários, alíquotas de uma NCM,
    ICMS e simulador;
  - Cargas de referência com a prévia.
- **Dados sensíveis:** avise que aparecem CNPJ, nomes de fornecedores e de pessoas, e combine com o
  usuário o que borrar.

Espere os prints. Quando chegarem:

- Veja cada um antes de usar. Prints repetidos (mesmo SHA-256) entram uma vez só.
- Recorte e salve em `public/onboarding/`. O Pillow pode ser instalado se ajudar; o System.Drawing do
  Windows também serve.
- Desenhe as áreas de cada passo sobre o print num arquivo de conferência antes de gravar as
  porcentagens.
- Adapte os textos ao que os prints mostram.

## Regras e cuidados

- Nada de API, migration ou banco nesta tarefa, a não ser que a especificação aprovada peça. Consultas
  ao HML são só leitura e no banco `erp_po_totvs_hml`.
- Valores trocados com a API (papéis, status) continuam em português; a exibição é traduzida.
- Textos nos três dicionários. Sem prazo em dias nos textos do guia. Sem cor literal fora de
  `tokens.css`. Use o `Tooltip` padrão, nunca o atributo `title`.
- A alíquota de referência não é imposto devido: o guia não pode sugerir isso.
- Estenda `test/onboarding.test.mjs`:
  - telas e capítulos novos;
  - prints existentes com o tamanho declarado e nenhum sem uso;
  - áreas dentro do print;
  - número de passos igual nos três idiomas;
  - endereços de `/catalog` levando à parte certa;
  - entidades da tabela de referência iguais à lista `entities` de `app/catalog/values/page.tsx`, para
    a tabela não ficar desatualizada quando uma entidade entrar ou sair.
- Atualize `docs/PLANO_ONBOARDING.md` e a seção do guia no `AGENTS.md`.

## Critérios de aceite

- Capítulos (ou partes) de Cadastros e NCM no guia, nos três idiomas, com passo a passo sobre os prints.
- Tabela de referência das 25 entidades, conferida com o código e o HML.
- "Como usar esta tela" nas telas de `/catalog`, abrindo a parte certa.
- Testes, lint, type-check e build passando; Preview `Ready` na `homologacao`; resumo final com o que
  mudou, como verificar e o que ficou de fora.

## Fora do escopo

- Mudanças no comportamento dos cadastros, das alíquotas ou da sincronização de NCM.
- Gravar vídeos.
- Controle de conclusão do guia no banco.
