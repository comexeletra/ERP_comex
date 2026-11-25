import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { isAllowedVideoUrl, ONBOARDING_CHAPTERS, ONBOARDING_SCREEN_KEYS, ONBOARDING_SCREENS, ONBOARDING_STAGES,
  ONBOARDING_VIDEO_URLS, onboardingStorageKey, onboardingVideoUrl, parseOnboardingProgress, screensForStage,
  SKETCH_HEIGHT, SKETCH_WIDTH, visitChapter, writeOnboardingProgress } from "../lib/onboarding.ts";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const dictionaries = { ptBR, en, zhCN };
const [sidebar, page, guide, process, screens, sketch, video, styles, layout] = await Promise.all([
  source("components/AppSidebar.tsx"), source("app/onboarding/page.tsx"), source("components/OnboardingGuide.tsx"),
  source("components/OnboardingProcess.tsx"), source("components/OnboardingScreens.tsx"),
  source("components/OnboardingSketch.tsx"), source("components/OnboardingVideo.tsx"),
  source("app/styles/features/onboarding.css"), source("app/layout.tsx"),
]);

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

test("each walkthrough step has a numbered point inside the drawing, in all three languages", () => {
  for (const screen of ONBOARDING_SCREENS) {
    for (const [name, m] of Object.entries(dictionaries)) {
      const item = m.onboarding.screens.items[screen.key];
      assert.ok(item.summary && item.when, `${name}.${screen.key}`);
      assert.equal(Object.keys(item.steps).length, screen.points.length, `${name}.${screen.key}: steps × points`);
    }
    for (const point of screen.points) {
      assert.ok(point.x >= 0 && point.x <= SKETCH_WIDTH && point.y >= 0 && point.y <= SKETCH_HEIGHT, `${screen.key}: point`);
    }
    for (const block of screen.sketch) {
      assert.ok(block.x >= 0 && block.y >= 0 && block.x + block.w <= SKETCH_WIDTH && block.y + block.h <= SKETCH_HEIGHT,
        `${screen.key}: ${block.kind} leaves the drawing`);
    }
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

test("drawings are described for screen readers and carry a caption; videos open only corporate links", () => {
  assert.match(sketch, /role="img" aria-label=\{label\}/u);
  assert.match(screens, /<figcaption/u);
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
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.onboarding [^{]*\{ animation: none !important; transition: none !important; \} \}/u);
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
