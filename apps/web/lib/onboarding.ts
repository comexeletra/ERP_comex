/**
 * Content model of the onboarding guide (/onboarding). The texts live in the dictionaries under `onboarding`;
 * this module holds what is not text: the chapter order, which screen supports which stage, the schematic
 * drawing of each screen with its numbered points, and the links of the videos recorded by the team.
 * It imports no values from other `lib/` modules, so `node --test` can load it on its own.
 */

export const ONBOARDING_CHAPTERS = ["purpose", "process", "screens"] as const;
export type OnboardingChapter = typeof ONBOARDING_CHAPTERS[number];

export const ONBOARDING_STAGES = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type OnboardingStage = typeof ONBOARDING_STAGES[number];

/** Same keys as the sidebar items, so the guide names each screen exactly as the menu does. */
export const ONBOARDING_SCREEN_KEYS = ["preShipment", "productPortfolio", "postShipment", "invoiceAudit",
  "endToEnd", "indicators", "dataQuality"] as const;
export type OnboardingScreenKey = typeof ONBOARDING_SCREEN_KEYS[number];

/** Pieces of a schematic screen drawing, in a 320 × 200 canvas. `n` counts the repeated parts (fields, rows, tiles). */
export type SketchKind = "title" | "button" | "tabs" | "filters" | "kpis" | "table" | "bars" | "donut" | "rail"
  | "upload" | "checklist" | "form";
export type SketchBlock = { kind: SketchKind; x: number; y: number; w: number; h: number; n?: number };
export type SketchPoint = { x: number; y: number };

export const SKETCH_WIDTH = 320;
export const SKETCH_HEIGHT = 200;

export type OnboardingScreen = {
  key: OnboardingScreenKey;
  href: string;
  /** Stages of the T0–T5 flow this screen follows; empty for a screen that supports every stage. */
  stages: readonly OnboardingStage[];
  sketch: readonly SketchBlock[];
  /** One numbered point per step of the walkthrough, in the order of the steps in the dictionaries. */
  points: readonly SketchPoint[];
};

const header: SketchBlock[] = [
  { kind: "title", x: 16, y: 14, w: 150, h: 18 },
];

export const ONBOARDING_SCREENS: readonly OnboardingScreen[] = [
  {
    key: "preShipment", href: "/", stages: ["T1", "T2", "T3"],
    sketch: [...header, { kind: "button", x: 232, y: 14, w: 72, h: 16 },
      { kind: "kpis", x: 16, y: 42, w: 288, h: 30, n: 4 },
      { kind: "filters", x: 16, y: 82, w: 288, h: 14, n: 5 },
      { kind: "table", x: 16, y: 106, w: 288, h: 82, n: 5 }],
    points: [{ x: 20, y: 86 }, { x: 20, y: 132 }, { x: 300, y: 18 }],
  },
  {
    key: "productPortfolio", href: "/purchase-orders/lines", stages: ["T2", "T3"],
    sketch: [...header, { kind: "button", x: 232, y: 14, w: 72, h: 16 },
      { kind: "tabs", x: 16, y: 42, w: 180, h: 14, n: 3 },
      { kind: "filters", x: 16, y: 66, w: 288, h: 14, n: 4 },
      { kind: "table", x: 16, y: 90, w: 288, h: 98, n: 6 }],
    points: [{ x: 20, y: 46 }, { x: 20, y: 70 }, { x: 300, y: 18 }],
  },
  {
    key: "postShipment", href: "/processes", stages: ["T3", "T4", "T5"],
    sketch: [...header, { kind: "tabs", x: 16, y: 42, w: 200, h: 14, n: 4 },
      { kind: "form", x: 16, y: 66, w: 180, h: 74, n: 6 },
      { kind: "upload", x: 208, y: 66, w: 96, h: 74 },
      { kind: "table", x: 16, y: 150, w: 288, h: 38, n: 2 }],
    points: [{ x: 20, y: 18 }, { x: 20, y: 70 }, { x: 212, y: 70 }],
  },
  {
    key: "invoiceAudit", href: "/invoices/audit", stages: ["T3"],
    sketch: [...header, { kind: "upload", x: 16, y: 42, w: 288, h: 40 },
      { kind: "checklist", x: 16, y: 92, w: 196, h: 96, n: 5 },
      { kind: "kpis", x: 222, y: 92, w: 82, h: 58, n: 1 },
      { kind: "button", x: 222, y: 166, w: 82, h: 18 }],
    points: [{ x: 20, y: 46 }, { x: 20, y: 96 }, { x: 300, y: 170 }],
  },
  {
    key: "endToEnd", href: "/end-to-end", stages: ["T0", "T1", "T2", "T3", "T4", "T5"],
    sketch: [...header, { kind: "filters", x: 16, y: 42, w: 288, h: 14, n: 3 },
      { kind: "rail", x: 16, y: 64, w: 288, h: 18 },
      { kind: "kpis", x: 16, y: 88, w: 288, h: 40, n: 6 },
      { kind: "table", x: 16, y: 138, w: 288, h: 50, n: 3 }],
    points: [{ x: 20, y: 92 }, { x: 20, y: 46 }, { x: 20, y: 156 }],
  },
  {
    key: "indicators", href: "/reports/pre", stages: ["T3", "T4", "T5"],
    sketch: [...header, { kind: "tabs", x: 16, y: 42, w: 120, h: 14, n: 2 },
      { kind: "filters", x: 16, y: 64, w: 288, h: 14, n: 4 },
      { kind: "kpis", x: 16, y: 86, w: 288, h: 26, n: 4 },
      { kind: "bars", x: 16, y: 120, w: 186, h: 68, n: 8 },
      { kind: "donut", x: 212, y: 120, w: 92, h: 68 }],
    points: [{ x: 20, y: 46 }, { x: 20, y: 68 }, { x: 20, y: 124 }],
  },
  {
    key: "dataQuality", href: "/quality", stages: [],
    sketch: [...header, { kind: "tabs", x: 16, y: 42, w: 120, h: 14, n: 2 },
      { kind: "kpis", x: 16, y: 64, w: 288, h: 26, n: 3 },
      { kind: "checklist", x: 16, y: 98, w: 288, h: 90, n: 5 }],
    points: [{ x: 20, y: 68 }, { x: 20, y: 102 }, { x: 20, y: 46 }],
  },
];

/** Screens that follow a stage of the flow, in the order of the guide. */
export function screensForStage(stage: OnboardingStage): OnboardingScreen[] {
  return ONBOARDING_SCREENS.filter(screen => screen.stages.includes(stage));
}

/**
 * Videos recorded by the team, one slot per chapter or screen. A slot without a link shows that the video is
 * still being recorded. Only corporate hosts are accepted (see `isAllowedVideoUrl`); add the shared link here.
 */
export type OnboardingVideoSlot = "purpose" | "process" | OnboardingScreenKey;
export const ONBOARDING_VIDEO_URLS: Readonly<Record<OnboardingVideoSlot, string | null>> = {
  purpose: null,
  process: null,
  preShipment: null,
  productPortfolio: null,
  postShipment: null,
  invoiceAudit: null,
  endToEnd: null,
  indicators: null,
  dataQuality: null,
};

const allowedVideoHosts = [/^[a-z0-9-]+\.sharepoint\.com$/u, /^([a-z0-9-]+\.)?stream\.microsoft\.com$/u];

/** Video links must be HTTPS on SharePoint or Microsoft Stream, where the company keeps its recordings. */
export function isAllowedVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && allowedVideoHosts.some(host => host.test(url.hostname));
  } catch {
    return false;
  }
}

/** The link of a slot, or null when there is none yet or it is not on an allowed host. */
export function onboardingVideoUrl(slot: OnboardingVideoSlot): string | null {
  const url = ONBOARDING_VIDEO_URLS[slot];
  return url && isAllowedVideoUrl(url) ? url : null;
}

/** What the guide remembers in the browser: the open chapter and the chapters already seen. */
export type OnboardingProgress = { chapter: OnboardingChapter; seen: OnboardingChapter[] };
export type ProgressStorage = Pick<Storage, "getItem" | "setItem">;
export const onboardingStorageKey = "erp-comex-onboarding";

const isChapter = (value: unknown): value is OnboardingChapter =>
  typeof value === "string" && (ONBOARDING_CHAPTERS as readonly string[]).includes(value);

/** Reads the stored progress; nothing stored or an unknown value starts the guide from the first chapter. */
export function parseOnboardingProgress(raw: string | null | undefined): OnboardingProgress {
  const start: OnboardingProgress = { chapter: ONBOARDING_CHAPTERS[0], seen: [ONBOARDING_CHAPTERS[0]] };
  if (!raw) return start;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return start;
    const { chapter, seen } = value as { chapter?: unknown; seen?: unknown };
    if (!isChapter(chapter)) return start;
    const seenChapters = Array.isArray(seen) ? seen.filter(isChapter) : [];
    return { chapter, seen: ONBOARDING_CHAPTERS.filter(item => item === chapter || seenChapters.includes(item)) };
  } catch {
    return start;
  }
}

/** Opens a chapter and marks it as seen. */
export function visitChapter(progress: OnboardingProgress, chapter: OnboardingChapter): OnboardingProgress {
  return { chapter, seen: ONBOARDING_CHAPTERS.filter(item => item === chapter || progress.seen.includes(item)) };
}

export function writeOnboardingProgress(storage: ProgressStorage | null, progress: OnboardingProgress): void {
  try {
    storage?.setItem(onboardingStorageKey, JSON.stringify(progress));
  } catch {
    // Private windows and blocked site data keep the progress only in this page.
  }
}
