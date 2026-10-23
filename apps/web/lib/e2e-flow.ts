export type E2eFlowConfig = {
  /** Dias entre a entrega do plano comercial e a data de necessidade. */
  horizonte: number;
  /** T1 · PCM aprova a Solicitação de Compra. */
  sc: number;
  /** T2 · Comex cria, aprova e envia a PO. */
  po: number;
  /** T3 · produção HQ — MTS (Make to Stock). */
  prodMts: number;
  /** T3 · produção HQ — não MTS. */
  prodNaoMts: number;
  /** T4 · transporte SEA. */
  maritimo: number;
  /** T4 · transporte AIR. */
  aereo: number;
  /** T5 · pós-embarque até a chegada na empresa. */
  desembaraco: number;
  /** Tempo de cada fase na animação. */
  intervaloMs: number;
  autoplay: boolean;
};

export const DEFAULT_E2E_FLOW_CONFIG: E2eFlowConfig = {
  horizonte: 120,
  sc: 8,
  po: 7,
  prodMts: 45,
  prodNaoMts: 30,
  maritimo: 55,
  aereo: 10,
  desembaraco: 10,
  intervaloMs: 4000,
  autoplay: true,
};

export const E2E_PHASE_COUNT = 6;

export type E2eIconName = "plan" | "cart" | "send" | "factory" | "ship" | "plane" | "truck";
export type E2eSide = "br" | "cn";

export type E2ePhase = {
  code: string; icon: E2eIconName; side: E2eSide; name: string; from: string; to: string; owner: string; lt: string;
  title: string; dFrom: string; dTo: string; win: string; rule: string; docs: string[];
};

export type E2eScenario = { mts: boolean; air: boolean };
export type E2eTick = { label: string; left: string; transform: string; tone?: "ink" | "late" };
export type E2eSegment = { phase: number; days: number; widthPct: number; label: string };
export type E2eMilestone = { label: string; offset: number; side: E2eSide };

export function formatDayOffset(value: number) {
  return value >= 0 ? `D-${value}` : `D+${-value}`;
}

/** Centro da coluna `k` de uma grade de 6 colunas com 16px de espaçamento. */
export function railCenter(k: number) {
  return `calc(${(((2 * k + 1) / 12) * 100).toFixed(4)}% + ${(((2 * k - 5) * 16) / 12).toFixed(3)}px)`;
}

export function buildE2eFlow(config: E2eFlowConfig, { mts, air }: E2eScenario) {
  const { horizonte: H, sc, po, desembaraco: clr } = config;
  const prod = mts ? config.prodMts : config.prodNaoMts;
  const tr = air ? config.aereo : config.maritimo;
  const durations = [sc, po, prod, tr, clr];
  const total = durations.reduce((sum, days) => sum + days, 0);
  const slack = H - total;
  const months = Math.round(H / 30);
  const offsets = [H, H];
  for (const days of durations) offsets.push(offsets[offsets.length - 1] - days);
  const win = (k: number) => `${formatDayOffset(offsets[k])} → ${formatDayOffset(offsets[k + 1])}`;
  const transport = air ? "Transporte aéreo" : "Transporte marítimo";
  const arrival = air ? "Chegada no aeroporto" : "Chegada no porto";

  const phases: E2ePhase[] = [
    { code: "T0", icon: "plan", side: "br", name: "Plano comercial", from: "Plano comercial", to: "Solicitação de Compra",
      owner: "Comercial", lt: `D-${H}`, title: "Plano comercial", dFrom: "Plano comercial", dTo: "Solicitação de Compra (SC)",
      win: `Entrega em D-${H}`,
      rule: `Comercial · entregar o plano ${months} meses antes da data de necessidade da matéria-prima na fábrica.`,
      docs: ["Plano comercial", "Data de necessidade", "Solicitação de Compra"] },
    { code: "T1", icon: "cart", side: "br", name: "Aprovação da SC", from: "Solicitação de Compra pelo PCM", to: "Purchase Order",
      owner: "PCM", lt: `${sc} dias`, title: "Aprovação da Solicitação de Compra", dFrom: "SC emitida pelo PCM",
      dTo: "Purchase Order", win: win(1), rule: `PCM · ${sc} dias para aprovar a Solicitação de Compra.`,
      docs: ["Solicitação de Compra", "Aprovação PCM"] },
    { code: "T2", icon: "send", side: "br", name: "Emissão da PO", from: "Criação e envio da PO", to: "Início da produção",
      owner: "Comex", lt: `${po} dias`, title: "Emissão da Purchase Order", dFrom: "Criação e envio da PO",
      dTo: "Início da produção", win: win(2), rule: `Comex · ${po} dias para criar, aprovar e enviar a PO à HQ na China.`,
      docs: ["Purchase Order", "Aprovação", "Envio à HQ"] },
    { code: "T3", icon: "factory", side: "cn", name: "Produção HQ", from: "Produção na HQ", to: "Embarque",
      owner: `HQ · ${mts ? "MTS" : "Não MTS"}`, lt: `${prod} dias`, title: "Produção na HQ", dFrom: "Início da produção",
      dTo: "Embarque", win: win(3),
      rule: `HQ · ${config.prodMts} dias para produtos MTS (Make to Stock) e ${config.prodNaoMts} dias para produtos não MTS.`,
      docs: ["Order confirmation", "Commercial invoice", "Packing list"] },
    { code: "T4", icon: air ? "plane" : "ship", side: "cn", name: transport, from: "Embarque na China", to: arrival,
      owner: `Transp. · ${air ? "AIR" : "SEA"}`, lt: `${tr} dias`, title: `${transport} China → Brasil`,
      dFrom: "Embarque na China", dTo: arrival, win: win(4),
      rule: `Transportadora · ${config.maritimo} dias via marítima (SEA) ou ${config.aereo} dias via aérea (AIR).`,
      docs: [air ? "AWB" : "Bill of Lading", "Tracking", "Aviso de chegada"] },
    { code: "T5", icon: "truck", side: "cn", name: "Desembaraço e entrega", from: "Desembarque e desembaraço",
      to: "Chegada na empresa", owner: "Pós-embarque", lt: `${clr} dias`, title: "Desembaraço aduaneiro e entrega",
      dFrom: "Desembarque", dTo: "Chegada na empresa", win: win(5),
      rule: `Pós-embarque · ${clr} dias após o desembarque para desembaraçar e entregar na empresa.`,
      docs: ["DUIMP / DI", "Liberação aduaneira", "NF de entrada"] },
  ];

  const milestoneLabels = ["Plano comercial entregue", "Solicitação de Compra emitida", "SC aprovada pelo PCM",
    "PO enviada · início da produção", "Embarque na China", arrival, "Chegada na empresa"];
  const milestones: E2eMilestone[] = milestoneLabels.map((label, k) => ({ label, offset: offsets[k], side: k <= 3 ? "br" : "cn" }));

  // Régua: o eixo cobre o horizonte ou, se maior, o lead time total.
  const span = Math.max(H, total);
  const position = (offset: number) => `${(((H - offset) / span) * 100).toFixed(3)}%`;
  const ticks: E2eTick[] = [{ label: formatDayOffset(H), left: "0%", transform: "none" }];
  for (let offset = H - 30; offset > 0; offset -= 30) {
    ticks.push({ label: formatDayOffset(offset), left: position(offset), transform: "translateX(-50%)" });
  }
  if (slack < 0) {
    ticks.push({ label: "D-0", left: position(0), transform: "translateX(-50%)", tone: "ink" });
    ticks.push({ label: `D+${-slack}`, left: "100%", transform: "translateX(-100%)", tone: "late" });
  } else {
    ticks.push({ label: "D-0 · necessidade", left: "100%", transform: "translateX(-100%)", tone: "ink" });
  }

  const segments: E2eSegment[] = durations.map((days, index) => {
    const widthPct = (days / span) * 100;
    return { phase: index + 1, days, widthPct, label: widthPct >= 6 ? `T${index + 1} · ${days}d` : `T${index + 1}` };
  });
  const slackPct = (Math.max(0, slack) / span) * 100;
  const slackLabel = slack > 0 ? (slackPct >= 8 ? `Folga · ${slack}d` : `${slack}d`) : "";

  return {
    phases, durations, total, slack, months, milestones, ticks, segments, slackPct, slackLabel,
    overflowLeft: slack < 0 ? position(0) : null,
  };
}
