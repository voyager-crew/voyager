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

const fragmentDirectories = readdirSync(primitiveDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(primitiveDirectory, entry.name, 'messages'))
  .filter((directory) => existsSync(directory))
  .sort();
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

if (failed) {
  console.error('\nFAILED: locale keys are inconsistent');
  process.exit(1);
}

console.log(
  `OK: all ${keysByLocale.size} locales are consistent (${referenceKeys.size} keys, ` +
    `${fragmentKeyCount} more in ${fragmentDirectories.length} primitive fragments)`,
);
