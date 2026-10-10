# Análise de aderência: substituir o Follow Up de importação

Data: 2026-10-04. Escopo: revisão estática do repositório e leitura local, sem alterar, do arquivo `Follow Up Import 2026 - Copiar.xlsx`. Esta análise não é homologação no TOTVS nem teste funcional da implantação.

## Objetivo operacional entendido

O analista consulta uma PO no TOTVS e registra seu acompanhamento no sistema. Uma PO pode ter produtos e quantidades distribuídos por vários IPs; um IP pode reunir produtos de várias POs. O sistema precisa permitir cadastrar e corrigir os dados da PO, registrar cada item, criar e editar IPs, atribuir **quantidades de itens** aos IPs e consultar o que ainda falta atender. A planilha deve deixar de ser a ferramenta de preenchimento após reconciliação e corte formal.

Interpretação provisória de “criar PO”: cadastrar no aplicativo uma PO que já existe no TOTVS. Se o objetivo for emitir uma PO oficial no TOTVS, será necessária uma integração de escrita e aprovação com o ERP, o que muda o escopo da primeira entrega.

**Resultado:** o projeto já consulta parte do histórico, porém **ainda não substitui a planilha para o trabalho diário**. A relação PO–IP existe para navegação histórica, mas não há escrita operacional de PO/IP nem alocação quantitativa de itens.

## O arquivo indicado nesta conversa

O inventário reproduzível está em `docs/workbook_audit.py` e usa apenas a biblioteca padrão do Python. O SHA-256 do arquivo indicado é `eb9cb9f0b14d7be75850db63d8a562a0495422c80be3eb1745baf0ddc4a669a0`.

| Medida | Arquivo indicado agora | Snapshot documentado no plano |
|---|---:|---:|
| Linhas preenchidas em Pré Embarque | 7.056, linhas 4–7.059 | 6.940, linhas 5–6.944 |
| Linhas preenchidas em Pós Embarque | 195, linhas 5–199 | 190, linhas 5–194 |
| POs distintas por importador e número | 338 | 336 |
| IPs distintos no Pré Embarque | 204 | 200 |
| Pares PO–IP | 460 | 449 |
| POs em mais de um IP | 78 | 76 |
| IPs com mais de uma PO | 92 | 91 |

No arquivo atual, o cabeçalho do Pré Embarque está na **linha 3** e os dados começam na **linha 4**. O importador histórico em `deploy/hostinger/import-historical-workbook.py` exige o hash `d2f025ce...`, cabeçalho na linha 4 e lê linhas 5–6.944 e 5–194. Portanto, **não aceita nem incorpora este arquivo**. A aplicação pode mostrar a carga anterior, mas não se deve presumir que ela represente a planilha indicada agora. A análise dos deltas é agregada; sem o XLSX aprovado anterior disponível localmente, não foi feita comparação célula a célula.

O Pré Embarque atual possui cabeçalhos até `DB`, enquanto o importador histórico preserva somente `B:AZ` nessa aba. Entre `BB:DB` há campos de prazo, checagem de invoice, fases T0–T5, atraso, gargalo e status atual. É preciso decidir quais são entradas operacionais, quais são projeções calculadas e quais serão apenas evidência histórica. As fórmulas do Excel não devem ser copiadas como regra de negócio implícita.

O arquivo atual tem 79 POs sem IP válido; 78 com mais de um IP. Há 138 combinações de importador, PO e código de produto observadas em mais de um IP. Isso **não prova** que sejam a mesma linha oficial do TOTVS: a planilha não contém identificador estável da linha da PO. Para calcular saldo e atendimento confiáveis, é necessário identificar a linha oficial e registrar a quantidade atribuída a cada IP.

## Aderência do projeto hoje

| Necessidade do analista | Situação verificada | Evidência principal |
|---|---|---|
| Consultar POs e IPs históricos | Parcialmente disponível: carteira, filtros, detalhes, linhas brutas, vínculos e custos históricos | `apps/api/src/purchase-orders.ts`, `apps/api/src/processes.ts`, `apps/web/components/PurchaseOrderWorkspace.tsx` |
| Criar uma PO de acompanhamento a partir do TOTVS | Não disponível | Rotas de PO em `purchase-orders.ts` são somente `GET`; `procurement.purchase_order` guarda basicamente número/importador/identidade |
| Editar cabeçalho e itens da PO | Não disponível | Não há rota `PATCH` de PO nem entidade de item oficial; `po_line_observation` é observação imutável da planilha |
| Criar e editar IP | Não disponível | Rotas de IP em `processes.ts` são somente `GET` |
| Vincular PO a vários IPs | Leitura histórica disponível; criação/alteração do vínculo não disponível | `procurement.process_purchase_order` guarda pares, mas não quantidade por item |
| Registrar parte de um item em cada IP e apurar restante | Não disponível | Não há tabela/rota para item oficial + alocação quantitativa; a API declara `officialItemsKnown: false` e `balanceAvailable: false` |
| Preencher e acompanhar os campos da planilha no sistema | Muito parcial | Células históricas ficam visíveis em auditoria; invoice, embarque, marcos, documentos e custos novos ainda não são registros operacionais editáveis |
| Criar solicitações prévias e manter cadastros | Parcialmente disponível | `requests.ts` tem criação/edição restrita; `catalog.ts` tem comandos próprios. Isso não cria ou altera POs/IPs |
| Receber novas versões da planilha sem perda | Não disponível como fluxo operacional | Há script de prévia e carga do arquivo antigo aprovado; não há reconciliação/promoção de lotes novos por entidade |

As telas atuais mostram corretamente que os dados são históricos. O campo `version` da PO existe no banco, mas não há comando de edição de PO que o utilize. Os custos históricos pertencem ao IP; copiá-los integralmente para cada PO produziria duplicidade.

## Modelo mínimo para a substituição

1. **PO de acompanhamento**: chave externa confirmada com empresa/filial/instância do TOTVS, número, importador, fornecedor, moeda, datas, estado e origem. Cadastrar uma PO no aplicativo não deve gerar uma PO oficial no TOTVS sem integração explicitamente definida.
2. **Linha oficial ou conferida da PO**: identificador da linha no TOTVS quando disponível, produto, unidade, quantidade pedida, preço, moeda e versão da origem. Não transformar automaticamente cada linha da planilha em item oficial.
3. **IP operacional**: número, importador, estado, prioridade, responsáveis e marcos relevantes, com criação e edição auditadas.
4. **Alocação de item para IP**: referência à linha da PO e ao IP, quantidade, unidade, estado, versão e autoria. O vínculo PO–IP pode ser derivado dessas alocações. A soma das quantidades ativas não pode exceder a quantidade confirmada da linha, salvo exceção autorizada e registrada. Cancelamentos e correções devem preservar histórico.
5. **Observação histórica separada**: manter a célula/linha original, o lote e sua procedência. A migração do histórico para linhas oficiais e alocações requer conciliação explícita, pois a igualdade de número de PO e código de produto não resolve a identidade de linha.

## Ordem recomendada de entrega

1. **Fechar a fonte dos dados TOTVS e a versão da planilha.** Confirmar se “criar PO” significa cadastrar uma PO já existente no TOTVS. Definir como os analistas obtêm número da linha, quantidade original, unidade e alterações/cancelamentos: exportação controlada inicial ou integração. Inventariar e comparar a planilha atual com a carga anterior antes de atualizar o banco.
2. **Entregar o núcleo de escrita.** Migrations de PO, itens, IPs e alocações; comandos de criar/editar com validação, escopo por importador, controle de concorrência, idempotência e auditoria. Preservar a origem histórica em tabelas separadas.
3. **Entregar o fluxo do analista.** Na carteira, cadastrar/abrir PO; corrigir cabeçalho e itens; criar/abrir IP; selecionar linha e quantidade; ver pedido, alocado e restante por item, além dos IPs relacionados. Permitir filtrar pendências e corrigir vínculos sem apagar o histórico.
4. **Completar a equivalência de preenchimento.** Mapear campo por campo das abas Pré e Pós, decidir dono e regras de cada valor, e construir os módulos operacionais de invoice, embarque, chegada, desembaraço, NF, custos e documentos conforme prioridade real da equipe. Uma tela de auditoria com células do Excel não substitui esses formulários.
5. **Reconciliação e corte.** Executar casos reais em paralelo com a planilha, comparar quantidade/estado/pendências por PO e IP, treinar analistas, obter aceite e só então usar o aplicativo como fonte operacional.

## Critérios mínimos de aceite do núcleo

- Uma PO com uma linha de 100 unidades pode ser atribuída em 60 unidades ao IP A e 40 ao IP B; o restante é zero e a carteira mostra dois IPs.
- Um IP pode conter itens de duas POs sem replicar quantidade ou custo; cada PO mostra apenas suas próprias linhas e atribuições.
- Alterar a atribuição de 60 para 50 libera 10 unidades; tentativa de atribuir mais que o restante é rejeitada e registrada.
- A mesma PO e o mesmo produto em duas linhas diferentes do TOTVS continuam distintos; registros históricos sem linha confirmada aparecem como pendência de conciliação.
- Duas edições simultâneas não sobrescrevem uma à outra; usuários fora do escopo não conseguem ler nem escrever a PO/IP.
- A versão nova do XLSX pode ser pré-visualizada, comparada e aprovada sem sobrescrever o lote histórico anterior.

## Limite da conclusão

Esta revisão cobriu a estrutura, migrations, rotas, telas, scripts e documentação do repositório, além do conteúdo salvo do XLSX indicado. Não houve acesso autenticado ao TOTVS nem execução do fluxo com usuários reais. O checklist do projeto informa uma carga anterior na VPS; os números dessa implantação não foram consultados diretamente nesta revisão.
