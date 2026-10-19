# Consulta tributária por NCM e estimativa no despacho

**Estado:** proposta para implementação futura. Este documento não representa uma
integração, cálculo ou alíquota já entregue. Pesquisa e revisão inicial: 19/10/2026.

## Objetivo e regra de apresentação

Permitir que o usuário consulte, em linguagem clara, os tratamentos tributários
relacionados a uma NCM. Quando um produto estiver vinculado a uma NCM e a um item
de importação, oferecer uma estimativa por item para planejamento do despacho,
com premissas, fonte, vigência e memória de cálculo. Comparar depois a estimativa
com os tributos efetivamente apurados na DI/Duimp e pagos.

**A NCM, isoladamente, não determina um valor a pagar.** País de origem, destino,
data do fato gerador, regime, benefícios comprovados, características do produto,
valor aduaneiro e outras condições alteram o resultado. Uma regra possível não
deve ser apresentada como benefício já concedido. A interface deve separar
"tratamentos possíveis", "estimativa da operação" e "valores declarados/pagos".

## Ponto de partida no ERP

- O catálogo global de NCMs e os atributos obrigatórios de importação estão em
  `catalog.entry` e `catalog.ncm_siscomex_data`. A busca/sincronização atual usa
  `apps/api/src/siscomex-ncm.ts`, `ncm-sync.ts`, `ncm-snapshot.ts` e `catalog.ts`.
  A tela fica em `apps/web/app/catalog/values/page.tsx`.
- O esquema da PO tem `procurement.purchase_order_item.ncm` como texto. O processo
  de importação tem `freight_cost`, `duimp_number` e `taxes_paid_brl` agregado em
  `apps/api/migrations/M019_followup_operational.sql`. Não há, no esquema atual,
  vínculo tipado produto → NCM nem apuração por tributo e item. Confirmar os dados
  e a estrutura efetivamente instalados no banco HML antes de migrar ou concluir
  qualquer diagnóstico de dados.
- Preservar a consulta manual e automática atual de nomenclatura/atributos de NCM.
  A integração tributária terá adaptador, cache, estado e rotas próprios. Não
  ampliar o download atual de NCM para buscar tributos durante cada atualização.

## Requisito obrigatório: preservar a consulta Siscomex existente

Este é um critério de aceite da futura implementação, não apenas uma preferência
de arquitetura. A consulta tributária TTCE deve ser **independente** do fluxo já
em uso para nomenclatura e atributos NCM. Ao implementar:

- Manter o comportamento, as permissões, os parâmetros e os retornos das rotas
  atuais `/api/v1/ncms`, `/api/v1/ncms/official-search`,
  `/api/v1/ncms/import-official`, `/api/v1/ncms/refresh-official` e
  `/api/v1/ncms/sync-status`. A busca oficial, a inclusão individual e a
  atualização manual dos NCMs já cadastrados devem continuar funcionando.
- Manter o agendamento automático das 06:00 e 12:00 (Brasília), a atualização
  somente dos NCMs cadastrados, a auditoria/outbox, o cache, a coordenação de
  downloads e o bloqueio com `Retry-After` após falha/limite da fonte NCM.
  Preservar o retorno rápido `202` e o acompanhamento da atualização manual.
- Não alterar as fontes de nomenclatura/atributos, o parser em
  `apps/api/src/siscomex-ncm.ts`, nem usar `getOfficialNcms()` ou
  `refreshRegisteredNcms()` para obter tributos. Consultas TTCE não podem disparar
  novo download de nomenclatura, consumir suas cotas, escrever nos snapshots
  NCM ou modificar a vigência/descrição/atributos de um NCM cadastrado.
- Criar cliente, armazenamento, limites, cache e estado de erro **separados** para
  TTCE. Se TTCE estiver lento, indisponível ou limitado, a busca e a atualização
  atuais de NCM permanecem disponíveis. Se a fonte NCM falhar, um tratamento
  tributário íntegro já armazenado continua consultável com sua data/fonte.
- Antes de publicar, executar os testes atuais de NCM e testes de regressão que
  provem essa independência: uma consulta TTCE não chama os endpoints NCM; falha
  TTCE não muda `/official-search` ou `/sync-status`; atualização manual/automática
  NCM não chama TTCE; ambas preservam seus próprios dados e horários de
  retentativa. Validar esses fluxos na API HML e na interface.

Qualquer necessidade futura de alterar o fluxo de NCM existente deve ser tratada
como mudança separada, com justificativa, testes de contrato e validação na HML.

## Fonte oficial e limite do que foi confirmado

O Tratamento Tributário do Comércio Exterior (TTCE) do Portal Único publica uma
API de **consulta em lote por capítulo da NCM**. O fluxo documentado consulta
`GET /api/ext/importacao/ncm-capitulos/hashes`, obtém, quando necessário, o hash
de um capítulo/data em
`GET /api/ext/importacao/ncm-capitulos/{capitulo}/hash` e baixa
`GET /api/ext/importacao/ncm-capitulos/{capitulo}/tratamentos-tributarios` com o
hash correspondente. A base de URL é a do módulo TTCE do ambiente escolhido;
conferir parâmetros e contrato exatos na especificação da API antes de codificar.
O hash diário permite atualizar somente capítulos alterados. Também existem
arquivos por fundamento legal para nomenclaturas alternativas, que podem ficar
para uma etapa posterior.

O JSON de exemplo traz intervalos de NCM, origem, destino, tributo, regime,
fundamento legal e atributos necessários. **O exemplo do download não comprova
uma API que devolva valores monetários calculados ou todas as alíquotas prontas.**
O Portal oferece um simulador de cálculo público na interface web. Antes de
prometer cálculo automático dentro do ERP, verificar na documentação OpenAPI do
TTCE quais serviços de cálculo e alíquotas são oficialmente integráveis, seus
parâmetros, autenticação e limites; se não houver serviço adequado, definir e
validar com a área fiscal uma fonte oficial e um motor de cálculo versionado.
Não integrar por automação da tela do simulador.

O endpoint individual
`/api/ext/tratamentos-tributarios/importacao/` já é indicado como *deprecated*
pela documentação. A implementação nova deve partir dos endpoints em lote, não
desse endpoint individual. A documentação atual também inclui CBS, IBS estadual
e IBS municipal; modelar os tipos de tributo de modo extensível e verificar as
regras/vigências aplicáveis em cada data. ICMS, custos e pagamentos estaduais
exigem tratamento próprio; não inferir a alíquota estadual apenas da NCM.

Fontes oficiais consultadas:

- [API de consulta em lote TTCE](https://api-docs.portalunico.siscomex.gov.br/pages/exemplos/ttce/documentacao-adicional-api-consulta-lote/)
- [API individual TTCE e aviso de depreciação](https://api-docs.portalunico.siscomex.gov.br/pages/exemplos/ttce/documentacao-adicional-api-consulta-individual/)
- [Documentação principal da API TTCE](https://api-docs.portalunico.siscomex.gov.br/api/ttce/)
- [Dados de apoio: tributos, regimes e fundamentos](https://api-docs.portalunico.siscomex.gov.br/pages/exemplos/ttce/dados-apoio/)
- [Release Paraná e endpoints de lote](https://api-docs.portalunico.siscomex.gov.br/rn/r75-parana/)
- [Release Paraná RTC: CBS e IBS](https://api-docs.portalunico.siscomex.gov.br/rn/r75-parana-v75.1-rtc/)
- [Simulador oficial para DI e Duimp](https://www.gov.br/pt-br/servicos/simular-o-tratamento-tributario-e-administrativo-de-importacoes)
- [Valoração aduaneira na DI](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/despacho-de-importacao/sistemas/siscomex-importacao-web/declaracao-de-importacao/funcionalidades/elaborar-uma-nova-solicitacao-de-di/preenchimento-da-di-1/formularios-de-dados-especificos-da-adicao/aba-valor-aduaneiro-1/aba-valor-aduaneiro)

## Etapas de implementação

### 1. Consulta tributária da NCM

1. Confirmar o contrato OpenAPI e testar o TTCE no ambiente apropriado com uma
   NCM de teste. Registrar status HTTP, tamanho, formatos, hash, limites e erros,
   sem inserir segredos em logs. Respeitar bloqueio/horário de liberação do Portal;
   não fazer repetidas chamadas de prova após limite de acesso.
2. Criar adaptador TTCE separado da sincronização NCM. Validar origem e esquema
   da resposta, limitar tamanho e concorrência, baixar apenas capítulos usados,
   compartilhar chamadas simultâneas e guardar a última versão íntegra. Uma
   falha não pode apagar a versão anterior nem deixar dados parciais visíveis.
3. Persistir fonte, data do fato gerador, capítulo, hash, instante de consulta,
   vigência e resposta normalizada, de forma consultável por NCM + país de origem
   + destino + data. Definir retenção para consultas históricas antes da migration.
   Indexar sem gravar um registro de tributação único e permanente na NCM.
4. Criar rota de leitura própria, por exemplo
   `GET /api/v1/ncms/{id}/tax-treatments?date=...&originCountry=...&destinationUf=...&destinationCity=...`.
   Este é um contrato **proposto**, ainda inexistente. Retornar dados aplicáveis,
   dados que faltam, fonte/versão, idade do cache e erro/retentativa quando houver.
   Manter autorização e escopo do catálogo.
5. Na tela da NCM, explicar “quais tributos e condições podem se aplicar”,
   agrupando II, IPI, PIS/Cofins, CBS/IBS e medidas de defesa comercial conforme
   a resposta. Mostrar fundamento/regime e atributos exigidos em detalhe
   expansível. Não exibir uma alíquota como definitiva sem os parâmetros que a
   sustentam.

### 2. Vínculo revisado entre produto e NCM

Criar relação tipada entre o produto operacional e a NCM global, com vigência,
ator, motivo/evidência, histórico e auditoria. Atribuição e troca da classificação
dependem de revisão fiscal. O vínculo facilita preencher um item novo de PO/IP,
mas cada item deve manter um retrato da NCM usada naquela operação: mudanças no
cadastro do produto não reescrevem importações anteriores. Não converter códigos
históricos automaticamente nem forçar associação por semelhança de descrição.

### 3. Estimativa e comparação no processo de despacho

Definir um cenário por **item de importação**, reunindo: NCM/classificação
validada, país de origem real e prova para eventual preferência, UF e município
de destino/local de consumo, data relevante, DI ou Duimp, modalidade, regime e
fundamentos escolhidos, quantidade/unidade, valor e moeda da mercadoria, Incoterm,
frete, seguro, despesas e ajustes de valoração, câmbio e rateio entre itens.
Solicitar também os parâmetros específicos de benefícios, defesa comercial,
AFRMM/TUM e Taxa Siscomex quando aplicáveis. Esses campos precisam de origem
explícita; um valor ausente não vira zero automaticamente.

Após validar as regras e a fonte de alíquotas, calcular com aritmética decimal
e política de arredondamento versionada, por tributo e item. Guardar bases,
alíquotas, valores, fundamento, parâmetros, data/hora, fonte/hash e versão do
motor. Distinguir cálculo estimado, valor calculado na declaração e valor pago.
Permitir correções justificadas com auditoria, sem substituir silenciosamente a
estimativa anterior. Quando faltar regra ou entrada, mostrar “estimativa
incompleta” e listar o que falta, em vez de inventar um total.

O desenho deve suportar preferências tarifárias e regimes opcionais sem
selecioná-los automaticamente: elegibilidade e documentos são decisões de quem
analisa o despacho. Confirmar com o fiscal o escopo de ICMS e de eventuais
alíquotas específicas antes de liberar totais completos.

## Critérios de aceite e testes

- A mesma NCM com origem, destino, data ou regime diferentes pode produzir
  tratamentos diferentes; o retorno informa exatamente quais parâmetros foram
  usados e o que ainda falta.
- Hash igual não baixa capítulo novamente; hash alterado atualiza-o de modo
  atômico. Falha, timeout, resposta inválida e limite do Portal preservam a
  última versão válida e mostram estado/retentativa, sem bloquear a consulta
  manual/automática atual da nomenclatura.
- Todas as rotas e os fluxos de NCM enumerados em “Requisito obrigatório” mantêm
  seus contratos e passam nos testes de regressão antes e depois da integração
  TTCE, inclusive quando o TTCE retorna erro ou demora.
- UI distingue tratamento possível, estimativa, declarado e pago; não chama
  total incompleto de “imposto devido”. Fundamentos e condições ficam legíveis,
  com referência técnica acessível.
- Testes automatizados cobrem parser/seleção por NCM, origem, destino e data,
  cache/hash, limites, versões, autorização, vínculo de produto, cálculo decimal
  e arredondamento quando este existir, histórico e contrato web/API.
- Testes de banco apenas em ambiente isolado ou HML, com rollback/limpeza.
  Antes de consultar ou migrar o HML, confirmar diretamente que `DATABASE_URL`
  aponta para `/erp_po_totvs_hml` e conferir papel, schema e dados relevantes.
- API HML implantada e rota nova verificada nela separadamente do Preview da
  Vercel. Validar branch, commit e status Ready do Preview da `homologacao`.
  Não liberar em `main` antes do aceite do usuário.

## Retomada em outra máquina

1. No checkout do repositório, conferir `git remote -v` e
   `git status --short --branch`. Preservar modificações locais da outra máquina.
2. Entrar na branch `homologacao`. Com árvore limpa, executar
   `git pull --ff-only production homologacao`; se estiver suja, preservar o
   trabalho local e resolver a atualização explicitamente antes de editar.
3. Ler `AGENTS.md`, este documento e os módulos citados acima. Revalidar as
   fontes oficiais na data da implementação; APIs e regras tributárias mudam.
4. Implementar por etapas, com migration, testes e contrato web/API em cada
   entrega. Fazer commits pequenos e publicar apenas `homologacao` no remoto
   `production`, seguindo os gates de HML/Preview de `AGENTS.md`.

**Decisão pendente antes do cálculo:** confirmar com a equipe fiscal quais
operações entram na primeira versão (DI, Duimp ou ambas), quais tributos entram
no total, como obter as alíquotas/regras oficiais por data e quem pode aprovar
classificação, regime e benefícios. A consulta de tratamentos pode começar
independentemente dessa decisão.
