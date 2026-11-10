# Redeye Vuln Notes

Angular + TypeScript project. Vulnerability notes ranked by severity, beside the cover art.

## Run it

Needs Node.js 20.19 or newer.

    npm install
    npm start

Then open http://localhost:4200. `npm run build` writes the production site to `dist/redeye`.

## Updating the notes

The notes shown on the site are the `STARTER_NOTES` array in `src/app/data/starter-notes.ts`. To add a day's new vulnerabilities, follow [SOURCES.md](SOURCES.md). It lists every website to check for each portal (Ubuntu, Google, npm), the rules for what to include, the exact format of a note, and the steps to finish an update.

The daily update is one command:

    npm run update-notes

It reads the official feeds listed in `SOURCES.md`, adds new critical and high items to the top of `STARTER_NOTES`, and prints a summary. Notes already on file are never changed or removed, and an ID that is already there is not added twice.

| Command | What it does |
| --- | --- |
| `npm run update-notes` | Covers from the date of the newest note up to today |
| `npm run update-notes -- --dry-run` | Shows what would be added and writes nothing |
| `npm run update-notes -- --date=2026-11-09` | Looks at one day only |
| `npm run update-notes -- --since=2026-11-01` | Covers a longer window |
| `npm run update-notes -- --each-malware` | One note per malicious npm package instead of one roll-up a day |

The script also adds a row to the run log in `SOURCES.md` and keeps `scripts/update-notes-state.json`, a list of IDs it has already folded into grouped notes. Commit that file with the notes. Notes are built from the advisories' own text, so read them over before publishing.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/app/utils/current-date.ts` | `currentDate()`, the function that returns today's date |
| `src/app/services/current-date.service.ts` | Keeps today's date live, so counts roll over at midnight |
| `src/app/utils/barcode.ts` | `encodeBarcode()`, turns a reference number into a Code 39 barcode |
| `src/app/data/starter-notes.ts` | The starter notes; edit or add entries here |
| `src/app/services/notes.service.ts` | Ranking and browser storage for notes |
| `src/app/components/` | Cover panel, note card, add-note form, barcode |
| `src/styles.css` | All styling and colour tokens |
| `public/art.jpg` | The cover artwork |
| `scripts/update-notes.js` | The daily update script behind `npm run update-notes` |
| `.github/workflows/daily-update.yml` | GitHub Actions job that runs the update every day |
| `docs/VULNERABILITY_AUTOMATION.md` | How the update script and the daily job work, in detail |
| `SOURCES.md` | Websites to check for vulnerabilities, and how to turn them into notes |
