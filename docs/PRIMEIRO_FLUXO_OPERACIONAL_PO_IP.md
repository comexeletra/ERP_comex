# Primeiro fluxo operacional de PO e IP

Implementado no checkout em 2026-10-04. **Ainda não aplicado à VPS nem homologado
com analistas.** A migration M018 foi aplicada com sucesso a um PostgreSQL 17
isolado e o contrato de integração passou. Antes de aplicar no banco operacional,
validar também em cópia restaurada e manter backup restaurável.

## Fluxo entregue no código

1. Cadastrar uma referência de PO que já existe no TOTVS e editar fornecedor,
   data e observações. O cadastro local não cria nem altera a PO no TOTVS.
2. Cadastrar e editar IP, incluindo status, prioridade e observações.
3. Adicionar e corrigir itens transcritos da PO: linha externa opcional, produto,
   quantidade pedida, unidade e preço/moeda opcionais.
4. Distribuir uma quantidade do item para um IP da mesma importadora; consultar
   pedido informado, distribuído e restante por item; editar ou cancelar a
   distribuição. O IP pode atender várias POs, e uma PO pode usar vários IPs.
5. Rejeitar distribuição acima da quantidade informada e redução do pedido abaixo
   do total já distribuído. Uma trava na linha do item serializa alterações
   simultâneas. Comandos usam escopo da importadora, versão, auditoria e outbox.

O saldo exibido é **saldo da transcrição operacional**, sem confirmação automática
com o TOTVS. Observações históricas da planilha permanecem separadas.

## Aceite antes de trocar a ferramenta de preenchimento

- M018 e `operations.integration.mjs` passaram num PostgreSQL 17 isolado em
  2026-10-04. O teste cobre PO em dois IPs, IP com duas POs, excesso de
  quantidade, correção, cancelamento, versão, escopo e concorrência.
- Confirmar com analistas os campos mínimos e a identidade da linha do TOTVS.
- Executar uma PO dividida entre dois IPs e um IP com duas POs em paralelo com
  o trabalho atual, sem alterar a carga histórica.
- Mapear os demais campos necessários do Pré e do Pós Embarque. Invoice, marcos,
  desembaraço, NF, custos novos e documentos ainda não têm preenchimento
  operacional equivalente ao Excel.

Ordem de release: validar migration em cópia restaurada, fazer backup restaurável
do banco operacional, aplicar M018, instalar API compatível e publicar o frontend.
O frontend novo consulta tabelas de M018; não publicá-lo antes da migration e da API.
Uma planilha mais atual será enviada posteriormente; sua importação histórica e
reconciliação são uma etapa separada deste fluxo operacional.
