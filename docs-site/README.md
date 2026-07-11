# Super Productivity Docs Site

An [Astro Starlight](https://starlight.astro.build/) documentation site generated
from the repo's [`../docs`](../docs) folder.

`../docs` stays the single source of truth. Nothing in it is edited by this site —
a build step mirrors its Markdown into `src/content/docs` and applies the transforms
Starlight needs.

## Commands

Run from this directory:

| Command                | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `npm install`          | Install dependencies                                         |
| `npm run dev`          | Sync content, then start the dev server at `localhost:4321`  |
| `npm run build`        | Sync content, then build the static site to `./dist`         |
| `npm run preview`      | Preview the built site locally                               |
| `npm run sync-content` | Regenerate `src/content/docs` from `../docs` (no dev server) |

`src/content/docs/` is generated and git-ignored. Re-run `npm run sync-content`
(or `dev`/`build`, which run it automatically) after editing files in `../docs`.

## How content is generated

[`scripts/build-content.mjs`](scripts/build-content.mjs) walks `../docs/**/*.md` and,
for each file:

- injects a `title` from the first `# H1` (the H1 is then dropped so it isn't rendered twice);
- converts Obsidian `[[wikilinks]]` (including `#heading` anchors, `|aliases`, and
  `![[image]]` embeds) into real site links and Markdown images;
- copies referenced local images (e.g. `wiki/assets/*`) alongside their pages;
- rewrites relative Markdown links to site routes, and links that point outside
  `docs/` (source files, directories) to GitHub `blob` URLs;
- adds a per-page `editUrl` pointing at the original source file on GitHub.

Loose Markdown files at the `docs/` root are grouped under `development/` in the site.
Files whose names start with `_` (e.g. `_Sidebar.md`) are skipped.

## Configuration

Site title, sidebar groups, and theme live in
[`astro.config.mjs`](astro.config.mjs) and [`src/styles/custom.css`](src/styles/custom.css).
To enable sitemap generation and canonical URLs, set the deployed `site` URL in
`astro.config.mjs`.
