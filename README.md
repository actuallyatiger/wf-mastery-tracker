# Warframe Mastery Tracker

Static Svelte app for tracking Warframe and equipment progression, hosted on GitHub Pages.

The tracker stores your progress in browser localStorage and supports profile-style JSON import/export.

![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2Factuallyatiger%2Fwf-mastery-tracker%2Factions%2Fworkflows%2F255610392%2Fruns%3Fstatus%3Dcompleted%26per_page%3D1&query=%24.workflow_runs%5B0%5D.run_started_at&label=Last%20Data%20Update)


## What It Tracks

- Warframes
- Primary
- Secondary
- Melee
- Archwings
- Arch-Guns
- Arch-Melee
- Sentinels
- Sentinel Weapons
- Pets

- Main blueprint ownership per item
- Component blueprint ownership per item (for example, Warframe Neuroptics/Chassis/Systems)
- Variable recipe requirements per item (from WFCD data)
- Crafted status
- Mastered status
- Subsumed status (Warframes)

## Crafted Mode Setting

In the app settings, `craftedMode` controls crafted behavior:

- `manual` (default): `crafted` is a user toggle
- `auto`: `crafted` is derived from owning the main blueprint and all component blueprints

## Data Source

Uses `WFCD/warframe-items` JSON category files:

- `Warframes.json`
- `Primary.json`
- `Secondary.json`
- `Melee.json`
- `Archwing.json`
- `Arch-Gun.json`
- `Arch-Melee.json`
- `Pets.json`
- `Sentinels.json`
- `SentinelWeapons.json`

Updater script fetches these files directly from GitHub raw content and writes a split dataset under `public/data/`:

- `public/data/manifest.json`
- `public/data/blueprints.json`
- `public/data/components.json`
- `public/data/tabs/*.json` (one file per tab/category)

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
node scripts/update-data-files.mjs --output-dir public/data
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
- `.github/workflows/update-data.yml`: weekly data refresh and auto-commit if `public/data` changed

## Notes

- Import accepts either:
	- legacy tracker export JSON (`{ items: ... }`), or
	- Warframe profile-style JSON with `Results[0].LoadOutInventory` and `Results[0].XPInfo`.
- Export writes a profile-style JSON payload keyed by Warframe item path IDs (`ItemType`).
- Settings include a PC profile fetch flow based on account id (`playerId`) using `https://api.warframe.com/cdn/getProfileViewingData.php?playerId=` with a legacy fallback endpoint and a helper to parse account id from `EE.log`.
- Some browsers/environments block direct profile endpoint calls due to CORS; in that case use JSON import instead.
