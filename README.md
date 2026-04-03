# Warframe Mastery Tracker

Static Svelte app for tracking Warframe and Weapon progression, hosted on GitHub Pages.

The tracker stores your progress in browser localStorage and supports JSON import/export.

![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2Factuallyatiger%2Fwf-mastery-tracker%2Factions%2Fworkflows%2F255610392%2Fruns%3Fstatus%3Dcompleted%26per_page%3D1&query=%24.workflow_runs%5B0%5D.run_started_at&label=Last%20Data%20Update)


## What It Tracks

- Main blueprint ownership per item
- Component blueprint ownership per item (for example, Warframe Neuroptics/Chassis/Systems)
- Variable recipe requirements per item (from Public Export recipes)
- Crafted status
- Mastered status
- Subsumed status (Warframes)

## Crafted Mode Setting

In the app settings, `craftedMode` controls crafted behavior:

- `manual` (default): `crafted` is a user toggle
- `auto`: `crafted` is derived from owning the main blueprint and all component blueprints

## Data Source

Uses Digital Extremes Public Export manifests:

- `ExportWarframes_en.json`
- `ExportWeapons_en.json`
- `ExportRecipes_en.json`
- `ExportResources_en.json`

Updater script resolves hashed manifest URLs from `index_en.txt.lzma` and writes `public/data/items.json`.

## Local Development

Install dependencies:

```bash
npm install
```

Run app:

```bash
npm run dev
```

Refresh game dataset:

```bash
npm run update:data
```

Optional flags:

```bash
node scripts/update-public-export.mjs --language en --include-all-weapons --output public/data/items.json
```

## GitHub Pages Deployment

Build for repo page path:

```bash
npm run build:pages
```

The workflow in `.github/workflows/pages.yml` uses:

`VITE_BASE_PATH=/${{ github.event.repository.name }}/`

If you deploy as a user page (`username.github.io`), set base path to `/`.

## Automation

- `.github/workflows/pages.yml`: build + deploy on `main`
- `.github/workflows/update-data.yml`: weekly data refresh and auto-commit if `public/data/items.json` changed

## Notes

- Updater currently relies on `xz` for LZMA decompression. On Linux, install `xz-utils` if missing.
- Recipe/component mappings come from Public Export and may change as DE updates schemas.
