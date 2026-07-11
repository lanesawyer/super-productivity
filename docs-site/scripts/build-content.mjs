// Generates the Starlight content collection from the repo's docs/ folder.
//
// docs/ stays the single source of truth (untouched). This script mirrors its
// markdown into src/content/docs, applying the transforms Starlight needs:
//   - inject a `title` (from the first H1, which is then removed from the body)
//   - convert Obsidian [[wikilinks]] into real site links
//   - rewrite relative Markdown / source-file links to resolve on the site or
//     fall back to GitHub blob URLs when they point outside docs/
//   - add a per-page `editUrl` pointing at the original source file on GitHub
//
// Two passes: first build a map of every source file -> its output slug so that
// links (which may target files that are reorganized on output) always resolve.

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SITE_ROOT, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const OUT_DIR = path.join(SITE_ROOT, 'src', 'content', 'docs');

const GITHUB_BLOB =
  'https://github.com/super-productivity/super-productivity/blob/master';

// Sub-path prefix for the deploy (e.g. "/super-productivity" on GitHub Pages).
// Must match `base` in astro.config.mjs; empty for a root deploy / local dev.
const BASE = (process.env.PAGES_BASE || '').replace(/\/+$/, '');

/** Prefix a root-absolute site path with the deploy base. */
function withBase(absPath) {
  return `${BASE}${absPath}`;
}

/** Turn one path segment into a URL-friendly, deterministic slug. */
function slugifySegment(seg) {
  return seg
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** GitHub-style heading anchor slug, for [[Page#Heading]] targets. */
function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// The wiki uses a Diátaxis structure encoded in each file's leading number.
// Route files into per-section subfolders so they become sidebar groups.
const WIKI_SECTIONS = {
  0: 'meta',
  1: 'quickstarts',
  2: 'how-to',
  3: 'reference',
  4: 'concepts',
};

function wikiSection(filename) {
  const m = /^(\d+)/.exec(filename);
  return m ? WIKI_SECTIONS[Number(m[1])] : undefined;
}

/** Map a source path (relative to docs/) to its output path (relative to OUT_DIR). */
function outputRelPath(srcRel) {
  const parts = srcRel.split('/');
  // Loose Markdown files at the docs/ root are grouped under "development/".
  if (parts.length === 1) {
    parts.unshift('development');
  } else if (parts[0] === 'wiki' && parts.length === 2) {
    const section = wikiSection(parts[1]);
    if (section) parts.splice(1, 0, section);
  }
  return parts.map(slugifySegment).join('/');
}

/** Output path for an asset: slugify directories but keep the original filename. */
function outputAssetRel(assetSrcRel) {
  const parts = assetSrcRel.split('/');
  const file = parts.pop();
  return [...parts.map(slugifySegment), file].join('/');
}

/** A readable label from a wiki page name like "2.01-Downloads and Install". */
function labelFromName(name) {
  return name
    .replace(/^\d+(\.\d+[a-z]?)*[-.\s]*/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function yamlQuote(str) {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function extractTitle(body, srcRel) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) {
      lines.splice(i, 1);
      // Drop a single blank line left behind by the removed heading.
      if (lines[i] !== undefined && lines[i].trim() === '') lines.splice(i, 1);
      return { title: m[1].trim(), body: lines.join('\n') };
    }
    // Only treat a leading heading as the title; stop at real content.
    if (lines[i].trim() !== '' && !/^#/.test(lines[i])) break;
  }
  const base = path.basename(srcRel).replace(/\.md$/i, '');
  const fallback = labelFromName(base) || base;
  return { title: fallback, body };
}

/**
 * Build the lookup maps.
 * @returns {{ bySrcRel: Map<string,string>, byName: Map<string,string> }}
 *   bySrcRel: source path (relative to docs/) -> output slug
 *   byName:   lowercased filename without extension -> output slug (for wikilinks)
 */
function buildMaps(files) {
  const bySrcRel = new Map();
  const byName = new Map();
  for (const abs of files) {
    const srcRel = path.relative(DOCS_DIR, abs).split(path.sep).join('/');
    const base = path.basename(srcRel);
    if (base.startsWith('_')) continue; // _Sidebar.md, _Footer.md, etc.
    const slug = outputRelPath(srcRel).replace(/\.md$/i, '');
    bySrcRel.set(srcRel, slug);
    byName.set(base.replace(/\.md$/i, '').toLowerCase(), slug);
  }
  return { bySrcRel, byName };
}

function rewriteWikiLinks(body, byName, srcRel, pageSlug, assets) {
  const srcDir = path.posix.dirname(srcRel);
  const pageDir = path.posix.dirname(pageSlug);
  return body.replace(/!?\[\[([^\]]+)\]\]/g, (full, inner) => {
    let target = inner;
    let alias = '';
    const pipe = inner.indexOf('|');
    if (pipe !== -1) {
      target = inner.slice(0, pipe);
      alias = inner.slice(pipe + 1).trim();
    }

    // Image embed: [[assets/foo.png]] / ![[assets/foo.png]].
    if (IMAGE_EXT.test(target.trim())) {
      const assetSrcRel = path.posix.normalize(path.posix.join(srcDir, target.trim()));
      if (!existsSync(path.join(DOCS_DIR, assetSrcRel))) {
        // Doesn't exist on disk (e.g. a syntax example) — leave untouched.
        return full;
      }
      const assetOutRel = outputAssetRel(assetSrcRel);
      assets.set(assetSrcRel, assetOutRel);
      const rel = path.posix.relative(pageDir, assetOutRel);
      const altText = alias || path.basename(target.trim()).replace(IMAGE_EXT, '');
      return `![${altText}](${rel})`;
    }

    let heading = '';
    const hash = target.indexOf('#');
    if (hash !== -1) {
      heading = target.slice(hash + 1);
      target = target.slice(0, hash);
    }
    const key = target.trim().toLowerCase();
    const slug = byName.get(key);
    const label = alias || labelFromName(target.trim()) || target.trim();
    if (!slug) {
      // Unknown target (e.g. a page that does not exist) — keep readable text.
      console.warn(`  [wikilink] unresolved "${inner}" in ${srcRel}`);
      return label;
    }
    const anchor = heading ? `#${slugifyHeading(heading)}` : '';
    return `[${label}](${withBase(`/${slug}`)}${anchor})`;
  });
}

function rewriteRelativeLinks(body, bySrcRel, srcRel) {
  const srcDir = path.posix.dirname(srcRel);
  return body.replace(/(\]\()([^)\s]+)(\))/g, (full, open, url, close) => {
    if (/^(https?:|mailto:|#|\/)/i.test(url)) return full;
    if (IMAGE_EXT.test(url.replace(/[#?].*$/, ''))) return full; // local images

    let target = url;
    let suffix = '';
    const hashIdx = target.search(/[#?]/);
    if (hashIdx !== -1) {
      suffix = target.slice(hashIdx);
      target = target.slice(0, hashIdx);
    }
    if (target === '') return full; // pure anchor

    // Resolve relative to the source file's directory, within docs/.
    const resolvedFromDocs = path.posix.normalize(path.posix.join(srcDir, target));

    // In-docs Markdown link -> site route.
    if (/\.md$/i.test(target) && bySrcRel.has(resolvedFromDocs)) {
      return `${open}${withBase(`/${bySrcRel.get(resolvedFromDocs)}`)}${suffix}${close}`;
    }

    // Anything else (source files, directories, docs paths that escape docs/)
    // -> GitHub. Compute the repo-relative path.
    const repoRel = path.posix
      .normalize(path.posix.join('docs', srcDir, target))
      .replace(/^(\.\.\/)+/, '');
    return `${open}${GITHUB_BLOB}/${repoRel}${suffix}${close}`;
  });
}

async function writeIndexPage() {
  const content = `---
title: Super Productivity Documentation
description: Guides, references, and architecture notes for Super Productivity.
template: splash
hero:
  tagline: A to-do list and time tracker for deep, focused work — your way.
  actions:
    - text: Get started
      link: ${withBase('/wiki/quickstarts/1.01-first-steps/')}
      icon: right-arrow
      variant: primary
    - text: View on GitHub
      link: https://github.com/super-productivity/super-productivity
      icon: external
      variant: minimal
---

import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid stagger>
  <Card title="User Guide" icon="open-book">
    Learn the app: [first steps](${withBase('/wiki/quickstarts/1.01-first-steps/')}), the [Today view](${withBase('/wiki/concepts/4.01-the-today-view/')}), sync, and more.
  </Card>
  <Card title="Development" icon="laptop">
    [Set up your environment](${withBase('/wiki/how-to/2.16-set-up-development-environment/')}), build a [plugin](${withBase('/development/plugin-development/')}), and add integrations.
  </Card>
  <Card title="Architecture" icon="setting">
    How [sync and the op-log](${withBase('/sync-and-op-log/readme/')}) work under the hood.
  </Card>
  <Card title="Plans & Research" icon="rocket">
    Long-term direction and design explorations for the project.
  </Card>
</CardGrid>
`;
  await fs.writeFile(path.join(OUT_DIR, 'index.mdx'), content, 'utf8');
}

async function main() {
  const files = await walk(DOCS_DIR);
  const { bySrcRel, byName } = buildMaps(files);

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const seenSlugs = new Map();
  const assets = new Map(); // asset source (rel to docs) -> output path (rel to OUT_DIR)
  let written = 0;

  for (const abs of files) {
    const srcRel = path.relative(DOCS_DIR, abs).split(path.sep).join('/');
    if (!bySrcRel.has(srcRel)) continue; // skipped (underscore-prefixed)
    const slug = bySrcRel.get(srcRel);

    if (seenSlugs.has(slug)) {
      console.warn(`  [slug] collision "${slug}" (${srcRel} vs ${seenSlugs.get(slug)})`);
    }
    seenSlugs.set(slug, srcRel);

    const raw = await fs.readFile(abs, 'utf8');
    const { title, body: noTitle } = extractTitle(raw, srcRel);
    let body = rewriteWikiLinks(noTitle, byName, srcRel, slug, assets);
    body = rewriteRelativeLinks(body, bySrcRel, srcRel);

    const frontmatter = [
      '---',
      `title: ${yamlQuote(title)}`,
      `slug: ${yamlQuote(slug)}`,
      `editUrl: ${yamlQuote(`${GITHUB_BLOB}/docs/${srcRel}`)}`,
      '---',
      '',
    ].join('\n');

    const outPath = path.join(OUT_DIR, `${slug}.md`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, frontmatter + body.replace(/^\n+/, ''), 'utf8');
    written++;
  }

  for (const [assetSrcRel, assetOutRel] of assets) {
    const from = path.join(DOCS_DIR, assetSrcRel);
    const to = path.join(OUT_DIR, assetOutRel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }

  await writeIndexPage();
  console.log(
    `Generated ${written} pages + index and ${assets.size} assets into src/content/docs`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
