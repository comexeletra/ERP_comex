type ConditioningAttribute = { code: string; displayName: string };

function joinPortuguese(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ou ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`;
}

function describeConditionValue(value: string): { text: string; isBoolean: boolean } {
  if (/^true$/iu.test(value)) return { text: "Sim", isBoolean: true };
  if (/^false$/iu.test(value)) return { text: "Não", isBoolean: true };
  return { text: value, isBoolean: false };
}

export function describeNcmAttributeCondition(
  condition: string | null,
  controllingAttribute?: ConditioningAttribute,
): string {
  if (!condition) return "O Siscomex define quando este atributo deve ser preenchido.";

  const parts = condition.split(/\s+OU\s+/iu).map(part => {
    const match = /^['"]?(ATT_[A-Z0-9_]+)['"]?\s+igual(?:\s+a)?\s+(?:'([^']*)'|"([^"]*)"|(.+?))\s*$/iu.exec(part.trim());
    if (!match) return null;
    return { code: match[1]!, value: match[2] ?? match[3] ?? match[4]!.trim() };
  });

  if (parts.some(part => part === null)) {
    return `Obrigatório quando a regra oficial do Siscomex for atendida: ${condition}.`;
  }

  const conditions = parts as Array<{ code: string; value: string }>;
  const code = conditions[0]!.code;
  if (conditions.some(part => part.code !== code)) {
    return `Obrigatório quando a regra oficial do Siscomex for atendida: ${condition}.`;
  }

  const attributeName = controllingAttribute?.code === code
    ? `“${controllingAttribute.displayName}”`
    : `o atributo ${code}`;
  const values = conditions.map(part => describeConditionValue(part.value));
  const shownValues = joinPortuguese(values.map(value => value.text));
  const booleanValues = values.every(value => value.isBoolean);
  const when = booleanValues
    ? shownValues
    : values.length === 1 ? `a opção ${shownValues}` : `uma das opções ${shownValues}`;

  return `Obrigatório quando ${attributeName} for ${when}.`;
}
