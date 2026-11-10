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
2. **Leitor do Follow Up** (`lib/follow-up-po-xlsx.ts`):
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

1. Testes e `lib/follow-up-po-xlsx.ts` (leitor do Follow Up e candidatos por PO e código).
2. Testes e `lib/invoice-correction-xlsx.ts` (aplica as decisões e escreve a aba `AUDITORIA`); decisões de preço, PKL e fornecedor em `lib/`.
3. Tela `/invoices/audit` com o parser, as regras e o `InvoiceConference`; menu e textos.
4. Verificação completa, push e Preview; ensaio com a IPH037A e o Follow Up locais.

## Resultado (etapa 1)

- **Leitor do Follow Up** em `lib/follow-up-po-xlsx.ts`:
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
