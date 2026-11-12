/**
 * Takes every Create mode guide screenshot for one language on the replica
 * (docs/guide/create-mode.md and its locales), into docs/public/assets/.
 *
 *   bun scripts/docs-shots/run.ts &               a fresh rig per language
 *   bun scripts/docs-shots/createMode.ts zh       or en
 *
 * Every image is Voyager's own UI, taken live from dist_chrome_dev; only the
 * page behind it and the AI's replies are staged.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

import { SCENES, json, type Lang } from './createModeScenes';
import { type Box, Rig, pause } from './rig';

const lang = process.argv[2] as Lang;
if (!(lang in SCENES)) throw new Error('usage: createMode.ts zh|en');
const scene = SCENES[lang];
const ASSETS = path.resolve(import.meta.dir, '../../docs/public/assets');
const out = (name: string, suffix = lang) => path.join(ASSETS, `create-mode-${name}-${suffix}.png`);

const rig = await Rig.connect();
await rig.setup();
// Every feature tour counts as seen, so none covers a shot or blocks a click.
const tours = execSync(
  `grep -rhoE "COACHMARK_ID = '[^']+'" ${path.resolve(import.meta.dir, '../../src')} --include=*.ts`,
  { encoding: 'utf8' },
)
  .match(/'[^']+'/g)!
  .map((id) => id.slice(1, -1));
await rig.settings({ action: 'set', values: { language: lang, gvCoachmarksSeen: tours } });
await rig.evalPage('location.reload()').catch(() => {});
await pause(3000);
await rig.setup();

/** A page element's box, from a page expression that yields an Element. */
async function box(expression: string): Promise<Box> {
  const found = (await rig.evalPage(`(() => { const el = ${expression}; if (!el) return null;
    el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)) as Box | null;
  if (!found) throw new Error(`nothing for ${expression}`);
  return found;
}

const center = (b: Box) => rig.click(b.x + b.width / 2, b.y + b.height / 2);
const lastControl = `[...document.querySelectorAll('.gv-create-control')].at(-1)`;
const controlButton = `${lastControl}?.shadowRoot?.querySelector('.bar button')`;

async function waitFor(expression: string, what: string, ms = 6000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await rig.evalPage(`!!(${expression})`))) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await pause(150);
  }
}

async function dismissTour(): Promise<void> {
  const close = `document.querySelector('.gv-coach.--show, .gv-coach-enabled')?.querySelector('button[aria-label]')`;
  for (let i = 0; i < 6 && (await rig.evalPage(`!!(${close})`)); i += 1) {
    await center(await box(close));
    await pause(400);
  }
}

async function openPanel(tab: 'create' | 'features'): Promise<void> {
  if (!(await rig.panelFrame())) {
    await rig.click(820, 200);
    await rig.key('v', 'alt');
    await pause(900);
  }
  await rig.pclick(`#panel-tab-${tab}`);
  await pause(700);
  await rig.evalPanel('document.activeElement?.blur()');
}

async function closePanel(): Promise<void> {
  if (await rig.panelFrame()) {
    await rig.key('Escape');
    await pause(600);
  }
}

async function send(text: string): Promise<void> {
  await center(await box(`document.querySelector('.ql-editor')`));
  if (text) await rig.type(text);
  await center(await box(`document.querySelector('.rp-send button')`));
}

/** A finished exchange in this Create chat, then its reply's Voyager control. */
async function stageReply(ask: string, intro: string, manifest: unknown): Promise<void> {
  await rig.evalPage(
    `__replica.exchange(${JSON.stringify(ask)}, { text: ${JSON.stringify(intro)}, code: ${JSON.stringify(json(manifest))} })`,
  );
  await pause(800);
}

/** The control under the latest reply, with a little of the page around it. */
async function shootControl(name: string): Promise<void> {
  const control = await box(lastControl);
  const width =
    (await rig.evalPage(`(() => { const bar = ${lastControl}.shadowRoot.querySelector('.bar');
    return Math.max(...[...bar.children].map((c) => c.getBoundingClientRect().right)) - bar.getBoundingClientRect().left; })()`)) as number;
  await rig.shot(out(name), {
    x: control.x - 8,
    y: control.y,
    width: width + 16,
    height: control.height,
  });
}

await dismissTour();

// The model notice: the replica's model switch reads Flash.
await rig.evalPage(`__replica.setModel('Flash')`);
await openPanel('create');
await rig.pshot(out('model'), '.create-model-warn', 8);
await rig.evalPage(`__replica.setModel('Argon')`);
await rig.pclick('#panel-tab-features');
await rig.pclick('#panel-tab-create');
await pause(700);

// Asking, and what the page-structure switch adds.
await rig.pclick('#panel-create-request');
await rig.type(scene.request);
await rig.evalPanel('document.activeElement?.blur()');
await rig.pshot(out('ask'), 'section.create-ask', 16);
for (const scheme of ['light', 'dark'] as const) {
  await rig.evalPage(`__replica.setTheme('${scheme}')`);
  await pause(800);
  await rig.shot(out('hero', `${lang}-${scheme}`), undefined, 0.5);
}
await rig.evalPage(`__replica.setTheme('light')`);
await pause(800);
await rig.pclick('details.create-fold summary');
await pause(400);
// Bring the whole preview into the panel's view, clear of its bottom edge.
await rig.evalPanel(
  `document.activeElement?.blur(); document.querySelector('details.create-fold').scrollIntoView({ block: 'center' })`,
);
await pause(300);
await rig.pshot(out('structure'), 'details.create-fold', 6);
await rig.pclick('details.create-fold summary');

// Create on this page, the reply, the review, and installing it.
await rig.evalPage(
  `__replica.queueReply({ text: ${JSON.stringify(scene.narrowIntro)}, code: ${JSON.stringify(json(scene.narrow))} })`,
);
await rig.pclick(scene.labels.create);
await waitFor(
  `document.querySelector('.ql-editor').innerText.length > 100 && !document.querySelector('iframe')`,
  'the filled composer',
);
await send('');
await waitFor(controlButton, 'the reply control');
await pause(500);
await shootControl('reply');
await center(await box(controlButton));
await pause(1200);
await rig.pshot(out('review'), 'section.create-review', 16);
await rig.pclick(scene.labels.install);
await pause(1000);
await rig.pclick(scene.labels.close);
await closePanel();

// A reply that cannot be installed: the next version forgets which site it is for.
const { matches: _forgotten, ...noSite } = { ...scene.narrow, version: '1.1.0' };
await rig.evalPage(
  `__replica.queueReply({ text: ${JSON.stringify(scene.replyIntro)}, code: ${JSON.stringify(json(noSite))} })`,
);
await send(scene.again);
await waitFor(
  `${lastControl}?.shadowRoot?.querySelector('.state.problem')`,
  'the rejected control',
);
await pause(400);
await shootControl('rejected');

// Two more creations: rounder code blocks, and one aimed at a banner this page lacks.
for (const [ask, manifest] of [
  [scene.cornersAsk, scene.corners],
  [scene.bannerAsk, scene.banner],
] as const) {
  await stageReply(ask, '', manifest);
  await center(await box(controlButton));
  await pause(1200);
  await rig.pclick(scene.labels.install);
  await pause(1000);
  await rig.pclick(scene.labels.close);
  await closePanel();
}

// A creation that runs code, reviewed but not turned on.
await stageReply(scene.counterAsk, '', scene.counter);
await center(await box(controlButton));
await pause(1200);
await rig.pshot(out('scripted'), 'section.create-review', 16);
await rig.pclick(scene.labels.cancel);
await closePanel();

// My creations, with the automatic check's line on the banner one.
await openPanel('features');
await pause(800);
await rig.pshot(out('creations'), '[data-group="creations"]', 0);
await closePanel();

rig.close();
console.log(`done: ${lang}`);
