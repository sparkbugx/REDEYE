# Redeye Vuln Notes

Angular + TypeScript project. Vulnerability notes ranked by severity, beside the cover art.

## Run it

Needs Node.js 20.19 or newer.

    npm install
    npm start

Then open http://localhost:4200. `npm run build` writes the production site to `dist/redeye`.

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
