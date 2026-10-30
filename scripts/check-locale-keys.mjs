#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const localeDirectory = 'src/locales';
// A primitive's own strings: <primitive>/messages/<locale>.json, merged into the app's translations.
const primitiveDirectory = 'src/features/plugins/verbs';
const locales = readdirSync(localeDirectory).sort();
const keysByLocale = new Map();
const messagesByLocale = new Map();

const readMessages = (path) => JSON.parse(readFileSync(path, 'utf8'));
// `{name}` placeholders are filled by name, so a translation must keep exactly the English set.
const placeholdersOf = (entry) =>
  [...new Set([...(entry?.message ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1]))]
    .sort()
    .join(',');
const placeholderMismatches = (enMessages, messages) =>
  Object.keys(enMessages).filter(
    (key) => key in messages && placeholdersOf(enMessages[key]) !== placeholdersOf(messages[key]),
  );

for (const locale of locales) {
  const messagesPath = join(localeDirectory, locale, 'messages.json');
  if (!existsSync(messagesPath)) continue;
  const messages = readMessages(messagesPath);
  messagesByLocale.set(locale, messages);
  keysByLocale.set(locale, new Set(Object.keys(messages)));
}

const referenceKeys = keysByLocale.get('en');
if (!referenceKeys) {
  console.error('ERROR: en locale not found');
  process.exit(1);
}

let failed = false;
for (const [locale, keys] of keysByLocale) {
  if (locale === 'en') continue;

  const missing = [...referenceKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !referenceKeys.has(key));
  const mismatched = placeholderMismatches(
    messagesByLocale.get('en'),
    messagesByLocale.get(locale),
  );
  if (missing.length === 0 && extra.length === 0 && mismatched.length === 0) continue;

  failed = true;
  console.error(
    `${locale}: missing=${missing.length} extra=${extra.length} placeholders=${mismatched.length}`,
  );
  for (const key of missing.slice(0, 5)) console.error(`  - ${key}`);
  for (const key of extra.slice(0, 5)) console.error(`  + ${key}`);
  for (const key of mismatched.slice(0, 5)) console.error(`  ~ ${key}`);
}

const fragmentDirectories = [
  ...readdirSync(primitiveDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(primitiveDirectory, entry.name, 'messages'))
    .filter((directory) => existsSync(directory)),
  'src/pages/content/panelShell/messages',
  'src/pages/panel/messages',
].sort();
const fragmentOwnerByKey = new Map();
let fragmentKeyCount = 0;

for (const directory of fragmentDirectories) {
  const fail = (message) => {
    failed = true;
    console.error(`${directory}: ${message}`);
  };
  const files = new Set(readdirSync(directory));
  for (const locale of keysByLocale.keys()) {
    if (!files.has(`${locale}.json`)) fail(`missing locale file ${locale}.json`);
  }
  for (const file of files) {
    if (!keysByLocale.has(file.replace(/\.json$/, ''))) fail(`unexpected file ${file}`);
  }
  if (!files.has('en.json')) continue;

  const enPath = join(directory, 'en.json');
  const enMessages = readMessages(enPath);
  const enKeys = new Set(Object.keys(enMessages));
  fragmentKeyCount += enKeys.size;
  for (const key of enKeys) {
    if (referenceKeys.has(key)) {
      fail(`en.json key ${key} is also in ${localeDirectory}/en/messages.json`);
    } else if (fragmentOwnerByKey.has(key)) {
      fail(`en.json key ${key} is also in ${fragmentOwnerByKey.get(key)}`);
    } else {
      fragmentOwnerByKey.set(key, enPath);
    }
  }

  for (const locale of keysByLocale.keys()) {
    if (locale === 'en' || !files.has(`${locale}.json`)) continue;
    const path = join(directory, `${locale}.json`);
    const messages = readMessages(path);
    const keys = new Set(Object.keys(messages));
    for (const key of enKeys) if (!keys.has(key)) fail(`${locale}.json is missing key ${key}`);
    for (const key of keys) if (!enKeys.has(key)) fail(`${locale}.json has extra key ${key}`);
    for (const key of placeholderMismatches(enMessages, messages)) {
      fail(`${locale}.json key ${key} has different {placeholders} from en.json`);
    }
  }
}

// The Voyager macOS app (Safari): one .lproj per locale, holding exactly the keys its Swift code
// reads through voyagerLocalized(key, english), with the same %@ count, and English matching code.
const appDirectory = 'Voyager/App';
// Checkouts without the Safari app (such as test fixtures) have only the web locales to check.
const swiftDirectories = existsSync(appDirectory) ? [appDirectory, 'Voyager/Shared'] : [];
const appleLocalization = (locale) =>
  ({ zh: 'zh-Hans', zh_TW: 'zh-Hant' })[locale] ?? locale.replace('_', '-');
const unescape = (text) => text.replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
const readStrings = (path) => {
  const entries = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";$/);
    if (match) entries.set(unescape(match[1]), unescape(match[2]));
  }
  return entries;
};
const swiftEnglish = new Map();
for (const directory of swiftDirectories) {
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.swift'))) {
    const source = readFileSync(join(directory, file), 'utf8');
    for (const match of source.matchAll(
      /voyagerLocalized\(\s*"([\w.]+)",\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
    )) {
      swiftEnglish.set(match[1], unescape(match[2]));
    }
  }
}
const formatCount = (text) => (text.match(/%@/g) ?? []).length;
let mainStringKeys = null;
for (const locale of swiftDirectories.length > 0 ? keysByLocale.keys() : []) {
  const fail = (message) => {
    failed = true;
    console.error(`${appDirectory}/${appleLocalization(locale)}.lproj: ${message}`);
  };
  const lproj = join(appDirectory, `${appleLocalization(locale)}.lproj`);
  if (!existsSync(join(lproj, 'Localizable.strings'))) {
    fail('missing Localizable.strings');
    continue;
  }
  const strings = readStrings(join(lproj, 'Localizable.strings'));
  for (const [key, english] of swiftEnglish) {
    if (!strings.has(key)) fail(`missing key ${key}`);
    else if (locale === 'en' && strings.get(key) !== english) fail(`${key} differs from Swift`);
    else if (formatCount(strings.get(key)) !== formatCount(english)) fail(`${key} has other %@`);
  }
  for (const key of strings.keys()) if (!swiftEnglish.has(key)) fail(`unused key ${key}`);
  if (locale === 'en') continue;
  // Base.lproj/Main.storyboard is English; every other locale translates the same menu items.
  const menu = existsSync(join(lproj, 'Main.strings'))
    ? readStrings(join(lproj, 'Main.strings'))
    : null;
  const keys = menu ? [...menu.keys()].sort().join(',') : '';
  mainStringKeys ??= keys;
  if (!menu || keys !== mainStringKeys) fail('Main.strings differs from the other locales');
}

if (failed) {
  console.error('\nFAILED: locale keys are inconsistent');
  process.exit(1);
}

console.log(
  `OK: all ${keysByLocale.size} locales are consistent (${referenceKeys.size} keys, ` +
    `${fragmentKeyCount} more in ${fragmentDirectories.length} message fragments, ` +
    `${swiftEnglish.size} in the Safari app)`,
);
