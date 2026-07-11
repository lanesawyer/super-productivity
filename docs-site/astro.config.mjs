// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const GITHUB_REPO = 'https://github.com/super-productivity/super-productivity';

// For GitHub Pages (or any sub-path deploy) set PAGES_SITE and PAGES_BASE.
// Locally both are unset, so the site is served from the root ("/").
// PAGES_BASE must match the prefix applied to generated links in
// scripts/build-content.mjs (both read the same env var).
const SITE = process.env.PAGES_SITE || undefined;
const BASE = process.env.PAGES_BASE || undefined;

// https://astro.build/config
export default defineConfig({
  ...(SITE ? { site: SITE } : {}),
  ...(BASE ? { base: BASE } : {}),
  integrations: [
    starlight({
      title: 'Super Productivity Docs',
      description:
        'Documentation for Super Productivity — a to-do list and time-tracking app for deep work.',
      social: [{ icon: 'github', label: 'GitHub', href: GITHUB_REPO }],
      // Content is generated into src/content/docs by scripts/build-content.mjs.
      // The "Edit page" link is set per-page (frontmatter editUrl) to point at the
      // original source file under docs/, so this global default is disabled.
      editLink: undefined,
      sidebar: [
        {
          label: 'User Guide',
          items: [
            {
              label: 'Quickstarts',
              items: [{ autogenerate: { directory: 'wiki/quickstarts' } }],
            },
            { label: 'How-To', items: [{ autogenerate: { directory: 'wiki/how-to' } }] },
            {
              label: 'Reference',
              items: [{ autogenerate: { directory: 'wiki/reference' } }],
            },
            {
              label: 'Concepts',
              items: [{ autogenerate: { directory: 'wiki/concepts' } }],
            },
            {
              label: 'Meta & Maintenance',
              items: [{ autogenerate: { directory: 'wiki/meta' } }],
            },
          ],
        },
        { label: 'Development', items: [{ autogenerate: { directory: 'development' } }] },
        {
          label: 'Architecture: Sync & Op-Log',
          items: [{ autogenerate: { directory: 'sync-and-op-log' } }],
        },
        { label: 'Plans', items: [{ autogenerate: { directory: 'plans' } }] },
        {
          label: 'Long-Term Plans',
          items: [{ autogenerate: { directory: 'long-term-plans' } }],
        },
        { label: 'Research', items: [{ autogenerate: { directory: 'research' } }] },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
