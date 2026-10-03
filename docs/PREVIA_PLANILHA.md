# Prévia local de versões da planilha

`deploy/hostinger/preview-historical-workbook.py` lê arquivos `.xlsx` sem alterar
a planilha ou o banco. Requer Python 3.12+ e `openpyxl==3.1.5`, já especificado
em `deploy/hostinger/requirements-historical-import.txt`.

Para inventariar um arquivo recebido, inclusive cabeçalhos após `AZ`:

```bash
python deploy/hostinger/preview-historical-workbook.py nova-versao.xlsx \
  --inventory --output inventario.workbook-preview.json
```

Para comparar duas versões identificadas:

```bash
python deploy/hostinger/preview-historical-workbook.py base-aprovada.xlsx nova-versao.xlsx \
  --expected-baseline-sha256 HASH_APROVADO \
  --output comparacao.workbook-preview.json
```

O relatório contém SHA-256, abas adicionadas/removidas, diferenças de cabeçalho
na linha 4, contagens de linhas a partir da linha 5, células alteradas por coluna,
fórmulas alteradas e até 25 exemplos de valores anteriores/novos. `--sample-limit`
aceita de 0 a 100. Todos os cabeçalhos e células das abas `Pré Embarque` e
`Pós Embarque` são lidos, inclusive fora do intervalo importado hoje.
O inventário lista explicitamente `headersOutsideCurrentExtraction` por aba:
Pré `B:AZ` e Pós `B:AS`. A comparação inclui
`candidateHeadersOutsideCurrentExtraction` para a versão nova, para que campos
fora da faixa não passem despercebidos entre diferenças posicionais.

A comparação é **por posição de linha e célula**, não por identidade de PO/IP.
Uma linha inserida pode deslocar as seguintes e aumentar as diferenças. Fórmulas
não são executadas: os valores vêm do cache salvo no arquivo e o texto da fórmula
é comparado separadamente. Esse relatório é uma prévia técnica para revisão
humana; não aprova regras de negócio, não promove lote e não sobrescreve a origem.
Arquivos de relatório são ignorados pelo Git porque os exemplos podem conter
dados da operação.
