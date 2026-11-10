# Tarefa: Página avulsa de auditoria de invoice contra o Follow Up, com arquivo corrigido

| Item | Valor |
|---|---|
| Data | 2026-11-10 |
| Branch de trabalho | `homologacao` |
| Status | Etapa 1 aprovada e implementada (2026-11-10); conferência na tela pendente |

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
