# Tarefa: Auditoria da invoice dentro da criação do IP, com confirmação da distribuição

| Item | Valor |
|---|---|
| Data | 2026-11-12 |
| Branch de trabalho | `homologacao` |
| Status | Especificação aprovada em 2026-11-12; etapa 0 (recarga do HML) feita em 2026-11-12; fase A (etapas 1 a 5, sem a confirmação) publicada no Preview em 2026-11-12, aguardando a avaliação do usuário |

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
3. **Gravação do IP com o número sem `IPH`** (fase B): revisar o IP existente `034B/2026` ou criar `IPH034B/2026`?
4. **"(HML)" na aba `AUDITORIA`:** o texto é fixo; antes da produção ele precisa citar o ambiente certo.
