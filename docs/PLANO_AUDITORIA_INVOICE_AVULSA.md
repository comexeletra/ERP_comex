# Tarefa: Página avulsa de auditoria de invoice contra o Follow Up, com arquivo corrigido

| Item | Valor |
|---|---|
| Data | 2026-11-10 |
| Branch de trabalho | `homologacao` |
| Status | Etapas 1 a 1e implementadas; etapa 1f (DATABASE e fabricantes por carga) aprovada em 2026-11-11, em implementação |

## Objetivo

Demanda urgente (2026-11-10): auditar invoices de uma atividade específica com o mecanismo de auditoria da carga de invoice, sem implantar a plataforma. Decisões do usuário:

- as POs vêm do Follow Up em uso, não do banco;
- etapa 1: a página lê a planilha Follow Up atual, que o analista seleciona junto com a invoice, sem tabela nem carga;
- o resultado é o próprio arquivo da invoice corrigido com as decisões do analista, mais uma aba de auditoria.

A etapa 2 (tabela no banco com carga periódica do Follow Up) fica para depois, se fizer falta, reaproveitando o leitor desta etapa.

## Requisitos

1. **Tela "Auditoria de invoice"** em `/invoices/audit`, no TMS de homologação.
   - Fica no menu para Master, Administrador, Importação e Compras.
   - O analista seleciona dois arquivos: a invoice (`.xlsx`, INV e PKL) e o Follow Up (`.xlsx`).
   - **Tudo roda no navegador:** os arquivos não saem do computador, e a tela não chama nenhuma rota da API além da sessão.
2. **Leitor do Follow Up** (`lib/audit-reference-xlsx.ts`):
   - **Aba e cabeçalho:** aba `Pré Embarque`; o cabeçalho é localizado pelo nome das colunas (em 2026-11-10 ele está na linha 3, e as colunas mudaram de lugar desde a carga histórica).
   - **Colunas usadas:** `Status`, `Importer`, `PO Totvs`, `Supplier`, `Product Code`, `Qty`, `Unit Price`, `Currency` e `IP Number`.
   - **Cada linha** é um item de PO, na ordem da planilha.
   - **Canceladas:** linha com `Status` ou `IP Number` cancelado fica fora.
   - **Saldo:** a linha conta como saldo quando não tem IP ou quando o IP é o mesmo do `IP REF.` da invoice, como na revisão de IP da tela atual. As linhas da IPH037A no Follow Up já estão lançadas nela.
   - **Coluna faltando:** o arquivo é recusado e a mensagem diz qual coluna falta.
3. **Importadora:**
   - É a do Follow Up nas linhas das POs citadas: `ELETRA MATRIZ`, `ELETRA CWB` ou `ELETRA FOR`.
   - Se as POs aparecem em mais de uma importadora, o analista escolhe.
   - O CNPJ da invoice aparece só como referência.
4. **A mesma auditoria da carga de invoice**, com as regras de `apps/web/lib/china-invoice-mapping.ts`:
   - **Destino:** cada linha vai para a PO citada e o código do produto, preenchendo as linhas do Follow Up em ordem até o saldo.
   - **Quantidade:** a quantidade destinada é editável, inclusive com a linha dividida entre POs e com destino 0, e pede motivo quando difere da invoice.
   - **Código:** um código ausente na PO vira ponto de auditoria.
   - **Preço:** comparado com o `Unit Price` do Follow Up em CNY, com a % e a tolerância de 20%.
   - **Painel:** o "Conferência da invoice" aparece com totais, PKL e valor pela PO.
5. **Decisões que viram correção:**
   - **Preço:** em cada ponto de preço, o analista escolhe "aceitar o preço da invoice" ou "corrigir para o preço da PO".
   - **INV × PKL:** em cada divergência, escolhe "manter a INV" ou "usar a PKL", com motivo.
   - **Fornecedor:** o Follow Up traz o código do fornecedor (por exemplo `HEXING`), e o Exporter da invoice traz nome e endereço. A tela pede **uma** confirmação por fornecedor ("o Exporter corresponde ao fornecedor HEXING do Follow Up"), não uma por linha.
   - **Unidade:** o Follow Up não tem coluna de unidade, então não há conferência de unidade.
6. **Arquivo corrigido.** "Baixar invoice auditada" fica disponível só com todas as decisões tomadas e gera `<nome original> - auditada.xlsx`.
   - **Aba INV, por linha:**
     - `QTY` passa a ser a soma destinada;
     - a célula `PO` passa a ser `PO 030201` ou, numa linha dividida, `PO 030201 = 300 PCS` e `PO 030305 = 200 PCS` (formato que o parser já lê);
     - `Price (CNY)` passa a ser o preço da PO quando o analista escolhe corrigir;
     - `Net` e `Gross` passam a ser os da PKL quando o analista escolhe a PKL;
     - `Total (CNY)` é recalculado como QTY × Price.
   - **Aba INV, linha TOTAL:** recalculada.
   - **Marcação:** cada célula corrigida recebe fundo amarelo e uma nota com o valor original. Numa célula corrigida, a fórmula é trocada pelo valor.
   - **O resto:** demais células e as outras abas, inclusive a PKL, ficam como vieram.
   - **Aba nova `AUDITORIA`:**
     - invoice e Follow Up usados (nome, SHA-256), data e usuário;
     - por linha da invoice, cada ponto com o valor da invoice, o do Follow Up ou da PKL, a decisão, o motivo e as células alteradas.
7. Textos nos três dicionários; regras de layout do projeto.

## Decisões adotadas (propostas; confirmar)

1. **Linha destinada com 0** (código fora da PO ou sem embarque): a linha fica como veio, destacada, e aparece como "não destinada" na aba `AUDITORIA`, sem apagar.
2. **Peso quando a quantidade muda:** não é recalculado. Ele só muda pela escolha da PKL, e a aba `AUDITORIA` avisa que a quantidade mudou.
3. **A aba PKL** não é corrigida.

## Restrições

- Sem migration, sem mudança na API e sem gravação em banco. A tela de IP não muda de comportamento.
- As regras de auditoria são reaproveitadas de `lib/`, sem cópia.
- O arquivo é escrito com o ExcelJS que o projeto já usa. Ele preserva valores, fórmulas e a maior parte da formatação, mas pode perder imagens ou formatações raras; isso fica registrado na aba `AUDITORIA`.
- O saldo vale o que o Follow Up selecionado diz. Um arquivo desatualizado dá um saldo desatualizado.
- O Preview fica atrás da autenticação da Vercel, além do login do TMS. Cada analista precisa dos dois acessos.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Leitor do Follow Up: cabeçalho por nome, linhas canceladas fora, saldo com as linhas sem IP e as do mesmo IP, coluna ausente recusada | web (`lib/`, fixture sintético) |
| 2 | Invoice sintética com quantidade diferente, linha dividida, preço corrigido e peso pela PKL: o arquivo gerado tem as células corrigidas, as notas, a linha TOTAL recalculada e as outras abas iguais, e o parser lê o arquivo de volta sem erro | web (`lib/`) |
| 3 | Aba `AUDITORIA` com uma linha por ponto, decisão e motivo | web |
| 4 | Sem todas as decisões o download fica bloqueado; a tela não chama rotas da API | web |
| 5 | IPH037A real contra o Follow Up local: 62 destinos sem falta de saldo, arquivo gerado e lido de novo com 62 linhas | web (arquivos locais, fora do Git) |
| 6 | Textos nos três idiomas; suítes, lint, type-check e build; Preview `Ready` | web |

## Fora do escopo

Tabela e carga periódica do Follow Up (etapa 2); gravar IP ou qualquer dado; corrigir a aba PKL ou o Follow Up; recalcular pesos pela quantidade; usar a página na produção (promoção para `main` só com nova decisão); histórico das auditorias.

## Plano

1. Testes e `lib/audit-reference-xlsx.ts` (leitor do Follow Up e candidatos por PO e código).
2. Testes e `lib/invoice-correction-xlsx.ts` (aplica as decisões e escreve a aba `AUDITORIA`); decisões de preço, PKL e fornecedor em `lib/`.
3. Tela `/invoices/audit` com o parser, as regras e o `InvoiceConference`; menu e textos.
4. Verificação completa, push e Preview; ensaio com a IPH037A e o Follow Up locais.

## Resultado (etapa 1)

- **Leitor do Follow Up** em `lib/audit-reference-xlsx.ts`:
  - descompacta só a aba `Pré Embarque` e os textos compartilhados (`DecompressionStream` nativo, sem dependência nova);
  - o Follow Up local (8 MB) leva cerca de 1 a 3 s; com o ExcelJS eram 12 s e cerca de 830 MB.
- **IP no Follow Up:** o IP da HEXING aparece sem o prefixo `IPH`. `IPH034A/2026` é `034A/2026` lá, nas mesmas 196 linhas do sistema. A página trata os dois como o mesmo IP e mostra quais IPs do Follow Up considerou.
- **Correção do arquivo** em `lib/invoice-correction-xlsx.ts`:
  - as células corrigidas ficam em amarelo, com nota do valor original;
  - a linha TOTAL é recalculada e `fullCalcOnLoad` faz o Excel recalcular as fórmulas ao abrir;
  - a aba nova é `AUDITORIA` (ou `AUDITORIA 2` se já existir).
- **Decisões** em `lib/china-invoice-mapping.ts`: ponto de preço por linha (corrigível só com um preço de PO), fornecedor confirmado uma vez e escolha INV × PKL.
- **Tela:** `components/InvoiceAuditWorkbench.tsx` em `/invoices/audit`, no menu Operação. Só chama `/auth/me`.
- **Ensaio IPH037A × Follow Up local:**
  - importadora ELETRA MATRIZ;
  - nenhuma linha ainda na IPH037A;
  - 62 destinos sem falta de saldo, nenhuma diferença de preço e nenhuma divergência INV × PKL;
  - uma confirmação de fornecedor (HEXING);
  - arquivo gerado e relido com 62 linhas, sem erro e com o mesmo total.

## Etapa 1b: NCM e descrição pela DATABASE

Comparação de 2026-11-10 entre o arquivo gerado pela página e o auditado pela analista (Gabi): a analista não altera quantidade, PO, preço nem peso. Ela confere NCM, descrição e fabricante com `XLOOKUP` contra `DATABASE - Renew.xlsx` (aba `DATABASE`) e a lista de fabricantes, e troca na INV e na PKL o NCM e a descrição pelos da DATABASE. A DATABASE reproduz 100% do trabalho dela na IPH037A: 18 NCMs, 9 descrições de conteúdo diferente, 49 só de maiúsculas e acentos, e 4 códigos fora da base. As escolhas de preço do ensaio foram do usuário; o analista pode escolher diferente.

Decisões do usuário (2026-11-10):

1. A página confere NCM e descrição contra a DATABASE, selecionada pelo analista. A lista de fabricantes fica para depois, quando houver uma cópia dela.
2. ~~Cada divergência tem "manter a invoice" ou "usar a DATABASE", e um botão aplica "usar a DATABASE" a todas.~~ Revisto no mesmo dia: a DATABASE é a referência, sem questionamento. Toda divergência de NCM e descrição é corrigida pela DATABASE no arquivo, e a tela só lista as correções, numa lista recolhível. Só o produto fora da DATABASE pede decisão.
3. A correção vai para a INV e para a linha da PKL com o mesmo `No.`, marcada em amarelo com a nota do valor original.
4. Produto fora da DATABASE vira ponto de auditoria, com confirmação e motivo.

Regras:

- **Leitura da DATABASE:** aba `DATABASE`; cabeçalho localizado pelo nome (`Product Code`, `Product Description`, `NCM DATABASE`) nas 15 primeiras linhas.
- **Códigos:** o código é comparado sem diferenciar maiúsculas; um código repetido vale pela primeira linha.
- **NCM:** comparado só pelos dígitos. Um NCM numérico com menos de 8 dígitos recebe zeros à esquerda. A correção é gravada como texto.
- **Descrição:** qualquer diferença após aparar espaços é uma divergência. A tela indica quando ela é só de maiúsculas e acentos.
- **Linha não destinada:** as correções de NCM e descrição valem para ela também, porque são decisões sobre o produto, não sobre o destino.
- **Sem DATABASE:** a página continua funcionando, avisa que NCM e descrição não foram conferidos e registra isso na aba `AUDITORIA`.
- **Aba `AUDITORIA`:** uma linha por divergência e por produto fora da base, com a decisão, o motivo e as células alteradas na INV e na PKL, além do arquivo DATABASE usado (nome e SHA-256).

Critérios de aceite:

- **Leitor:** cabeçalho por nome, NCM com zeros à esquerda e coluna ausente recusada. Teste em `lib/`.
- **Regras:** IPH037A × DATABASE real com 18 NCMs, 58 descrições (49 só de caixa e acentos) e 4 códigos fora; as escolhas "usar a DATABASE" reproduzem a INV da analista nas colunas NCM e descrição. Teste com arquivos locais.
- **Arquivo:** a correção vai para a INV e para a PKL, com marcação e nota; o parser lê o arquivo de volta sem erro. Teste em `lib/`.
- **Tela:** as correções da DATABASE entram sem escolha; o download espera só a confirmação dos produtos fora da DATABASE; os textos existem nos três idiomas.

### Resultado (etapa 1b)

- **Leitor da DATABASE:** `parseProductDatabaseXlsx` em `lib/audit-reference-xlsx.ts` (antigo `follow-up-po-xlsx.ts`, renomeado porque agora lê as duas referências). Na DATABASE real: 486 produtos, sem código repetido.
- **Regras** em `lib/china-invoice-mapping.ts`: `invoiceCatalogPoints`, `invoiceCatalogReady` e `invoiceCatalogCorrections`.
- **Escrita:** NCM e descrição na INV e na PKL (`invoicePackingCorrections`), com as células alteradas por decisão na aba `AUDITORIA` (`invoiceChangedCells`).
- **Ensaio IPH037A × DATABASE (DATABASE aplicada em todas as divergências):**
  - 76 divergências (18 NCM e 58 descrições) e 4 produtos fora da base;
  - NCM e descrição na INV e na PKL idênticos aos do arquivo da analista nas 62 linhas;
  - arquivo relido sem erro.
- **O que a analista fez e a página não faz:** lista de fabricantes (`TOTVS-HEXING - LIST MANUFACTURER`), país de origem e as colunas de `XLOOKUP` (O a V) que ela acrescenta. Ficam para quando houver a lista de fabricantes.

## Etapa 1c: fabricante pela lista de fabricantes

A analista confere o fabricante com `XLOOKUP` do endereço da invoice na aba `SUPPLY` de `TOTVS-HEXING -LIST MANUFACTURER - Ultima Versão!!!.xlsx` (575 fabricantes: nome, endereço, país, código TOTVS EX…). Na IPH037A a lista reproduz o que ela fez:

- 60 linhas com o endereço idêntico;
- linha 36 com o mesmo endereço em outra formatação: ela trocou pelo texto da lista;
- linha 55 com o endereço fora da lista, achado pelo nome: ela trocou pelo endereço da lista;
- linha 27 com país Taiwan na invoice e China na lista: ela anotou `TAIWAN OR CHINA?`;
- linha 34 `Indonesia` → `INDONESIA`;
- cabeçalho `CHINA.TAIWAN` → `CHINA, TAIWAN, INDONESIA`.

Decisões do usuário (2026-11-10):

1. A lista manda no endereço (como a DATABASE no NCM e na descrição):
   - um endereço igual, só com formatação diferente, é trocado pelo texto da lista;
   - um endereço fora da lista é procurado pelo nome do fabricante e, com um só endereço cadastrado, é trocado sem pergunta;
   - com vários endereços cadastrados para o nome, o analista escolhe o endereço;
   - um fabricante fora da lista pede confirmação com motivo.
2. País do fabricante diferente da lista: o analista decide "manter a invoice" ou "usar a lista", com motivo. Diferença só de maiúsculas, acentos ou grafia (China × CHINA, EUA × USA, Japão × JAPAN) não conta.
3. O país do fabricante sai sempre em maiúsculas no arquivo.
4. O país de origem do cabeçalho (`COUNTRY OF ORIGIN:`) recebe os países de fabricante das linhas que faltam nele, separados por vírgula, mantendo os que já estão.

Regras:

- **Leitura:** aba `SUPPLY`; cabeçalho localizado pelo nome (`SUPPLY`, `MANUFACTURER'S ADDRESS`, `COUNTRY`, `TOTVS CODE`).
- **Comparação:** endereço e nome são comparados sem maiúsculas, acentos, espaços e pontuação.
- **Nome do fabricante:** só é trocado quando difere de fato do da lista, não por formatação. A analista não trocou nenhum na IPH037A.
- **Sem lista:** a página avisa e registra na aba `AUDITORIA`. A padronização em maiúsculas e o país de origem do cabeçalho valem com ou sem lista.
- **Escrita:** as correções vão na INV, com marcação e nota. A PKL não tem colunas de fabricante.

Critério de aceite: IPH037A com DATABASE e lista, mantendo a invoice no país da linha 27, reproduz o arquivo da analista em todas as células de dados, exceto a dúvida anotada em G27, o prazo de pagamento (C80, que é digitado pela analista depois) e o `#REF!` da aba `NCM (BL)`.

### Resultado (etapa 1c)

- **Leitor:** `parseManufacturerListXlsx` em `lib/audit-reference-xlsx.ts`. Na lista real: 575 fabricantes.
  - Os leitores de referência passam a trocar as quebras de linha CR LF por LF e a decodificar os escapes `_x000D_`. Sem isso, o endereço da linha 35 seria trocado só pelo tipo de quebra de linha.
- **Regras** em `lib/china-invoice-mapping.ts`: `invoiceManufacturerChecks`, `invoiceManufacturerPending`, `invoiceManufacturerCorrections`, `invoiceCountryMatches` e `invoiceOriginCountries`.
- **Tela:** seção em `components/InvoiceManufacturerAudit.tsx`.
- **Escrita:** fabricante na INV e país de origem do cabeçalho na própria célula do valor.
- **Ensaio IPH037A** com DATABASE e lista, preços da invoice aceitos e país da invoice mantido na linha 27, comparado célula a célula com o arquivo da analista:
  - 156 das 159 alterações dela reproduzidas (98,1%);
  - 156 das 157 alterações do sistema iguais às dela (99,4%);
  - as 3 que faltam são as combinadas: a dúvida anotada em G27 (`TAIWAN OR CHINA?`; o sistema grava `TAIWAN`), o prazo de pagamento em C80 (digitado pela analista depois) e o `#REF!` da aba `NCM (BL)`.

## Etapa 1d: sugestão da PO correta

Relato do usuário (2026-11-10): na IPH034B, a linha 92 (produto 2050101801, 7.500 PCS) citava a PO 029720.
- A única linha dessa PO no IP 034B tinha 80.000 PCS, já destinados à linha 91; a outra linha da PO está no IP 036/2026.
- No Follow Up, as 7.500 PCS estão na PO 030631, no mesmo IP 034B (linha 6605).
- Quem produz a invoice pode citar a PO errada, e os analistas sempre pegam esse erro. O usuário pediu que a página sugira a PO correta.

Regras:

- **Quando aparece:** a sugestão é mostrada quando a PO citada não recebe a parte da linha: PO fora do Follow Up da importadora, código fora da PO ou saldo insuficiente.
- **POs candidatas:** outras POs da mesma importadora com o mesmo código, em linhas do IP da invoice ou sem IP. Do saldo de cada uma sai o que as outras partes da invoice já tomaram. A PO só entra se o saldo cobrir a quantidade da parte.
- **Ordem:** primeiro as POs no IP da invoice, depois as de saldo exato, depois a ordem da planilha.
- **Decisão:** o analista aceita a sugestão com um clique ("Usar a PO …") e pode voltar à PO da invoice. A distribuição é refeita com a PO escolhida.
- **Escrita:** a célula PO da linha recebe o número novo na grafia da invoice (`PO029720` → `PO030631`), com a marcação amarela e a nota do valor original.
- **Registro:** a aba `AUDITORIA` registra a troca ("PO da linha": PO da invoice → PO sugerida pelo Follow Up).

### Resultado (etapa 1d)

- **Função:** `followUpPoSuggestions` em `lib/audit-reference-xlsx.ts`.
- **Escrita:** a grafia da célula PO é mantida por `invoiceLineCorrections`.
- **IPH034B real** com o Follow Up local: a linha 92 recebe a sugestão da PO 030631 (IP 034B/2026, 7.500), e a célula N92 passa a `PO030631`.

## Etapa 1e: fabricante parecido e PKL com fórmula

Comparação da IPH034B com o arquivo da analista (2026-11-11).

Resultado antes da etapa 1e:
- 102 das 103 correções de dados da analista reproduzidas. As colunas O a W (fórmulas de conferência dela) ficam fora da conta.
- **Linha 54:** a invoice escreve `Suzhou Industrial Park Kant Electronics`, e a lista tem `Kangde` (EX000639), com o endereço escrito em outra ordem. A analista reconheceu o fabricante e trocou o endereço; a página marcava "fora da lista".
- **PKL:** nesta invoice, o NCM e a descrição da PKL são fórmulas (`=INV!D16`). O sistema as trocava por valor fixo, e o vínculo com a INV se perdia.

Decisões do usuário (2026-11-11): sugerir os fabricantes parecidos e permitir digitar o fabricante para buscar na lista.

Regras:

- **Parecidos:** um fabricante fora da lista recebe até 5 entradas parecidas (`invoiceManufacturerSimilar`). A similaridade é a maior entre:
  - as palavras do nome;
  - os trigramas do nome;
  - as palavras do endereço.

  Palavras comuns (CO, LTD, CHINA, ROAD...) não contam, e o mínimo é 0,6.
- **Busca:** o analista também pode digitar parte do nome, do endereço ou do código TOTVS (`invoiceManufacturerSearch`, mínimo de 3 letras ou números, até 10 resultados).
- **Escolha:** a entrada escolhida, parecida ou buscada, corrige o endereço e mantém o nome da invoice, como a analista fez (decisão do usuário, 2026-11-11). País divergente continua sendo decidido pelo analista. Ela fica registrada na aba `AUDITORIA` como "Fabricante escolhido na lista (código)". Sem escolha, o fabricante continua sendo confirmado como fora da lista, com motivo.
- **PKL:** uma célula da PKL que é fórmula apontando para a INV mantém a fórmula, com o resultado corrigido, sem marcação.

### Resultado (etapa 1e)

Ensaio da IPH034B com a PO 030631 na linha 92 e EX000639 na linha 54:
- **Iguais:** 102 das 103 correções da analista, agora incluindo F54. A PKL não difere mais.
- **N92:** mesma PO; ela escreveu `PO 030631`, o sistema `PO030631`.
- **E54:** na primeira versão, o sistema gravava o nome da lista (`Kangde`), e a analista manteve `Kant`. Com a decisão do usuário, o nome da invoice é mantido. No novo ensaio, o sistema não faz nenhuma alteração que a analista não tenha feito.

## Etapa 1f: DATABASE e lista de fabricantes no cadastro

Pedido do usuário (2026-11-11): o analista não deve carregar quatro arquivos a cada auditoria. A DATABASE e a lista de fabricantes passam a atualizar o cadastro do sistema por carga, e a página de auditoria fica só com a invoice e o Follow Up.

### Conferência no HML (2026-11-11, só leitura, `erp_po_totvs_hml`)

- **Produtos:** 1.899 produtos globais, sem código repetido.
  - Dos 486 códigos da DATABASE, 482 existem e 4 não existem.
  - A descrição do cadastro (`catalog.entry.name`) é o mesmo texto da DATABASE: em 421 produtos só a caixa e a acentuação diferem, com acentos estragados no cadastro (`RESISTeNCIA ELeTRICA`).
  - NCM dos 482: 415 sem NCM no cadastro, 47 iguais e 20 diferentes.
  - 72 descrições têm mais de 240 caracteres; o limite do produto é 2.000 (M048).
  - 1.417 produtos estão fora da DATABASE e não são tocados.
- **NCMs:** 15 dos 99 NCMs da DATABASE não estão cadastrados como NCM.
- **Fabricantes:** o fabricante é um fornecedor do Protheus, com código `EX…`.
  - Dos 575 da lista, 558 têm código `EX`, e 540 deles já são fornecedores no cadastro.
  - 18 têm código `EX` ausente do cadastro.
  - 14 têm código provisório numérico (`2026110731`…), e 3 estão marcados `CADASTRAR`.

### Decisões do usuário (2026-11-11)

1. As planilhas são a carga que atualiza o cadastro para essas duas entidades, por "de-para" pelo código. Não haverá tabela com cópia dos dados.
2. Só Master e Administrador carregam.
3. A página de auditoria fica só com os botões da invoice e do Follow Up, sem arquivo avulso de referência.
4. Primeira carga com `DATABASE - Renew.xlsx` e `TOTVS-HEXING -LIST MANUFACTURER - Ultima Versão!!!.xlsx` (`invoices_tests/`, fora do Git).
5. Os 18 fabricantes com `EX` fora do cadastro viram fornecedores novos. As 17 linhas sem `EX` não entram no cadastro e são listadas na prévia; na auditoria elas continuam valendo (decisão 9).
6. A lista grava só endereço e país no fornecedor. O nome do fornecedor não muda, e a prévia lista os nomes diferentes.
7. A planilha manda nesses campos: uma correção manual no sistema é desfeita pela carga seguinte.
8. Os NCMs da DATABASE que não estão cadastrados são cadastrados pelo catálogo oficial, na mesma tela.
9. **Revisão (2026-11-11, na aprovação):** a auditoria da invoice vem da carga real das planilhas, guardada separadamente no banco. A mesma carga enriquece as entidades do sistema, mas a auditoria não lê o cadastro. A paridade com a auditoria das analistas tem de ser mantida.
   - **Por que importa:** no HML, 21 dos 540 fornecedores têm nome diferente do da lista. A auditoria grava o nome da lista na invoice quando ele difere, e uma referência lida do cadastro gravaria outro nome. Uma correção manual no cadastro também mudaria a auditoria.
   - **Linhas sem `EX`:** a cópia da lista guarda as 575 linhas, inclusive as 17 sem código `EX`, como a página usa hoje. Só o enriquecimento do cadastro ignora essas linhas. Tirar essas linhas não mudava nada nas IPH037A e IPH034B (0 diferenças em 62 e 91 linhas), mas guardar a lista inteira mantém o comportamento atual em qualquer invoice.

### Requisitos

1. **Migration M082 (aplicada só no HML):**
   - `catalog.reference_load`: id, tipo (`PRODUCT_DATABASE` ou `MANUFACTURER_LIST`), nome do arquivo, SHA-256, contagens e itens ignorados (`jsonb`), autor e data.
   - **Referência da auditoria, separada do cadastro:**
     - `catalog.reference_product_row`: carga, linha, código, descrição e NCM;
     - `catalog.reference_manufacturer_row`: carga, linha, nome, endereço, país e código TOTVS.

     Cada carga guarda as linhas como o leitor da planilha as devolve, e as cargas anteriores ficam guardadas.
   - Em `catalog.entry`:
     - `supplier_address` e `supplier_country`, só para `SUPPLIER`;
     - a origem `REFERENCE_LOAD` em `provenance`, para os cadastros criados pela carga.
   - Permissões para o papel da aplicação HML.
2. **Carga da DATABASE**, pelo código, sem diferenciar maiúsculas:
   - **Produto existente:** `name` passa a ser a descrição da DATABASE e `product_ncm_code` o NCM da DATABASE, com zeros à esquerda até 8 dígitos.
   - **Produto ausente:** é criado como produto global ativo.
   - **Registro:** cada campo alterado entra em `audit.audit_log`, como nas demais edições do cadastro, com a carga no motivo.
   - **Produtos fora da planilha:** não são alterados.
   - **Linha recusada:** sem código, com descrição vazia ou com NCM sem 8 dígitos. A carga não grava nada enquanto houver linha recusada, e a prévia mostra quais são.
3. **Carga da lista de fabricantes**, pelo código TOTVS:
   - **Fornecedor existente:** recebe endereço e país.
   - **Código `EX` fora do cadastro:** vira fornecedor novo, com o nome da lista.
   - **Linha sem `EX`:** fica fora, listada na prévia e registrada na carga.
   - **Nome diferente do cadastro:** aparece na prévia e não é alterado.
4. **Prévia antes de gravar:**
   - **Leitura:** o navegador lê a planilha com `parseProductDatabaseXlsx` ou `parseManufacturerListXlsx` e envia só as linhas e o SHA-256 do arquivo; a planilha não é enviada.
   - **Contagens e confirmação:** a API devolve as contagens (atualizados, criados, sem mudança, NCMs trocados, linhas ignoradas, nomes diferentes), e a pessoa confirma.
   - **Gravação:** a API recalcula tudo na gravação, sem confiar na prévia, e grava numa transação com chave de idempotência. Recarregar o mesmo arquivo não altera nada.
5. **NCMs não cadastrados:**
   - **Classificação:** a prévia da DATABASE classifica os NCMs que não estão cadastrados como "no catálogo oficial vigente", "fora do catálogo" ou "não vigente". A consulta lê só os códigos necessários de `catalog.ncm_official_item`, sem carregar o catálogo inteiro.
   - **Cadastro:** um botão cadastra os do catálogo oficial pela rota existente `POST /api/v1/ncms/import-official`, um código por vez, só para códigos encontrados no catálogo gravado. Assim a rota nunca baixa o catálogo oficial.
   - **Fora do catálogo ou não vigentes:** ficam listados para correção na DATABASE.
6. **Permissão:** nova `reference-loads.manage`, só para Master e Administrador. Os demais perfis recebem 403 nas rotas de carga.
7. **Tela "Cargas de referência"**, no menu de cadastros, só para Master e Administrador:
   - um bloco por planilha, com a última carga (arquivo, data e autor), a escolha do arquivo, a prévia e a confirmação;
   - na DATABASE, a lista de NCMs não cadastrados com o botão de cadastro.
8. **Página de auditoria:**
   - **Arquivos:** ficam só a invoice e o Follow Up.
   - **Referência:** vem de uma rota de leitura (`catalog.read`) com as linhas guardadas da última carga de cada tipo. A rota devolve o mesmo formato do leitor da planilha (`ProductDatabase` e `ManufacturerList`, com a linha de origem), sem consultar o cadastro.
   - **Regras:** as de NCM, descrição, endereço e país não mudam.
   - **Na tela e na aba `AUDITORIA`:** a versão usada (arquivo, SHA-256, data e autor da carga) no lugar do arquivo selecionado.
   - **Sem carga:** a página avisa e segue sem conferir, como hoje sem arquivo.
9. Textos nos três dicionários, regras de layout e `Tooltip` do projeto.

### Restrições

- A carga e a migration rodam só no HML. Produção, `main` e as variáveis da Vercel não são alterados.
- A invoice e o Follow Up continuam só no navegador.
- O corpo das rotas de carga fica abaixo de 1 MB (`bodyLimit`); a DATABASE real tem cerca de 150 KB de linhas.
- A carga não altera POs, IPs, itens de PO nem os campos de fabricante do produto (M060).
- Os testes da API usam banco falso. Antes da carga real, a gravação é ensaiada contra o HML com `ROLLBACK` e `SET CONSTRAINTS ALL IMMEDIATE`, com o payload montado pelas funções da tela.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Carga da DATABASE: atualiza descrição e NCM, cria produto ausente, não toca produto fora da planilha, recusa linha inválida sem gravar nada, registra cada campo no histórico e não altera nada ao repetir o arquivo | API (banco falso) + ensaio HML com ROLLBACK |
| 2 | Carga da lista: endereço e país no fornecedor pelo código, fornecedor novo para `EX` ausente, linha sem `EX` ignorada e listada, nome não alterado | API + ensaio HML |
| 3 | Master e Administrador carregam; Importação, Compras e Fiscal recebem 403 | API |
| 4 | Contrato web × API: o payload da tela passa no schema `.strict()` da API | API (importa a função da web, no repositório) |
| 5 | Prévia dos NCMs: classifica pelo catálogo gravado sem carregar o catálogo inteiro; o cadastro usa só códigos encontrados | API |
| 6 | Carga real no HML: 482 produtos atualizados e 4 criados, NCMs preenchidos e trocados conforme a prévia, 540 fornecedores atualizados e 18 criados, 17 linhas ignoradas; os 15 NCMs cadastrados ou listados com o motivo | conferência no HML depois do commit |
| 7 | Auditoria sem os botões da DATABASE e da lista, com a referência da API; a referência lida do HML depois da carga é igual, linha a linha, à leitura das planilhas; IPH037A e IPH034B reproduzem os resultados das etapas 1b a 1e com ela | web + ensaio com arquivos locais e com a referência lida do HML |
| 8 | Textos nos três idiomas; suítes, lint, type-check e build; API HML com a versão nova; Preview `Ready` | web + API + VPS |

### Fora do escopo

- Carga em produção.
- Mudar o nome do fornecedor pela lista.
- Cadastrar fornecedor para as linhas sem `EX`.
- Editar produto ou fabricante numa tela própria de referência.
- Carga automática ou periódica.
- Ligar o fabricante ao produto.
- Tabela do Follow Up (etapa 2).

### Riscos

- **Correção manual:** uma correção feita no cadastro volta ao valor da planilha na carga seguinte (decisão 7). Ela não afeta a auditoria, que lê só as linhas da carga.
- **Planilha desatualizada:** a auditoria vale o que a última carga diz. A página mostra a data e o arquivo da carga usada.

### Plano

1. **M082** e ensaio da migration no HML.
2. **Testes e rotas da API:** prévia, gravação, permissão, leitura da referência e classificação dos NCMs.
3. **Testes e tela de carga:** payload compartilhado com o teste de contrato.
4. **Página de auditoria:** lendo a referência da API, sem os dois botões.
5. **Verificação completa e publicação:** commit, push, Preview e release da API no HML.
6. **Carga real no HML:** ensaio com ROLLBACK, carga pela tela, cadastro dos NCMs, conferência e ensaio das invoices.

### Resultado (etapa 1f, até a publicação)

- **API:** `apps/api/src/reference-loads.ts`, com a prévia, a gravação, a leitura da referência e os NCMs pendentes. A permissão é `reference-loads.manage` (Master e Administrador). Os comandos em lote têm os parâmetros com tipo explícito, para evitar o `42P08` da gravação da invoice.
- **Web:**
  - tela `components/ReferenceLoadsPanel.tsx` em `/catalog/reference-loads`;
  - payload em `lib/reference-loads.ts`, a mesma função usada pelo teste de contrato da API;
  - página de auditoria só com a invoice e o Follow Up.
- **Testes:**
  - API: 13 testes novos em `test/reference-loads.test.mjs`;
  - web: 5 testes em `test/reference-loads.test.mjs` e os da página ajustados à etapa 1f.
- **Paridade com as planilhas:** as linhas que a carga guarda, depois de passarem pelo JSON, são iguais à leitura das planilhas, e a auditoria da IPH037A e da IPH034B dá o mesmo resultado com elas. O resultado inclui pontos de NCM e descrição, fabricante por endereço e por nome, parecidos e correções.
- **Ensaio no HML com ROLLBACK** (`deploy/hostinger/rehearse-reference-load.mjs`, release `f7cfbb8`, M082 aplicada):
  - as 486 e 575 linhas guardadas, relidas na mesma transação, ficaram idênticas às enviadas;
  - na DATABASE, 478 produtos atualizados (426 descrições, 415 NCMs preenchidos, 20 trocados), 4 criados e 4 sem mudança;
  - na lista, 540 fornecedores com endereço e país, 18 criados e 17 linhas sem `EX`;
  - os 15 NCMs pendentes estão vigentes no catálogo oficial.
- **Falta:**
  - a carga real pela tela;
  - o cadastro dos 15 NCMs;
  - a releitura da referência do HML (`invoices_tests/reference-hml.json`) para o teste de paridade com o banco.

## Etapa 1g: decisões em massa

Pedido do usuário (2026-11-11): uma opção no topo da página para decidir de uma vez todos os pontos de um tipo, por exemplo "Aceitar o preço da invoice (todos)" e "Corrigir para o preço da PO (todos)".

Decisões do usuário (2026-11-11):

1. Todos os tipos que admitem uma decisão comum entram no painel.
2. A ação em massa só preenche os pontos sem decisão. Um ponto em que o analista já escolheu uma opção não é alterado.
3. "Corrigir para o preço da PO (todos)" deixa pendentes os pontos sem um único preço de PO em CNY, e o painel avisa quantos ficaram.

### Requisitos

1. **Painel "Decisões em massa"** no topo da auditoria, depois da leitura dos arquivos. Ele aparece quando há algum ponto pendente de um dos tipos abaixo e mostra, por tipo, quantos estão sem decisão.

   | Tipo | Ações | Motivo |
   |---|---|---|
   | Preço da invoice × PO | aceitar o preço da invoice (todos) / corrigir para o preço da PO (todos) | não |
   | Pesos INV × PKL | manter a INV (todas) / usar a PKL (todas) | sim |
   | Quantidade diferente ou código fora da PO | confirmar (todas) | sim |
   | Fornecedor do Exporter | confirmar (todos) | não |
   | Produto fora da DATABASE | confirmar (todos) | sim |
   | País do fabricante diferente da lista | manter a invoice (todos) / usar a lista (todos) | sim |
   | Fabricante fora da lista | confirmar (todos) | sim |

2. **Motivo:** um campo de motivo no painel vale para as ações que pedem motivo, com o mesmo mínimo de 3 caracteres. Sem ele, essas ações ficam desabilitadas.
3. **Sem decisão:**
   - preço sem escolha;
   - pesos ou país sem opção escolhida;
   - quantidade, produto, fabricante ou fornecedor não confirmados.

   Uma confirmação que ainda não estava marcada mantém o motivo já digitado na linha; o motivo do painel só entra quando a linha não tem motivo.
4. **Não decidem e ficam pendentes:**
   - "Usar a PKL" em linha que não está nas duas abas;
   - "Corrigir para o preço da PO" sem um único preço de PO;
   - código fora da PO com quantidade destinada diferente de 0, que se resolve destinando 0 ou trocando a PO.

   O painel diz quantos sobraram e por quê.
5. **Fora do painel:** a escolha entre vários endereços da lista, a PO sugerida, a escolha de um fabricante parecido e a falta de saldo, porque cada uma tem opções próprias da linha.
6. **Depois da ação:** o analista continua podendo mudar ponto a ponto. A aba `AUDITORIA` registra cada ponto com a decisão e o motivo, como hoje.
7. **Textos e layout:** nos três idiomas, com as regras de layout do projeto.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Cada ação preenche só os pontos sem decisão e não altera os já decididos | web (`lib/`) |
| 2 | Corrigir o preço deixa pendentes os pontos sem preço único; usar a PKL deixa pendentes as linhas fora de uma das abas; as contagens de pendentes saem certas | web (`lib/`) |
| 3 | As ações com motivo ficam desabilitadas sem motivo; o painel está no topo da página e usa as funções de `lib/` | web |
| 4 | Textos nos três idiomas; classes com regra; suítes, lint, type-check e build; Preview `Ready` | web |

### Fora do escopo

API, banco e release na VPS (nada muda fora da página); decisões em massa na tela de IP.
