# Tarefa: Auditoria da invoice dentro da criação do IP, com confirmação da distribuição

| Item | Valor |
|---|---|
| Data | 2026-11-12 |
| Branch de trabalho | `homologacao` |
| Status | Especificação aprovada em 2026-11-12; etapa 0 (recarga do HML) feita em 2026-11-12; fase A (etapas 1 a 5, sem a confirmação) publicada no Preview em 2026-11-12; fase B1 (campos do IP e revisão do IP sem `IPH`) aprovada em 2026-11-12; fase B2 (gravação da invoice auditada) publicada no HML e no Preview em 2026-11-13 (`000f84e`) |

## Contexto

Duas telas leem a mesma invoice HEXING (abas INV e PKL):

- **Auditoria de invoice** (`/invoices/audit`, `components/InvoiceAuditWorkbench.tsx`): confere o conteúdo e o caminho da invoice
  contra o Follow Up enviado no ato, a DATABASE e a lista de fabricantes, e devolve a invoice corrigida com a aba `AUDITORIA`.
  Não grava nada. Regras em `docs/PLANO_AUDITORIA_INVOICE_AVULSA.md` (etapas 1 a 1i).
- **Criação do IP pela invoice** (`components/NewOperationalRecord.tsx`, `POST /api/v1/processes/import-invoice`): distribui as
  linhas pelos saldos das POs do sistema e grava o IP. Tem só parte das regras da auditoria: não lê a DATABASE nem a lista, não
  corrige preço nem pesos, e uma célula PO ilegível bloqueia a invoice inteira.

Conferência de 2026-11-12: o leitor da tela de IP já lê as invoices auditadas pela página (IPH034B, 037A, 037C e a 037D com a célula
dividida), sem problema de linha. A versão da 037D gerada antes da etapa 1i ainda tem a célula `PO 030888&030201` e bloqueia a
invoice.

## Decisões do usuário (2026-11-12)

1. A auditoria (conteúdo e caminho da invoice) e a criação do IP (distribuição dos saldos e gravação) são etapas separadas.
2. Quando a plataforma estiver em produção, o upload do Follow Up cai em desuso: a plataforma é o novo Follow Up. Até lá ficam as
   duas fontes de auditoria: pelas POs da plataforma (banco HML) e pelo Follow Up enviado no ato.
3. A auditoria pelas POs da plataforma é uma subseção da tela "Criar IP pela invoice", que continua existindo sempre. A página
   `/invoices/audit` fica só com o Follow Up e só para auditoria: ela nunca distribui saldo nem grava.
4. Na subseção, a auditoria serve de carga dos saldos no IP: o analista audita, baixa a invoice auditada, confere o arquivo, e a
   tela aguarda a confirmação da distribuição.
5. O IP grava a invoice auditada, com o SHA-256 do arquivo original e o do auditado e todas as decisões com motivo.
6. Master, Administrador e Importação confirmam a distribuição. Compras entra na tela, audita e baixa, sem confirmar.
7. "Completar o cadastro do produto" continua só preenchendo campos vazios, nunca a descrição, agora com os valores auditados; um NCM
   sinalizado como não encontrado na DATABASE não vai para o cadastro.
8. O HML é recarregado com o Follow Up e o MRP atualizados, sem os dados de teste, para testes reais com invoices reais. A limpeza
   apaga todas as POs, IPs e SCs do HML e mantém os cadastros.

## Requisitos

- **R0 Carga do HML:** backup; carregador `deploy/hostinger/import-follow-up-workbook.py` com `--wipe-simulation` e o Follow Up
  atualizado; ensaio com ROLLBACK e relatório para aprovação; gravação; `verify-follow-up-load.mjs` e `accept-follow-up-load.mjs`;
  T0 recarregado com o MRP atualizado (`import-commercial-plan-dates.py`, `verify-commercial-plan-dates.mjs`).
- **R1 Peças comuns**, extraídas de `InvoiceAuditWorkbench`: a montagem das regras em `lib/china-invoice-mapping.ts`, com os
  candidatos vindos do Follow Up ou da API; `CatalogAudit`, o painel da célula PO, o ponto de preço, os grupos das decisões em massa
  e a aba `AUDITORIA`. A página de auditoria passa a usá-las sem mudar de comportamento.
- **R2 Subseção "Auditoria da invoice"** na tela de IP, na criação e na revisão de IP:
  - referência da última carga (DATABASE e lista de fabricantes);
  - NCM e descrição pela DATABASE; NCM não encontrada mantida com motivo ou sinalizada;
  - fabricante, endereço e país pela lista; país de origem do cabeçalho;
  - preço aceito ou corrigido para o preço da PO; INV × PKL mantendo a INV ou usando a PKL;
  - destino PO + código, com o botão "Destinar 0 a esta PO";
  - célula ilegível dividida pelo saldo do sistema, como ponto pendente, sem bloquear a invoice inteira;
  - PO sugerida pelo saldo do sistema (rota nova `POST /api/v1/purchase-orders/invoice-candidates/by-product`);
  - uma confirmação por fornecedor do Exporter; unidade (só no IP, porque o Follow Up não tem unidade);
  - decisões em massa no topo.
- **R3 "Baixar invoice auditada":** o mesmo arquivo da página de auditoria, com a fonte "POs da plataforma" na aba `AUDITORIA`.
- **R4 "Confirmar distribuição":** habilitado só depois do download do estado atual; qualquer decisão alterada depois exige baixar
  de novo. Só Master, Administrador e Importação.
- **R5 Gravação da invoice auditada:** linhas como no arquivo baixado (NCM, descrição, fabricante, célula PO, quantidade, preço,
  pesos e totais); `fileSha256` continua sendo o do arquivo original (a busca de invoice duplicada usa esse SHA);
  `auditedFileSha256` é o do auditado; `metadata.audit` guarda as cargas usadas, o valor original de cada campo alterado, as
  decisões e os motivos; a auditoria do IP registra as decisões.
- **R6 A API confere de novo, sem confiar na tela:** cada campo alterado tem decisão e valor original; NCM, descrição e fabricante
  batem com as linhas da M082 das cargas citadas, e elas são as últimas (senão 409); preço corrigido igual ao único preço CNY das POs
  que recebem a linha; POs da célula dividida vindas da célula original; PO sugerida registrada de → para; continuam as conferências
  de saldo, PO + código, unidade e fornecedor. Os espelhos das regras na API têm teste que os compara com a web.
- **R7 Cadastro do produto:** decisão 7.
- **R8** Textos nos três idiomas, regras de layout e componentes padrão.

## Restrições

- A invoice nunca altera o item da PO. A página com o Follow Up nunca grava.
- Módulos de `lib/` sem import de valores entre si; schemas `.strict()`; campo novo entra na API e na web no mesmo commit; a API
  sobe antes da web.
- Só HML: ensaio com ROLLBACK (`rehearse-invoice-save.mjs`) antes de cada release da API.
- Os testes atuais da auditoria continuam passando sem mudança.
- Até a etapa 6 a gravação continua como hoje; a troca para a invoice auditada acontece numa etapa só, para o Preview nunca gravar
  algo diferente do que mostra.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | HML recarregado: conciliação com o relatório da carga; sem POs, IPs e SCs de teste; T0 conferido | verify/accept no HML |
| 2 | Com os mesmos candidatos, a subseção e a página de auditoria chegam às mesmas decisões e ao mesmo arquivo nas IPH034B, 037A, 037C e 037D | web (arquivos reais; pulados sem eles) |
| 3 | Rota by-product: saldo, ordem, importadora, IP em revisão excluído | API + ensaio HML |
| 4 | Célula ilegível vira ponto pendente; divisão pelo saldo; destino 0 com motivo | web + API |
| 5 | Confirmar só depois do download do estado atual; Compras sem confirmar | web |
| 6 | A API recusa campo alterado sem decisão, valor fora da carga, carga desatualizada, preço corrigido diferente do da PO e PO que não estava na célula | API |
| 7 | Espelhos da API iguais à web; payload aceito pelos schemas `.strict()` | API |
| 8 | Gravação real de uma invoice real no HML, primeiro com ROLLBACK e depois pela tela no Preview | ensaio HML + Preview |
| 9 | Montar 20 vezes a IPH034B com a referência leva menos de 2 s | web |
| 10 | Três idiomas, layout, suítes, lint, type-check e builds; API HML atualizada; Preview `Ready` | web + API + VPS |

## Fora do escopo

Gravar a partir da página com o Follow Up; mudar as cargas de referência; produção e `main`.

## Plano

0. Carga do HML com o Follow Up e o MRP atualizados. **Feita em 2026-11-12** (`docs/PLANO_CARGA_HISTORICA_PLANILHA.md`, "Recarga de 2026-11-12").
1. Extrair as peças comuns e ligar os arquivos reais nos testes.
2. Subseção, parte de conteúdo: DATABASE, NCM não encontrada e fabricantes (web).
3. Subseção, parte de caminho: preço, INV × PKL, destino 0, célula ilegível, PO sugerida (rota e API), fornecedor.
4. Decisões em massa.
5. Download e confirmação condicionada ao download.
6. Gravação da invoice auditada: API, espelhos, ensaio no HML, release na VPS e troca na web.
7. Teste real com invoices reais no HML; atualizar `AGENTS.md` e este plano.

## Arquivos de teste (fora do Git, em `invoices_tests/`)

Os testes com arquivos reais são pulados quando os arquivos não existem; em 2026-11-12 a pasta só tinha a DATABASE, a lista e
`reference-hml.json`. Para a etapa 0 e a paridade são necessários: o Follow Up atualizado, o `FUP POS - MRP.xlsx` atualizado e as
invoices originais e auditadas pelas analistas da IPH034B, 037A, 037C e 037D.

Situação depois da recarga (2026-11-12): há o Follow Up e o MRP atualizados, a IPH034B, 034C e 037D (original e auditada) e a
IPH037A só auditada. Faltam a IPH037A original e a IPH037C (as duas versões). Os testes com arquivos reais rodam, exceto os 6 que
dependem da IPH037A original, que continuam pulados.

## Decisões do usuário na fase A (2026-11-12)

1. **Testes de fonte da página de auditoria:** os testes que conferiam trechos do código de `InvoiceAuditWorkbench.tsx` passam a ler
   os arquivos para onde o código foi (lib/ e o componente comum), com a mesma regra e o mesmo rigor. Nenhuma verificação foi
   removida; algumas ficaram mais estritas (a revisão comum não chama a API; a página desativa os arquivos durante o download).
2. **Convivência na fase A:** a subseção de auditoria fica na tela "Criar IP pela invoice" ao lado da revisão atual, que continua
   sendo o que grava. Uma célula PO ilegível é auditável e baixável na subseção, mas continua bloqueando a gravação até a fase B.
3. **Compras:** o diretório de IPs mostra o botão "Auditar invoice" para Compras, que abre a mesma tela só para auditar e baixar.
4. **Número do IP:** a carga do Follow Up grava os IPs da HEXING sem `IPH` (`034B/2026`). A subseção lê o saldo do IP que existe com
   ou sem `IPH` (o ativo primeiro, depois a grafia exata), como a página faz com o Follow Up. A gravação desse caso (revisar o
   `034B/2026` ou criar `IPH034B/2026`) fica para decidir na fase B.

## Resultado da fase A (2026-11-12)

| Etapa | Commit | O que mudou |
|---|---|---|
| 1 | `f40a479` | Peças comuns: `invoiceAuditModel` (montagem das regras com uma fonte de POs), `InvoiceAuditDecisions`, `invoiceAuditBulkGroups`, `invoiceAuditSheet` (aba `AUDITORIA`), `followUpAuditSource` e o componente `InvoiceAuditReview`. A página `/invoices/audit` usa as peças comuns com o mesmo resultado (revisão independente linha a linha). |
| 3 (API) | `674214c`, `b53ddcb` | Rota só leitura `POST /api/v1/purchase-orders/invoice-candidates/by-product`: itens com saldo das POs ativas da importadora para cada produto, sem o saldo do IP em revisão, na ordem POs ligadas ao IP, saldo exato, número. Release `hml-release-c1c04f6` ativo no HML (`deploy/hostinger/README.md`). |
| 2 a 5 (web) | `c1c04f6` e o commit seguinte | Subseção "Auditoria da invoice pelas POs da plataforma" (`components/InvoicePlatformAudit.tsx`): referência da última carga, candidatos pelas rotas `batch` e `by-product`, as mesmas regras, pontos, decisões em massa (com o grupo "Unidade") e arquivo da página, com a fonte "POs da plataforma (HML)" e o IP no sistema na aba `AUDITORIA`. Compras só audita e baixa. A subseção não grava nada, e seus motivos e o Enter nos seus campos não interferem na gravação do IP. |

Pedido do usuário (2026-11-12, depois da entrega): PO citada que não existe na importadora escolhida, mas existe em outra que o
usuário enxerga (`otherImporters` da rota `batch`), diz em qual importadora está cadastrada e oferece "Trocar a importadora para
…", o mesmo campo Importadora da tela; a subseção recomeça com as POs dessa importadora (as decisões tomadas se perdem). Sem
importadora visível, continua "PO não cadastrada nesta importadora", com as sugestões de outra PO.

A gravação do IP não mudou (`POST /api/v1/processes/import-invoice`, payload e bloqueios iguais). Montar 20 vezes a IPH034B com a
referência leva cerca de 160 ms (critério: menos de 2 s).

## Avaliação com invoices reais contra o HML (2026-11-12, só leitura)

Método: as rotas `batch` e `by-product` do `dist` do release foram executadas contra o HML em transações `READ ONLY`
(`deploy/hostinger/rehearse-invoice-candidates.mjs`, contagens iguais antes e depois). As respostas alimentaram, no repositório, a
montagem da subseção; o resultado foi comparado com a página de auditoria (Follow Up `Follow Up Import 2026 (4).xlsx`) e com o
arquivo da analista, célula a célula nas colunas de dados da INV e da PKL. As decisões imitaram a analista: 1ª PO sugerida quando
a citada não recebe a linha, divisão da célula ilegível pelo saldo, preço da invoice aceito, INV mantida nos pesos, fornecedor e
unidade confirmados, NCM não encontrada mantida, fabricante parecido escolhido, país da invoice mantido. A IPH037A entrou pelo
arquivo da analista (o original falta): a comparação mostra o que o sistema ainda alteraria nele.

| Invoice | Pontos sem decisão: página (Follow Up) / subseção (HML) | Alterações da analista reproduzidas | Alterações a mais | Arquivo da subseção = arquivo da página |
|---|---|---|---|---|
| IPH034B (91 linhas) | 58 / 57 | 195 de 196 (99,5%) | 0 | sim |
| IPH034C (13 linhas) | 4 / 3 | 5 de 6 (83,3%) | 26 | sim |
| IPH037D (11 linhas) | 10 / 9 | 9 de 9 (100%) | 0 | sim |
| IPH037A (arquivo da analista, 62 linhas) | 18 / 17 | — | 1 | sim |

Pontos de cada invoice (iguais nas duas fontes, exceto o fornecedor, que a plataforma reconhece pelo apelido do Exporter):
- **IPH034B:** linha 92 sem saldo na PO 029720, com a sugestão 030631 (no IP 034B/2026) e 031178; 55 pontos de preço, todos
  corrigíveis e dentro dos 20% (maior 1,18%); DATABASE com 10 NCMs e 83 descrições corrigidas (82 só de caixa e acentos);
  fabricantes 88 pelo endereço, 2 pelo nome e 1 fora da lista (linha 54, parecidos EX000639 e EX000693).
- **IPH034C:** 3 pontos de preço (até 0,0005%); 3 NCMs e 12 descrições corrigidas.
- **IPH037D:** linha 20 com a célula `PO 030888&030201`, proposta 20 + 60, igual à analista; 8 NCMs não encontradas na DATABASE
  (linhas 16 a 23); 2 NCMs e 2 descrições corrigidas.
- **IPH037A:** 12 pontos de preço; 4 NCMs não encontradas (linhas 28, 34, 36 e 37); país da linha 27 anotado pela analista.

Diferenças e classificação:

| Invoice | Célula(s) | Diferença | Tipo |
|---|---|---|---|
| IPH034B | N92 | Mesma PO; o sistema escreve `PO030631` (grafia da invoice), a analista `PO 030631` | regra já aceita (etapa 1e) |
| IPH034C | D16–D28, B21 e as mesmas na PKL (26) | O sistema aplica a DATABASE atual; nesta invoice a analista usou outra base (`Foreign Trade - Products database - Single list.xlsx`, vínculo do XLOOKUP dela), com NCM 73181500 e as descrições da invoice | dado |
| IPH034C | E23 | Nome do fabricante com um caractere invisível (U+200C) e uma vírgula chinesa; a analista trocou pelo nome da lista (EX000583), o sistema mantém porque o nome só muda quando as letras e os dígitos diferem | regra: dúvida 1 |
| IPH037A | K12 | O país de origem do cabeçalho recebe `TAIWAN OR CHINA?`, a anotação da analista na linha 27 | dado (arquivo já anotado) |
| Todas | IP | Com o número da invoice (`IPH…`), o próprio IP consome o saldo: na IPH034B as 91 partes ficam sem saldo e a 1ª sugestão troca a PO certa em 29 linhas; na IPH037D a divisão vira 0 + 80 | regra corrigida pela decisão 4 acima |

Tempos no HML: `batch` e `by-product` de 19 a 445 ms por invoice (a primeira chamada fria, 1,1 s); heap até 33 MB. Montagem
da subseção: 9 a 81 ms.

### Dúvidas para o usuário

1. **Nome de fabricante com caracteres invisíveis** (IPH034C, linha 23): trocar o nome da invoice pelo da lista quando a diferença
   é só de caracteres invisíveis ou pontuação de outro alfabeto? Hoje a regra (etapa 1c) só troca quando as letras e os dígitos
   diferem.
2. **Pontos de preço muito pequenos:** toda diferença acima de 0,00000001 CNY pede decisão (decisão de 2026-11-10); na IPH034B são
   55 pontos, 45 abaixo de 0,1%. A ação em massa resolve, mas o analista pode querer que diferenças só de arredondamento (preço da
   invoice igual ao da PO nas casas da PO) não gerem ponto.
3. **Gravação do IP com o número sem `IPH`** (fase B): revisar o IP existente `034B/2026` ou criar `IPH034B/2026`? Respondida em
   2026-11-12: revisar o existente e manter o número (fase B1).
4. **"(HML)" na aba `AUDITORIA`:** o texto é fixo; antes da produção ele precisa citar o ambiente certo.

## Teste do usuário com a IPH037D (2026-11-12)

O usuário criou o IP pela invoice auditada da IPH037D (célula da linha 20 dividida pela auditoria e baixada) depois de cancelar no
Preview o `037D/2026` da carga do Follow Up, com as POs ociosas. Cópia anterior ao cancelamento:
`/var/backups/import-erp/hml-ip-037D-pre-cancel-20261112T183050Z.json` (IP, alocações, documentos e vínculos). Comparação só leitura
no HML: as 12 alocações (49.740 unidades) e as 5 POs do `IPH037D/2026` são iguais às do `037D/2026`; a invoice ficou com moeda,
data, SHA-256, linhas e decisões. Diferenças no IP: status logístico, modal e prioridade vazios, e os portos com o texto da invoice
(`NINGBO,CHINA`, `PECEM,BRASIL`) no lugar dos códigos do Follow Up (`NGB`, `PEC`). O status vazio é a regra de `af2f77b`
(2026-10-22): o status exibido é calculado pelas datas do IP, e o "WAITING SHIPMENT" só leitura da tela é esse cálculo.

# Fase B1: campos do IP e revisão do IP do Follow Up pela invoice

## Objetivo

Na criação ou revisão do IP pela invoice, a pessoa escolhe modal e portos nas listas do cadastro, e uma invoice `IPH037D/2026`
revisa o IP `037D/2026` da carga do Follow Up em vez de criar outro.

## Decisões do usuário (2026-11-12)

1. A criação pela invoice deixa escolher o status logístico. **Revista em 2026-11-12:** o status exibido em toda a plataforma é
   calculado pelas datas do IP (`af2f77b`; o informado só prevalece quando é cancelamento); o usuário decidiu **manter o cálculo**,
   e a invoice continua sem gravar status.
2. Os portos são gravados com os códigos do cadastro, traduzidos do texto da invoice.
3. O modal é pedido na tela.
4. O IP revisado mantém o número sem `IPH`; o IP REF da invoice fica no documento (`ipNumberFromInvoice`).
5. Xangai sugere o código mais usado no HML, `SGH` (24 IPs; `SH` 7, `SHG` 5, `SHA` 4).

## Requisitos

1. **Status logístico:** sem mudança (decisão 1: manter o cálculo); a invoice continua mandando o status vazio e a revisão não o
   altera.
2. **Modal:** lista `TRANSPORT_MODE`, obrigatório; na revisão vem o modal do IP, na criação começa sem escolha.
3. **Portos:** listas `PORT_LOADING` e `PORT_DISCHARGE`, opcionais, com sugestão pelo texto da invoice: Ningbo → `NGB`, Shanghai →
   `SGH`, Shekou → `SHEKOU (CHINA)`, Hong Kong → `HKG`, Hangzhou → `HGH`; Pecém → `PEC`, Fortaleza → `FOR`, Paranaguá → `PNG`,
   Santos → `SSZ`, Viracopos → `VCP`. Sem correspondência, a pessoa escolhe; na revisão vêm os portos do IP. O texto da invoice
   continua no documento (`originText`, `destinationText`).
4. **IP sem `IPH`:** a invoice `IPH037D/2026` revisa o `037D/2026` quando não há IP com o número exato que possa ser revisado
   (ativo ou rascunho) e o `037D/2026` está ativo ou em rascunho na mesma importadora. Tela e API usam a mesma regra
   (`invoiceSaveIpNumber` na web, `apps/api/src/invoice-ip-number.ts` na API, com teste de paridade), inclusive na revisão aberta
   pelo IP e na busca de invoice duplicada.
5. **API:** recusa modal ou porto fora das listas (`INVALID_INVOICE_PROCESS_FIELDS`) e número de IP diferente do que a regra 4
   escolhe (`INVOICE_IP_REFERENCE_MISMATCH`). Na revisão grava os campos escolhidos em vez do texto da invoice.
6. `GET /api/v1/processes/:id` devolve modal e portos para a tela preencher a revisão.

## Restrições

Valores do cadastro trocados com a API como estão; rótulos nos três idiomas; schema `.strict()` mudado na API e na web no mesmo
commit; a API sobe antes da web; ensaio da revisão de um IP do Follow Up no HML com ROLLBACK antes do release.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Criação grava modal e portos escolhidos | API + web |
| 2 | A sugestão de portos dá `NGB`/`PEC` na 037D e vazio no que não reconhece | web |
| 3 | Na revisão, os campos vêm do IP e não são trocados pelo texto da invoice | API + web |
| 4 | `IPH034C/2026` revisa o `034C/2026` do HML, mantendo o número | API + ensaio HML com ROLLBACK |
| 5 | A API recusa valor fora das listas e número sem `IPH` fora da regra; espelho igual à web | API |

Testes alterados com a regra: em `apps/api/test/operations.test.mjs` os payloads de invoice levam modal e portos (campos novos
obrigatórios do contrato), e a revisão confere também modal e portos; em `apps/web/test/invoice-review-layout.test.mjs` a revisão
aberta pelo IP aceita o número com `IPH` do IP do Follow Up. Nenhuma verificação anterior foi removida.
| 6 | Três idiomas, suítes, lint, type-check e builds; API HML atualizada; Preview `Ready` | geral |

## Fora do escopo

Gravar a invoice auditada (fase B2, etapa 6 acima); prioridade ("Normal" continua vazia); limpar códigos duplicados do cadastro;
produção.

## Plano

1. Testes da regra de portos e do número sem `IPH` (web e API).
2. API: schema, conferência nas listas, regra do número, gravação dos campos, detalhe do IP; ensaio no HML; release.
3. Web: campos, sugestões, revisão do IP sem `IPH`; Preview e teste com a 034C.

## Resultado da fase B1 (2026-11-12)

| Etapa | Commit | O que mudou |
|---|---|---|
| 1 a 3 | `9e3a9a4` | API: `transportMode` obrigatório e portos opcionais no `process` da invoice, conferidos nas listas; criação e revisão gravam os escolhidos; regra do número sem `IPH` (`invoice-ip-number.ts`, paridade com a web); detalhe do IP com modal e portos. Web: campos Modal, POL e POD com sugestão pelo texto da invoice; a busca do IP, o saldo, a checagem de duplicada e a gravação usam o IP do sistema; aviso quando a invoice revisa o IP sem `IPH`. |
| Release | `4785982` (registro) | `hml-release-9e3a9a4` ativo no HML depois do ensaio com ROLLBACK da revisão do `034C/2026` pela `IPH034C` (201, mesmo IP, 13 alocações) e das recusas do `IPH034C/2026` ao lado e do modal fora da lista (`deploy/hostinger/README.md`). |

Verificação: API 72 arquivos de teste; web 483 testes (6 pulados por arquivos reais ausentes) e 1 falha anterior e alheia: `reads the
real DATABASE` lê `invoices_tests/DATABASE - Renew.xlsx`, trocada em 2026-11-12 às 11:40 por uma versão sem a aba `DATABASE`. Type-check,
lint (sem erro; avisos iguais aos de antes) e build da web passaram.

Correção depois do teste do usuário (`0d4d3a8`): a revisão do `IPH037D/2026`, criado pela invoice antes da B1, trazia os portos com o
texto da invoice (`NINGBO,CHINA`), fora das listas, e a API recusava; a tela agora só aproveita modal e portos do IP que estejam na
lista, senão sugere pelo texto (`invoiceProcessPort`).

Teste do usuário no Preview (2026-11-12, conferido só leitura no HML): nova carga da IPH037D auditada revisou o `IPH037D/2026` com SEA,
NGB, PEC e prioridade; as 12 alocações (49.740) foram refeitas iguais às do `037D/2026` original (linha 20: 20 na 030888 e 60 na
030201) e a invoice anterior ficou cancelada. O `037D/2026` continua cancelado (teste de 2026-11-12). Falta o teste de um IP do Follow
Up sem `IPH` pela tela (por exemplo a IPH034C, que deve abrir a revisão do `034C/2026` com SEA, NGB e PEC).

Decisões de 2026-11-12 no fim da B1: manter o status calculado (decisão 1) e seguir para a fase B2 (etapa 6) **numa nova sessão**,
começando pela especificação para aprovação.

# Fase B2: gravação da invoice auditada (etapa 6)

Status: especificação aprovada em 2026-11-12; implementada e no HML em 2026-11-13 (`000f84e`), aguardando o teste do usuário no Preview.

Decisões do usuário (2026-11-12):
1. Especificação aprovada como está (uma revisão só; a API recusa gravação sem `metadata.audit`; API e web sobem juntas).
2. A invoice auditada continua podendo ser baixada a qualquer momento; o download do estado atual é a condição da confirmação.
3. Dúvida 1: o nome do fabricante é trocado pelo da lista quando a diferença é só de caracteres invisíveis ou pontuação de outro
   alfabeto (etapa 6b).
4. Dúvida 2: manter um ponto para toda diferença de preço (sem mudança).
5. Dúvida 4: reexplicada ao usuário; resposta pendente (etapa 6b).

## Objetivo

O IP passa a ser gravado com a invoice auditada pela subseção "Auditoria da invoice pelas POs da plataforma", sem baixar e subir o
arquivo de novo. A subseção vira a única revisão das linhas da tela; a API confere de novo cada alteração feita pela auditoria.

## Situação atual (código lido em 2026-11-12)

- A subseção (`InvoicePlatformAudit` + `InvoiceAuditReview`) monta `invoiceAuditModel`, baixa o arquivo e só guarda `downloaded`
  (as decisões do momento do download). Não grava nada.
- A revisão de baixo (`NewOperationalRecord`) tem um segundo cruzamento das linhas (`invoiceMatches`, decisões de quantidade, INV ×
  PKL, confirmações de fornecedor, unidade e preço por linha, "Completar o cadastro"), lê o arquivo enviado sem correções e grava
  por `POST /api/v1/processes/import-invoice`. Uma célula PO ilegível é erro de linha do leitor e bloqueia a invoice antes de tudo.
- A API confere linhas, totais, PO + código, célula dividida com quantidade, saldo, unidade, preço (confirmação), fornecedor e
  CNPJ; `metadata` é livre (`z.record`), e `catalogUpdates.products` não é comparado com os valores das linhas.

## Requisitos

1. **Uma revisão só.** A tabela de linhas da revisão de baixo, seus pontos e confirmações saem da tela; a subseção é a revisão. Ficam
   na parte do IP: importadora e CNPJ divergente, invoice duplicada, IP embarcado, modal, portos, prioridade, observações, resumo por
   PO e código, antes × depois com as decisões das POs que ficam sem alocação, e "Completar o cadastro", calculados pelas alocações
   da subseção.
2. **Cabeçalho da invoice só leitura.** Número e data vêm do arquivo e o total é o da invoice auditada (a tela não grava um valor que
   o arquivo baixado não tem).
3. **Célula PO ilegível não bloqueia a leitura.** Os demais erros do leitor continuam bloqueando; a célula ilegível vira o ponto da
   subseção (dividir pelo saldo ou manter sem destino com motivo).
4. **R4 "Confirmar distribuição"** fica na subseção, só para Master, Administrador e Importação, habilitado quando não há ponto
   pendente, o arquivo baixado é do estado atual (qualquer decisão alterada depois pede novo download) e as condições do IP acima
   estão resolvidas (modal, duplicada, embarcado, CNPJ, POs sem alocação). Compras continua só auditando e baixando.
5. **Reler POs e saldos** na subseção: busca os candidatos de novo, mantém as decisões de conteúdo (DATABASE, fabricantes) e limpa
   as de caminho (`invoiceAuditPathReset`), o que pede novo download. É o caminho depois de um `PO_BALANCE_CHANGED` (409) e depois
   de cadastrar um apelido do Exporter, cujo botão passa para o aviso de fornecedor da subseção (Master, Administrador e Compras).
6. **R5 Payload** montado por uma função de `lib/china-invoice-mapping.ts` (que recebe as correções já calculadas, sem importar outro
   módulo de `lib/`), usada pela tela e pelo ensaio:
   - `metadata.lines`, totais, `invoice.amount` e `countryOfOrigin`: os valores do arquivo baixado (`invoiceLineCorrections`,
     `invoiceCorrectedTotals`, `origin.corrected`);
   - `metadata.fileSha256`: o do arquivo enviado (a busca de duplicada continua por ele);
   - `metadata.audit` (novo, `.strict()`): `auditedFileSha256` e `auditedFileName` (SHA-256 dos bytes baixados), as cargas usadas
     (`productDatabaseLoadId`, `manufacturerListLoadId`), as linhas e o cabeçalho originais como o leitor os devolveu, e as decisões
     por tipo, com linha, escolha e motivo: NCM não encontrada (manter ou sinalizar), fabricante (linha da lista escolhida, país da
     invoice ou da lista, fora da lista com motivo), preço (aceitar ou corrigir), INV × PKL (INV ou PKL, motivo), célula ilegível
     (dividir, com as POs e quantidades, ou manter sem destino, com motivo), PO trocada (de → para), fornecedor e unidade confirmados;
   - destinos, `lineDecisions` e confirmações por destino como hoje (`invoiceSavePayload`, `invoiceLineDecisions`).
7. **R6 A API confere de novo** (`apps/api/src/invoice-audit-check.ts`, funções puras, mais as consultas na rota):
   - `metadata.audit` obrigatório: sem ele, `INVALID_INVOICE_AUDIT` (400). As linhas originais têm as mesmas linhas, códigos,
     números e unidades das gravadas.
   - Cada campo diferente entre a linha original e a gravada precisa da sua razão, senão `INVOICE_AUDIT_CHANGE_UNJUSTIFIED` (400,
     com linha e campo):
     - NCM e descrição: em toda linha cujo produto está na DATABASE com NCM, os valores gravados são os da carga citada (a DATABASE
       manda sem pergunta); produto fora dela ou sem NCM mantém a NCM da invoice com a decisão de manter (motivo) ou sinalizar;
     - fabricante, endereço e país: iguais aos da linha da lista citada na decisão; país da lista só com a escolha "lista";
     - preço: escolha "corrigir" e igual ao único preço CNY dos itens de PO que recebem a linha (`INVOICE_AUDIT_PRICE_MISMATCH`);
     - pesos: escolha "PKL" com motivo;
     - quantidade e célula PO: coerentes com os destinos (conferências atuais); toda PO da célula gravada está na célula original
       ou é o "para" de uma troca cujo "de" está nela (`INVOICE_AUDIT_PO_NOT_IN_CELL`); a divisão de célula ilegível só usa POs
       lidas da célula original;
     - valor da linha: quantidade × preço em centavos (conferência atual); país de origem do cabeçalho: a regra de
       `invoiceOriginCountries` aplicada aos países gravados; totais: soma das linhas gravadas.
   - As cargas citadas são as últimas de cada tipo, senão `INVOICE_AUDIT_REFERENCE_OUTDATED` (409); carga nula só quando não há
     nenhuma daquele tipo.
   - A busca de invoice duplicada também encontra a invoice cujo `auditedFileSha256` é o SHA do arquivo enviado (o arquivo auditado,
     enviado depois como original, é a mesma invoice).
   - Espelhos com teste de paridade com a web: números da célula (`invoicePoCellNumbers`), grafia da célula dividida, comparação de
     NCM, países de origem e escolha do preço único CNY.
8. **R7 Cadastro do produto:** "Completar o cadastro" usa os valores auditados da linha; a API recusa atualização cujo valor não é o
   de uma linha gravada daquele produto (`INVOICE_CATALOG_UPDATE_MISMATCH`) e NCM de linha sinalizada
   (`INVOICE_FLAGGED_NCM_TO_CATALOG`); continua só preenchendo campos vazios e nunca a descrição.
9. **Auditoria do IP:** o registro do documento da invoice guarda o resumo (cargas, SHA do auditado, contagem de alterações por
   campo, decisões com motivo); o documento guarda `metadata.audit` inteiro.
10. **R8** textos nos três idiomas, layout e componentes padrão.

## Restrições

- A invoice nunca altera o item da PO; a página `/invoices/audit` continua sem gravar.
- O contrato muda na API e na web no mesmo commit; a API exige `metadata.audit`, então a web anterior é recusada: API e web sobem
  juntas (API na VPS, depois o push), como na B1, e voltam juntas.
- Ensaio com ROLLBACK no HML antes do release; só `erp_po_totvs_hml`.
- Os testes atuais da auditoria continuam passando sem mudança; os testes da revisão de baixo que saem com ela são listados no
  commit, cada um com o teste que passa a cobrir a mesma regra na subseção.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Confirmar só depois do download do estado atual; decisão alterada depois desabilita; Compras sem o botão | web |
| 2 | O payload grava as linhas do arquivo baixado: relido pelo leitor, o arquivo da subseção dá as mesmas linhas e totais do payload (IPH034B, 034C, 037D original) | web (arquivos reais) |
| 3 | A IPH037D original (célula `PO 030888&030201`) carrega, divide 20 + 60 e grava | web + ensaio HML |
| 4 | A API recusa: sem `audit`; campo alterado sem decisão; NCM ou descrição fora da carga; fabricante fora da linha citada; carga desatualizada (409); preço corrigido diferente da PO; PO fora da célula sem troca; divisão com PO fora da célula; NCM sinalizada ou valor não auditado no cadastro | API |
| 5 | Espelhos da API iguais à web; payload aceito pelos schemas `.strict()` | API (repositório) |
| 6 | Duplicada encontrada pelo SHA do auditado | API |
| 7 | Ensaio com ROLLBACK no HML: IPH034B revisando o `034B/2026` (troca de PO da linha 92, preços, DATABASE) e IPH037D original revisando o `IPH037D/2026`, mais as recusas; contagens iguais antes e depois | ensaio HML |
| 8 | Três idiomas, suítes, lint, type-check e builds; API HML atualizada; Preview `Ready`; teste do usuário | geral |

## Fora do escopo

Mudar as regras da auditoria (dúvidas 1, 2 e 4, etapa 6b se o usuário escolher mudar); gravar pela página com o Follow Up; levar a
descrição ao cadastro; produção e `main`.

## Plano

1. Testes da API (contrato `audit`, recusas, paridade) e da web (payload igual ao arquivo baixado, confirmação condicionada).
2. API: `invoice-audit-check.ts` e espelhos; integração na rota; duplicada pelo SHA do auditado.
3. Web, no mesmo commit do contrato: função do payload, confirmação e "Reler POs e saldos" na subseção, saída da revisão de baixo,
   cabeçalho só leitura, célula ilegível sem bloqueio, botão do apelido na subseção.
4. Ensaio no HML com `rehearse-invoice-save.mjs` (payload montado pelas funções da tela a partir das invoices reais e das cargas do HML).
5. Release da API (roteiro de `hml-release-9e3a9a4`), push, Preview `Ready`, teste do usuário.
6. Atualizar este plano, `AGENTS.md` e `deploy/hostinger/README.md`.

## Resultado da fase B2 (2026-11-13)

| Etapa | Commit | O que mudou |
|---|---|---|
| 1 a 3 | `000f84e` | API: `invoice-audit-check.ts` (schema `.strict()` de `metadata.audit`, conferência de cada valor alterado, espelhos com paridade), última carga ou 409, quantidades da célula dividida pela célula original, cadastro só com valores auditados e sem NCM sinalizada, duplicada também pelo SHA do arquivo auditado. Web: `invoiceAuditSavePayload` e `invoiceAuditProductFills`; a subseção entrega o arquivo baixado (com SHA-256) enquanto ele é o das decisões atuais, relê POs e saldos e oferece o apelido do Exporter; a revisão de baixo saiu; cabeçalho só leitura; célula PO ilegível sem bloqueio (`poCellIssue` no leitor); 33 textos sem uso removidos dos três dicionários. |
| 4 e 5 | `000f84e` | Ensaio com ROLLBACK e release `hml-release-000f84e` ativo (`deploy/hostinger/README.md`). |

Diferença da especificação: o botão "Confirmar distribuição" ficou no fim da tela, junto dos campos do IP (modal, portos, decisões das
POs sem alocação), e não dentro da subseção; a subseção diz, depois do download, que a distribuição é confirmada no fim da tela. A
regra (R4) é a mesma.

Testes: API 73 arquivos (o novo `invoice-audit-check` confere com as IPH034B, 034C e 037D reais que o resultado da auditoria da tela passa
na conferência da API); web 488 testes, 6 pulados por arquivos ausentes e a falha anterior e alheia `reads the real DATABASE`. Os testes
da revisão que saiu foram levados para a subseção, com a mesma regra (lista no commit). O novo `invoice-audit-save.test.mjs` relê pelo
leitor o arquivo auditado das três invoices reais e confere que o payload grava as mesmas linhas e totais; na IPH037D, a linha 20 vai
20 para a 030888 e 60 para a 030201. Type-check, lint (sem erro; avisos já existentes) e builds passaram.

Pendências com o usuário: o teste no Preview (por exemplo a IPH034B, que revisa o `034B/2026`, e a IPH037D original, sem baixar e subir de
novo); a etapa 6b (dúvida 1 aprovada; dúvida 4 em aberto); a versão certa de `invoices_tests/DATABASE - Renew.xlsx`.
