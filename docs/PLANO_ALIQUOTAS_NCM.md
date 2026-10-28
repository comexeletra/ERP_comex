# Tarefa: alíquotas de II, IPI, PIS e COFINS por NCM vigente

**Estado:** especificação aprovada pelo usuário em 28/10/2026; implementação na
branch `homologacao`.

## Objetivo

Exibir, para cada NCM vigente, as alíquotas de II, IPI, PIS-Importação e
COFINS-Importação, com fonte, versão e base legal. É uma consulta de alíquotas,
não um cálculo de imposto devido: origem, Ex-tarifário, cota, regime e benefício
continuam podendo alterar o valor final.

## Fontes (decisão do usuário: arquivos oficiais)

Verificadas em 28/10/2026:

| Tributo | Fonte | Conteúdo confirmado |
|---|---|---|
| II | [MDIC — Resolução Gecex nº 272/2021, Anexos I a X](https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes) (`.xlsx`, já localizado por `mdic-ncm.ts`) | Anexo I: `NCM`, `DESCRIÇÃO`, `TEC (%)` (10.516 NCMs). Anexo II: `TEC (%)`, `BIT/BK`, `Alíquota aplicada (%)`, `Fundamentação`. Anexos IV, V (LETEC), VI (LEBIT/BK), VIII (OMC), IX (DCC) e X (ACE-14): `NCM`, `Nº Ex`, `Alíquota (%)`, cota, vigência e ato. Anexo III: lista de posições do setor aeronáutico. |
| IPI | [Receita Federal — TIPI](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.xlsx) (`.xlsx`) | Aba `Tabela Completa`: `NCM`, `EX`, `DESCRIÇÃO`, `ALÍQUOTA (%)`; `NT` = não tributado; 582 linhas de Ex. |
| PIS/COFINS | Lei nº 10.865/2004, art. 8º | Não há tabela oficial por NCM. Regra geral 2,10% / 9,65%; exceções por NCM mantidas no sistema com base legal. |

Constatação que define a regra do II: o Anexo II **não** consolida as listas
de exceção (ex.: 0703.20.90 consta com 9% no Anexo II e 35% na LETEC). As
exceções dos Anexos IV a X precisam ser aplicadas por cima.

## Requisitos

1. **Universo "vigente":** NCMs de `catalog.ncm_official_item` com vigência na
   data de referência (padrão: hoje em Brasília). As ~229 NCMs cadastradas na
   entidade continuam como estão; nada é inserido em `catalog.entry`.
2. **II**, em três camadas, sempre exibidas separadamente:
   - `TEC` — Anexo I;
   - `Alíquota brasileira` — Anexo II (`Alíquota aplicada`), ou a TEC se a NCM
     não constar dele;
   - `Alíquota aplicada` — uma exceção dos Anexos IV, V, VI, VIII, IX ou X
     substitui a alíquota brasileira somente quando for da NCM inteira
     (`Nº Ex` = "-"), sem cota e vigente na data. Mais de uma exceção nessas
     condições com alíquotas diferentes resulta em "requer análise", sem escolher.
   - Exceções com Ex ou cota e o Anexo III são listadas como **condicionais**,
     com alíquota, cota, vigência e ato, sem serem aplicadas automaticamente.
   - Premissa exibida: origem fora do Mercosul e sem preferência tarifária.
3. **IPI:** alíquota da linha da NCM sem Ex; `NT` exibido como "não tributado",
   nunca como 0%. Linhas de Ex listadas no detalhe, sem aplicação automática.
4. **PIS/COFINS:** regra geral versionada com vigência (2,10% / 9,65% desde
   01/05/2015, Lei nº 13.137/2015). Exceções por NCM com alíquotas, base legal,
   vigência, autor e motivo, com auditoria e outbox. NCM sem exceção aparece como
   "regra geral — não revisada pelo fiscal".
5. **Atualização:** baixa as duas planilhas, calcula SHA-256 e só processa quando
   o arquivo muda. Cada versão fica retida (fonte, URL, data de atualização
   declarada, texto "Atualizado até…", hash, contagem, instante). A troca é
   atômica: uma falha ou planilha incompleta mantém a versão anterior. Disparo
   manual (`202` + status) e agendamento diário próprio na API HML.
6. **Consulta:** tela nova **Alíquotas por NCM** com busca por código ou descrição,
   filtro por capítulo, paginação e indicadores (Ex, exceção condicional, PIS/COFINS
   revisado), mais detalhe por NCM com camadas, exceções e fontes. A tela de NCM
   cadastrada mostra o mesmo bloco de alíquotas.
7. Textos nos três dicionários; tabela com o arrasto padrão; tokens de layout.

## Restrições

- Independência do fluxo NCM e TTCE existente, conforme
  `docs/TRATAMENTO_TRIBUTARIO_NCM_E_DESPACHO.md`: módulo, tabelas, agendamento e
  estado de erro próprios. Não alterar `siscomex-ncm.ts`, `mdic-ncm.ts`,
  `ncm-sync.ts`, `ncm-snapshot.ts` nem as rotas `/api/v1/ncms*`; a carga de
  alíquotas não dispara download de nomenclatura e vice-versa.
- Percentuais em `numeric` (aritmética decimal); valores como `7.800000000000001`
  são normalizados com arredondamento documentado (4 casas) e o original fica
  retido para auditoria.
- Migration nova (M072) aplicada primeiro somente no HML `erp_po_totvs_hml`,
  após conferir banco, papel e dados diretamente nele.
- **Permissão (decisão do usuário):** leitura com `catalog.read`; atualização
  manual e exceções de PIS/COFINS com nova permissão `tax-rates.manage` para
  Master, Administrador e Fiscal.

## Critérios de aceite

- Parsers rejeitam planilha sem as abas/colunas esperadas ou com menos de 9.000
  NCMs, e reconhecem `NT`, Ex, cotas e vigências (testes com planilhas geradas
  em teste).
- Regra do II: casos de TEC pura, Anexo II, LETEC de NCM inteira, exceção com Ex,
  exceção com cota, exceção fora de vigência e conflito entre exceções.
- Hash igual não reprocessa; falha preserva a versão anterior; status mostra erro
  e horário.
- Regressão: rotas e agendamento NCM inalterados; carga de alíquotas não chama
  Siscomex/TTCE.
- Contrato web/API das rotas novas; autorização (leitura e gestão).
- Exceção PIS/COFINS: criar, editar e encerrar vigência com auditoria; sem
  sobreposição de vigências na mesma NCM.
- API HML implantada e rotas verificadas nela; Preview `homologacao` Ready.

## Fora do escopo

Cálculo de imposto devido, ICMS, CBS/IBS (fase de teste em 2026, substitui
PIS/COFINS em 2027 — tratar em etapa própria), preferências Mercosul/ACE,
aplicação de Ex-tarifário ou cota, vínculo produto–NCM, exportação Excel da
nova tela (pode entrar depois pelo modelo de `jobs.export_job`), integração
com Protheus.

## Plano

1. Testes e parsers de Gecex 272 (Anexos I, II, III–X) e TIPI, em módulo novo.
2. Regra de composição do II e do IPI (função pura) com testes.
3. M072: snapshots, alíquotas, exceções, regra geral e exceções PIS/COFINS;
   aplicar no HML após conferência.
4. Repositório de carga com hash, troca atômica e status; agendamento diário.
5. Rotas de leitura, atualização e exceções PIS/COFINS, com testes de contrato e
   autorização.
6. Tela "Alíquotas por NCM", bloco na NCM cadastrada, i18n e testes de layout.
7. Deploy da API HML na VPS, primeira carga, conferência no banco HML; push
   `homologacao` e validação do Preview.
