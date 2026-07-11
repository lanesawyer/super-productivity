/* eslint-env es6, node */
/**
 * Finds untranslated strings: leaf values in a locale file that are still
 * identical to the English source (en.json), i.e. never actually translated.
 *
 * Usage:
 *   node tools/find-untranslated.js              # summary table for all locales
 *   node tools/find-untranslated.js de           # list untranslated keys for de.json
 *   node tools/find-untranslated.js de.json       # same, extension optional
 *   node tools/find-untranslated.js de fr pt      # list keys for several locales
 *
 * Also reports keys missing from a locale entirely.
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '../src/assets/i18n');
const EN_PATH = path.join(I18N_DIR, 'en.json');

/**
 * Recursively extract all flat leaf entries from a nested translation object
 * e.g., { A: { B: "val" } } -> { "A.B": "val" }
 */
function extractLeaves(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      extractLeaves(value, fullKey, out);
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

/**
 * Values that are legitimately identical across languages -> not "untranslated".
 * - empty / whitespace-only
 * - only digits, punctuation or interpolation tokens (e.g. "{{nr}}", "W{{nr}}")
 * - language names shown in their own language (GCF.LANG.*)
 * - theme identifiers (THEMES.*)
 * - common proper nouns / technical terms
 */
const PROPER_NOUN =
  /^(OK|Ok|Super Productivity|GitHub|GitLab|Gitea|Jira|Redmine|WebDAV|CalDAV|iCal|Dropbox|OneDrive|Nextcloud|Kanban|Pomodoro|Flowtime|API|URL|ID|JQL)$/i;

function isIgnored(key, value) {
  if (typeof value !== 'string') return true;
  const v = value.trim();
  if (v === '') return true;
  if (key.startsWith('GCF.LANG.')) return true;
  if (key.startsWith('THEMES.')) return true;
  // only digits / punctuation / whitespace / interpolation tokens
  if (/^(\{\{[^}]+\}\}|[\d\s\W])*$/.test(v)) return true;
  if (PROPER_NOUN.test(v)) return true;
  return false;
}

function analyze(enLeaves, locale) {
  const locLeaves = extractLeaves(
    JSON.parse(fs.readFileSync(path.join(I18N_DIR, locale), 'utf8')),
  );
  const untranslated = [];
  const missing = [];
  for (const [key, enValue] of Object.entries(enLeaves)) {
    if (!(key in locLeaves)) {
      missing.push(key);
    } else if (!isIgnored(key, enValue) && locLeaves[key] === enValue) {
      untranslated.push(key);
    }
  }
  return { untranslated, missing };
}

function normalizeLocaleArg(arg) {
  const file = arg.endsWith('.json') ? arg : `${arg}.json`;
  if (!fs.existsSync(path.join(I18N_DIR, file))) {
    console.error(`Unknown locale: ${arg} (no ${file} in ${I18N_DIR})`);
    process.exit(1);
  }
  return file;
}

// Main
const enLeaves = extractLeaves(JSON.parse(fs.readFileSync(EN_PATH, 'utf8')));
const enTotal = Object.keys(enLeaves).length;

const args = process.argv.slice(2);

if (args.length === 0) {
  // Summary table for every locale
  const files = fs
    .readdirSync(I18N_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'en.json')
    .sort();

  console.log(`Comparing against en.json (${enTotal} strings)\n`);
  for (const file of files) {
    const { untranslated, missing } = analyze(enLeaves, file);
    const pct = ((untranslated.length / enTotal) * 100).toFixed(1);
    console.log(
      `${file.padEnd(11)} untranslated: ${String(untranslated.length).padStart(4)}/${enTotal} (${pct.padStart(4)}%)   missing: ${missing.length}`,
    );
  }
  console.log(
    `\nRun with a locale for details, e.g. "node ${path.relative(process.cwd(), __filename)} de"`,
  );
  process.exit(0);
}

// One or more specific locales -> list keys
let totalUntranslated = 0;
for (const arg of args) {
  const file = normalizeLocaleArg(arg);
  const { untranslated, missing } = analyze(enLeaves, file);
  totalUntranslated += untranslated.length;

  console.log(
    `=== ${file}: ${untranslated.length} untranslated, ${missing.length} missing ===\n`,
  );
  for (const key of untranslated) {
    console.log(`  ${key}  =  ${JSON.stringify(enLeaves[key])}`);
  }
  if (missing.length) {
    console.log(`\n  --- missing keys (${missing.length}) ---`);
    for (const key of missing) console.log(`  ${key}`);
  }
  console.log('');
}

process.exit(totalUntranslated > 0 ? 1 : 0);
