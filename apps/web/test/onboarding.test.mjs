import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { focusBadgePlacement, isAllowedVideoUrl, ONBOARDING_CHAPTERS, ONBOARDING_SCREEN_KEYS, ONBOARDING_SCREENS, ONBOARDING_SHOT_SIZES,
  ONBOARDING_STAGES, ONBOARDING_VIDEO_URLS, onboardingShotSrc, onboardingStorageKey, onboardingVideoUrl,
  parseOnboardingProgress, screensForStage, visitChapter, writeOnboardingProgress } from "../lib/onboarding.ts";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const dictionaries = { ptBR, en, zhCN };
const [sidebar, page, guide, process, screens, video, styles, layout] = await Promise.all([
  source("components/AppSidebar.tsx"), source("app/onboarding/page.tsx"), source("components/OnboardingGuide.tsx"),
  source("components/OnboardingProcess.tsx"), source("components/OnboardingScreens.tsx"),
  source("components/OnboardingVideo.tsx"), source("app/styles/features/onboarding.css"), source("app/layout.tsx"),
]);
const shotsFolder = new URL("../public/onboarding/", import.meta.url);

/** Width and height of a PNG, read from its IHDR chunk. */
async function pngSize(url) {
  const bytes = await readFile(url);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", url.pathname);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the guide opens from the top of the sidebar for every role", () => {
  assert.match(page, /<OnboardingGuide \/>/u);
  assert.match(sidebar, /\{ label: "start", items: \[\s*\{ label: "onboarding", href: "\/onboarding", icon: "guide" \}/u);
  assert.match(sidebar, /const groups: SidebarGroup\[\] = \[\s*\{ label: "start"/u);
  for (const [name, m] of Object.entries(dictionaries)) {
    assert.ok(m.sidebar.groups.start && m.sidebar.items.onboarding, name);
  }
});

test("the guide has three chapters in order: purpose, process and screens", () => {
  assert.deepEqual([...ONBOARDING_CHAPTERS], ["purpose", "process", "screens"]);
  for (const [name, m] of Object.entries(dictionaries)) {
    for (const chapter of ONBOARDING_CHAPTERS) assert.ok(m.onboarding.chapters[chapter], `${name}.${chapter}`);
  }
});

test("each screen of the guide is the sidebar item with the same name and address", () => {
  assert.deepEqual(ONBOARDING_SCREENS.map(screen => screen.key), [...ONBOARDING_SCREEN_KEYS]);
  for (const screen of ONBOARDING_SCREENS) {
    assert.match(sidebar, new RegExp(`\\{ label: "${screen.key}", href: "${screen.href.replace(/\//gu, "\\/")}"`, "u"), screen.key);
  }
});

test("every stage of the flow points to at least one screen", () => {
  for (const stage of ONBOARDING_STAGES) assert.ok(screensForStage(stage).length > 0, stage);
  for (const screen of ONBOARDING_SCREENS) {
    for (const stage of screen.stages) assert.ok(ONBOARDING_STAGES.includes(stage), `${screen.key}: ${stage}`);
  }
  assert.deepEqual(screensForStage("T0").map(screen => screen.key), ["endToEnd"]);
});

test("each walkthrough step has a print and a highlighted area inside it, in all three languages", () => {
  for (const screen of ONBOARDING_SCREENS) {
    assert.ok(screen.steps.length >= 2, screen.key);
    for (const [name, m] of Object.entries(dictionaries)) {
      const item = m.onboarding.screens.items[screen.key];
      assert.ok(item.summary && item.when, `${name}.${screen.key}`);
      assert.equal(Object.keys(item.steps).length, screen.steps.length, `${name}.${screen.key}: texts × prints`);
    }
    for (const [k, { shot, box }] of screen.steps.entries()) {
      assert.ok(shot in ONBOARDING_SHOT_SIZES, `${screen.key} ${k + 1}: ${shot}`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 100 && box.y + box.h <= 100,
        `${screen.key} ${k + 1}: the highlight leaves the print`);
    }
  }
});

test("the step number sits outside the highlighted control whenever the print leaves room for it", () => {
  assert.equal(focusBadgePlacement({ x: 95, y: 10.7, w: 4.8, h: 4.6 }), "above");
  assert.equal(focusBadgePlacement({ x: 3, y: .9, w: 95, h: 12.7 }), "below");
  assert.equal(focusBadgePlacement({ x: 3, y: .7, w: 95, h: 98.9 }), "inside");
  assert.match(screens, /<span className=\{badgeClass\[focusBadgePlacement\(step\.box\)\]\}>/u);
});

test("every print exists with the declared size and every print in the folder is used", async () => {
  const used = new Set(ONBOARDING_SCREENS.flatMap(screen => screen.steps.map(step => step.shot)));
  assert.deepEqual([...used].sort(), Object.keys(ONBOARDING_SHOT_SIZES).sort());
  const files = (await readdir(shotsFolder)).sort();
  assert.deepEqual(files, Object.keys(ONBOARDING_SHOT_SIZES).map(shot => `${shot}.png`).sort());
  for (const [shot, size] of Object.entries(ONBOARDING_SHOT_SIZES)) {
    assert.equal(onboardingShotSrc(shot), `/onboarding/${shot}.png`);
    assert.deepEqual(await pngSize(new URL(`${shot}.png`, shotsFolder)), { ...size }, shot);
  }
});

test("the process chapter takes the stages and deadlines from the End to End model", () => {
  assert.match(process, /buildE2eFlow\(DEFAULT_E2E_FLOW_CONFIG, \{ mts, air \}, m\)/u);
  assert.match(process, /<E2eModelSummary flow=\{model\}/u);
  assert.match(process, /<E2eFlowRail phases=\{model\.phases\}/u);
  assert.match(process, /<E2eModelDetails flow=\{model\}/u);
  assert.match(process, /className="e2e-flow onboarding-process"/u);
  // No deadline is written in the guide texts: a change of target in e2e-flow.ts reaches the guide by itself.
  for (const [name, m] of Object.entries(dictionaries)) {
    assert.doesNotMatch(JSON.stringify(m.onboarding), /\d+\s*(dias|days|d\b|天)/u, name);
  }
});

test("prints are described for screen readers and carry the step as caption; videos open only corporate links", () => {
  assert.match(screens, /alt=\{t\.screens\.figure\(name, current \+ 1\)\}/u);
  assert.match(screens, /<span className="sr-only">\{t\.screens\.enlarge\}<\/span>/u);
  assert.match(screens, /<figcaption aria-live="polite">/u);
  assert.match(screens, /<span className="onboarding-shot-focus" aria-hidden="true"/u);
  assert.match(video, /target="_blank" rel="noopener noreferrer"/u);
  assert.match(video, /onboardingVideoUrl\(slot\)/u);
  for (const [slot, url] of Object.entries(ONBOARDING_VIDEO_URLS)) {
    if (url !== null) assert.ok(isAllowedVideoUrl(url), `${slot}: ${url}`);
  }
  assert.equal(isAllowedVideoUrl("https://eletra.sharepoint.com/:v:/s/comex/video"), true);
  assert.equal(isAllowedVideoUrl("https://web.microsoftstream.com/video/1"), false);
  assert.equal(isAllowedVideoUrl("https://stream.microsoft.com/video/1"), true);
  assert.equal(isAllowedVideoUrl("http://eletra.sharepoint.com/video"), false);
  assert.equal(isAllowedVideoUrl("https://eletra.sharepoint.com.attacker.example/video"), false);
  assert.equal(isAllowedVideoUrl("https://user:secret@eletra.sharepoint.com/video"), false);
  assert.equal(isAllowedVideoUrl("javascript:alert(1)"), false);
  assert.equal(onboardingVideoUrl("process"), ONBOARDING_VIDEO_URLS.process);
});

test("the walkthrough animation stands still with reduced motion and loads after the shared styles", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.onboarding \*, \.onboarding \*::after \{ animation: none !important; transition: none !important; \} \}/u);
  // The highlight slides between areas and pulses; the print fades in when the step changes to another print.
  assert.match(styles, /\.onboarding-shot-focus \{[^}]*transition: left/u);
  assert.match(styles, /\.onboarding-shot-focus::after \{[^}]*animation: onboarding-pulse/u);
  assert.match(styles, /\.onboarding-shot-image \{[^}]*animation: onboarding-fade/u);
  assert.match(layout, /import "\.\/styles\/features\/onboarding\.css";/u);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

test("the guide remembers the open chapter and the chapters seen, and starts over when the stored value is odd", () => {
  const start = { chapter: "purpose", seen: ["purpose"] };
  for (const raw of [null, undefined, "", "not json", "null", "[]", '{"chapter":"other"}']) {
    assert.deepEqual(parseOnboardingProgress(raw), start, String(raw));
  }

  const storage = memoryStorage();
  const progress = visitChapter(visitChapter(parseOnboardingProgress(null), "screens"), "process");
  assert.deepEqual(progress, { chapter: "process", seen: ["purpose", "process", "screens"] });
  writeOnboardingProgress(storage, progress);
  assert.deepEqual(parseOnboardingProgress(storage.getItem(onboardingStorageKey)), progress);
  assert.doesNotThrow(() => writeOnboardingProgress(blocked, progress));
  assert.doesNotThrow(() => writeOnboardingProgress(null, progress));

  assert.deepEqual(parseOnboardingProgress('{"chapter":"screens","seen":["x","purpose"]}'),
    { chapter: "screens", seen: ["purpose", "screens"] });
});

test("the guide page uses the shared header, the chapter tabs and remembers the progress", () => {
  assert.match(guide, /<PageHeader eyebrow=\{t\.eyebrow\} title=\{t\.title\(productName\)\}/u);
  assert.match(guide, /<nav className="tabs onboarding-chapters" aria-label=\{t\.chaptersLabel\}>/u);
  assert.match(guide, /useSyncExternalStore\(subscribe, storedProgress, \(\) => ""\)/u);
  assert.match(guide, /parseOnboardingProgress\(/u);
  assert.match(guide, /writeOnboardingProgress\(/u);
});
