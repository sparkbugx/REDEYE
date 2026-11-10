#!/usr/bin/env node
'use strict';

/**
 * Redeye notes updater.
 *
 * Reads the structured feeds listed in SOURCES.md, keeps what the selection
 * rules allow, and adds the new notes to the top of STARTER_NOTES in
 * src/app/data/starter-notes.ts. Existing notes are never edited or removed:
 * new text is inserted above them and the result is checked before it is saved.
 *
 *   npm run update-notes                         from the newest note's date up to today
 *   npm run update-notes -- --dry-run            show what would be added, write nothing
 *   npm run update-notes -- --date=2026-11-09    one day only
 *   npm run update-notes -- --since=2026-11-01   a longer window (add --until=YYYY-MM-DD to end it early)
 *   npm run update-notes -- --each-malware       one note per malicious npm package instead of a daily roll-up
 *   npm run update-notes -- --file=path/to.ts    work on another notes file (for testing)
 *
 * Set GITHUB_TOKEN to raise GitHub's API limit (60 requests an hour without it).
 * Needs Node.js 20 or newer. No dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------------------------------------------------------------- settings

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_NOTES = path.join(ROOT, 'src/app/data/starter-notes.ts');
const SOURCES_MD = path.join(ROOT, 'SOURCES.md');
const USER_AGENT = 'redeye-update-notes/1.0 (Node.js)';

const FEEDS = {
  ubuntuNotices: 'https://ubuntu.com/security/notices.json?limit=20',
  chrome: 'https://chromereleases.googleblog.com/feeds/posts/default?max-results=75',
  android: (ym) => `https://source.android.com/docs/security/bulletin/${ym.slice(0, 4)}/${ym}-01?hl=en`,
  cloud: 'https://cloud.google.com/feeds/google-cloud-security-bulletins.xml',
  github: 'https://api.github.com/advisories?ecosystem=npm&per_page=100',
  kev: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  osv: (id) => `https://api.osv.dev/v1/vulns/${id}`,
  nvd: (id) => `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`,
};

const LIMITS = {
  ubuntuPages: 8, // 20 notices each
  ubuntuRatingsPerNotice: 300, // CVEs rated per notice (kernel notices list hundreds)
  ubuntuRatingSeconds: 120, // total time allowed for rating CVEs
  githubPages: 10, // 100 advisories each
  nvdLookupsPerRun: 5,
  osvLookupsPerRun: 25,
  malwareNamesInNote: 30,
};

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const PORTALS = ['Ubuntu', 'Google', 'npm'];
const ID_PATTERN = /\b(CVE-\d{4}-\d{4,}|GHSA(?:-[0-9a-z]{4}){3}|USN-\d+-\d+|GCP-\d{4}-\d+)\b/gi;

// ---------------------------------------------------------------- small helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (id) => String(id).trim().toUpperCase();
const unique = (list) => [...new Set(list)];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A Date as YYYY-MM-DD in this machine's time zone, the same rule the app uses. */
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-09" becomes "November 9". */
function longDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Collapses whitespace and removes control characters. */
function tidy(s) {
  return String(s ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** HTML to one line of plain text. */
function htmlToText(html) {
  return tidy(decodeEntities(String(html ?? '').replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '')));
}

/** Markdown (GitHub advisory text) to plain paragraphs. */
function markdownParagraphs(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').filter((line) => !/^\s*(#{1,6}\s|\|)/.test(line)).join(' '))
    .map((p) => tidy(p.replace(/[`*_]{1,3}/g, '').replace(/^\s*(?:[-+>]|\d+\.)\s+/, '')))
    .filter((p) => p.length >= 40);
}

/** Shortens text to whole sentences that fit in max characters. */
function clip(text, max) {
  const s = tidy(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max * 0.4) return cut.slice(0, end + 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const stripDot = (s) => tidy(s).replace(/[.\s]+$/, '');
const endDot = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const joinList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** CVSS score to a severity word, as in SOURCES.md. */
function sevFromScore(score) {
  const n = Number(score);
  if (!(n > 0)) return '';
  return n >= 9 ? 'critical' : n >= 7 ? 'high' : n >= 4 ? 'medium' : 'low';
}

/** CVSS 3.x base score from a vector string such as "CVSS:3.1/AV:N/AC:L/...". Returns 0 when it cannot be worked out. */
function cvss3Score(vector) {
  const m = Object.fromEntries(String(vector ?? '').split('/').slice(1).map((part) => part.split(':')));
  const changed = m.S === 'C';
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const ac = { L: 0.77, H: 0.44 }[m.AC];
  const pr = (changed ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 })[m.PR];
  const ui = { N: 0.85, R: 0.62 }[m.UI];
  const cia = { H: 0.56, L: 0.22, N: 0 };
  const [c, i, a] = [cia[m.C], cia[m.I], cia[m.A]];
  if (!/^CVSS:3\.[01]\//.test(vector) || [av, ac, pr, ui, c, i, a].includes(undefined) || !/^[UC]$/.test(m.S)) return 0;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const roundUp = (n) => Math.ceil(Math.round(n * 100000) / 10000) / 10;
  return roundUp(Math.min(changed ? 1.08 * (impact + 8.22 * av * ac * pr * ui) : impact + 8.22 * av * ac * pr * ui, 10));
}

function sevFromWord(word) {
  const w = String(word ?? '').toLowerCase();
  if (w === 'moderate') return 'medium';
  if (w === 'negligible') return 'low';
  return w in SEV_RANK ? w : '';
}

const scoreText = (score) => (Number(score) > 0 ? Number(score).toFixed(1) : '');

async function request(url, { timeout = 30000, retries = 2, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(2500 * attempt);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
      if (![429, 500, 502, 503, 504].includes(res.status)) break;
    } catch (err) {
      lastError = new Error(err.name === 'TimeoutError' ? `no answer after ${timeout / 1000}s` : err.cause?.code || err.message);
    }
  }
  throw lastError;
}

const getJson = async (url, options) => (await request(url, options)).json();
const getText = async (url, options) => (await request(url, options)).text();

/** Runs tasks a few at a time. */
async function pooled(items, size, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

// ---------------------------------------------------------------- command line

function parseArgs(argv) {
  const opts = { dryRun: false, eachMalware: false, file: DEFAULT_NOTES, since: '', until: '' };
  for (const arg of argv) {
    const [key, value = ''] = arg.split('=');
    if (key === '--dry-run') opts.dryRun = true;
    else if (key === '--each-malware') opts.eachMalware = true;
    else if (key === '--date') opts.since = opts.until = value;
    else if (key === '--since') opts.since = value;
    else if (key === '--until') opts.until = value;
    else if (key === '--file') opts.file = path.resolve(value);
    else if (key === '--help' || key === '-h') opts.help = true;
    else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  for (const d of [opts.since, opts.until]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Dates must look like 2026-11-10, got "${d}".`);
  }
  return opts;
}

const HELP = `Usage: npm run update-notes -- [options]

  --dry-run            show what would be added, write nothing
  --date=YYYY-MM-DD    look at one day only
  --since=YYYY-MM-DD   start of the window (default: date of the newest note on file)
  --until=YYYY-MM-DD   end of the window (default: today)
  --each-malware       one note per malicious npm package instead of a daily roll-up
  --file=PATH          notes file to update (default: src/app/data/starter-notes.ts)
`;

// ---------------------------------------------------------------- the notes file

const ARRAY_OPEN = /export const STARTER_NOTES\s*:\s*Note\[\]\s*=\s*\[/;

/** Reads the notes file and returns its text, the parsed notes and where new notes go. */
function loadNotesFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const open = ARRAY_OPEN.exec(text);
  const close = text.lastIndexOf(']');
  if (!open || close < open.index) throw new Error(`Could not find the STARTER_NOTES array in ${file}.`);
  const insertAt = open.index + open[0].length;
  let notes;
  try {
    notes = vm.runInNewContext(`([${text.slice(insertAt, close)}])`, Object.create(null), { timeout: 2000 });
  } catch (err) {
    throw new Error(`Could not read the existing notes in ${file}: ${err.message}`);
  }
  if (!Array.isArray(notes) || notes.some((n) => !n || typeof n.id !== 'string')) {
    throw new Error(`The existing notes in ${file} are not in the expected shape.`);
  }
  return { text, notes: JSON.parse(JSON.stringify(notes)), insertAt };
}

function formatNote(n) {
  const q = JSON.stringify;
  return [
    `  {id:${q(n.id)}, source:${q(n.source)}, pkg:${q(n.pkg)}, sev:${q(n.sev)}, score:${q(n.score)}, date:${q(n.date)},`,
    `   title:${q(n.title)},`,
    `   note:${q(n.note)},`,
    `   fix:${q(n.fix)},`,
    `   via:${q(n.via)}, link:${q(n.link)}},`,
  ].join('\n');
}

/** A note is only written when every field is the right kind of value. */
function validNote(n) {
  return (
    typeof n.id === 'string' && n.id.length > 0 && !/\s/.test(n.id) &&
    PORTALS.includes(n.source) &&
    n.sev in SEV_RANK &&
    /^(\d+\.\d)?$/.test(n.score) &&
    /^\d{4}-\d{2}-\d{2}$/.test(n.date) &&
    ['pkg', 'title', 'note', 'fix', 'via'].every((k) => typeof n[k] === 'string' && n[k].length > 0) &&
    /^https:\/\/\S+$/.test(n.link)
  );
}

// ---------------------------------------------------------------- run state

function createRun(opts) {
  const file = loadNotesFile(opts.file);
  const statePath = opts.file === DEFAULT_NOTES ? path.join(__dirname, 'update-notes-state.json') : `${opts.file}.state.json`;
  let ledger = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (Array.isArray(parsed.coveredIds)) ledger = parsed.coveredIds;
  } catch {
    // No state yet: the first run starts with the notes file alone.
  }

  // Every ID already on file: note IDs, IDs mentioned in note text and links,
  // and IDs earlier runs folded into a grouped note.
  const existing = new Set([
    ...file.notes.map((n) => norm(n.id)),
    ...(file.text.match(ID_PATTERN) ?? []).map(norm),
    ...ledger.map(norm),
  ]);

  const today = localDate();
  const newest = file.notes.map((n) => n.date).filter(Boolean).sort().pop();
  const until = opts.until || today;
  let since = opts.since || newest || today;
  if (since > until) since = until;

  return {
    opts, file, statePath, ledger, existing, today, since, until,
    seenThisRun: new Set(),
    added: [],
    covered: [], // IDs folded into the added notes
    stats: { dupExisting: 0, dupRun: 0, below: 0, unrated: 0 },
    problems: [],
    kev: new Map(),
    inWindow(date) { return date >= this.since && date <= this.until; },
    /**
     * The one gate every candidate passes through. Returns false, and counts the
     * skip, when any of its IDs is already on file or was taken earlier in this run.
     */
    claim(checkIds, alsoCovers = []) {
      const keys = unique(checkIds.filter(Boolean).map(norm));
      if (keys.some((k) => this.existing.has(k))) { this.stats.dupExisting++; return false; }
      if (keys.some((k) => this.seenThisRun.has(k))) { this.stats.dupRun++; return false; }
      for (const k of [...keys, ...alsoCovers.filter(Boolean).map(norm)]) {
        this.seenThisRun.add(k);
        this.covered.push(k);
      }
      return true;
    },
    add(note) {
      const clean = Object.fromEntries(Object.entries(note).map(([k, v]) => [k, tidy(v)]));
      if (!validNote(clean)) {
        this.problems.push(`Left out ${note.id}: a field was missing or malformed.`);
        return;
      }
      this.added.push(clean);
    },
    kevSentence(cve) {
      const hit = this.kev.get(norm(cve));
      return hit ? ` CISA added ${cve} to its Known Exploited Vulnerabilities catalogue on ${longDate(hit.dateAdded)}.` : '';
    },
  };
}

// ---------------------------------------------------------------- cross-checks

async function loadKev(run) {
  const data = await getJson(FEEDS.kev, { timeout: 60000 });
  for (const v of data.vulnerabilities ?? []) run.kev.set(norm(v.cveID), v);
}

let nvdCalls = 0;
let nvdLast = 0;
/** CVSS score and description from NVD. Slow on purpose: NVD allows 5 requests per 30 seconds. */
async function nvdLookup(cve) {
  if (nvdCalls >= LIMITS.nvdLookupsPerRun) return null;
  nvdCalls++;
  const wait = nvdLast + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const data = await getJson(FEEDS.nvd(cve), { timeout: 30000, retries: 1 });
    const item = data.vulnerabilities?.[0]?.cve;
    if (!item) return null;
    const metrics = item.metrics ?? {};
    const metric = (metrics.cvssMetricV31 ?? metrics.cvssMetricV40 ?? metrics.cvssMetricV30 ?? [])[0];
    return {
      score: metric?.cvssData?.baseScore ?? 0,
      description: tidy(item.descriptions?.find((d) => d.lang === 'en')?.value),
    };
  } catch {
    return null;
  } finally {
    nvdLast = Date.now();
  }
}

// ---------------------------------------------------------------- Google: Chrome

async function collectChrome(run) {
  const xml = await getText(FEEDS.chrome);
  const entries = xml.split('<entry>').slice(1);
  let oldest = run.today;

  for (const entry of entries) {
    const title = decodeEntities((entry.match(/<title[^>]*>([\s\S]*?)<\/title>/) ?? [])[1] ?? '');
    const published = (entry.match(/<published>(.*?)<\/published>/) ?? [])[1];
    if (!published) continue;
    const date = localDate(new Date(published));
    if (date < oldest) oldest = date;
    if (!/^Stable Channel Update for Desktop/i.test(title) || !run.inWindow(date)) continue;

    const text = htmlToText(decodeEntities((entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? ''));
    const fixes = [...text.matchAll(/\]\s*(Critical|High|Medium|Low)\s+(CVE-\d{4}-\d+):\s*(.+?)\.\s*Reported by/g)]
      .map(([, sev, id, what]) => ({ id, sev: sev.toLowerCase(), what: tidy(what) }));
    if (!fixes.length) continue;

    const wildText = (text.match(/[^.]*\bexists? in the wild[^.]*\./gi) ?? []).join(' ');
    const wild = new Set(wildText.match(/CVE-\d{4}-\d+/g) ?? []);
    const exploited = (f) => wild.has(f.id) || run.kev.has(f.id);
    fixes.sort((a, b) => Number(exploited(b)) - Number(exploited(a)) || SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    const top = fixes[0];

    if (SEV_RANK[top.sev] > SEV_RANK.high && !exploited(top)) { run.stats.below++; continue; }
    if (!run.claim([top.id], fixes.map((f) => f.id))) continue;

    const version = (text.match(/\d+\.\d+\.\d+\.\d+(?:\/\.\d+)*/) ?? [])[0] ?? '';
    const component = (top.what.match(/ in (.+)$/) ?? [])[1];
    const counts = ['critical', 'high', 'medium', 'low']
      .map((s) => [s, fixes.filter((f) => f.sev === s).length])
      .filter(([, n]) => n)
      .map(([s, n]) => `${n} ${s}`);
    const total = (text.match(/includes (\d+) security fix/) ?? [])[1] ?? fixes.length;
    const others = fixes.slice(1, 6).map((f) => `${f.id} (${lowerFirst(f.what)})`);
    const link = ((entry.match(/<link href="([^"]+)" rel="alternate"/) ?? [])[1] ?? 'https://chromereleases.googleblog.com/').replace(/^http:/, 'https:');

    run.add({
      id: top.id,
      source: 'Google',
      pkg: component ? `Chrome (${component})` : 'Chrome',
      sev: top.sev,
      score: '',
      date,
      title: `${top.what} in Chrome${wild.has(top.id) ? ', exploited in the wild' : ''}`.replace(/ in (.+) in Chrome/, " in Chrome's $1"),
      note:
        `Google's stable channel update of ${longDate(date)} has ${plural(Number(total), 'security fix', 'security fixes')}; the ones with CVE numbers are rated ${joinList(counts)}. ` +
        `${top.id} is rated ${top.sev} by Google.` +
        (wild.has(top.id) ? ` Google says an exploit for ${top.id} exists in the wild.` : '') +
        run.kevSentence(top.id) +
        (others.length ? ` Also fixed: ${others.join(', ')}${fixes.length > 6 ? `, and ${fixes.length - 6} more` : ''}.` : ''),
      fix: version
        ? `Chrome ${version} or later on desktop. Restart the browser to finish the update.`
        : 'Install the latest Chrome update and restart the browser.',
      via: 'Chrome Releases',
      link,
    });
  }
  if (oldest > run.since) run.problems.push(`Chrome Releases feed only reaches back to ${oldest}; earlier posts were not checked.`);
}

// ---------------------------------------------------------------- Google: Android

const ANDROID_TYPES = { RCE: 'remote code execution', EoP: 'elevation of privilege', ID: 'information disclosure', DoS: 'denial of service' };

async function collectAndroid(run) {
  const months = [];
  for (let [y, m] = run.since.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= run.until.slice(0, 7); m === 12 ? (y++, m = 1) : m++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  for (const ym of months) {
    const link = FEEDS.android(ym).replace('?hl=en', '');
    let html;
    try {
      html = await getText(FEEDS.android(ym), { retries: 1 });
    } catch (err) {
      if (/HTTP 404/.test(err.message)) continue; // not published yet
      throw err;
    }
    const publishedText = (htmlToText(html).match(/Published\s+([A-Z][a-z]+ \d{1,2}, \d{4})/) ?? [])[1];
    const published = publishedText ? new Date(publishedText) : null;
    if (!published || Number.isNaN(published.getTime())) { run.problems.push(`Android bulletin ${ym}: no publication date found.`); continue; }
    const date = localDate(published);
    if (!run.inWindow(date)) continue;

    const rows = [];
    const parts = html.split(/<h3[^>]*data-text="([^"]+)"[^>]*>/);
    for (let i = 1; i < parts.length; i += 2) {
      const section = decodeEntities(parts[i]);
      for (const [, row] of parts[i + 1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => htmlToText(c[1]));
        const id = (cells[0]?.match(/CVE-\d{4}-\d+/) ?? [])[0];
        const sev = sevFromWord(cells.find((c) => /^(Critical|High|Moderate|Low)$/.test(c)));
        if (id && sev) rows.push({ id, sev, section, type: cells.find((c) => c in ANDROID_TYPES) ?? '' });
      }
    }
    if (!rows.length) { run.problems.push(`Android bulletin ${ym}: no CVE rows found.`); continue; }

    const exploitedText = (htmlToText(html).match(/[^.]*limited, targeted exploitation[^.]*\./gi) ?? []).join(' ');
    const wild = new Set(exploitedText.match(/CVE-\d{4}-\d+/g) ?? []);
    const exploited = (r) => wild.has(r.id) || run.kev.has(r.id);
    const typeRank = (r) => ['RCE', 'EoP', 'ID', 'DoS', ''].indexOf(r.type);
    rows.sort((a, b) => Number(exploited(b)) - Number(exploited(a)) || SEV_RANK[a.sev] - SEV_RANK[b.sev] || typeRank(a) - typeRank(b));
    const top = rows[0];

    if (SEV_RANK[top.sev] > SEV_RANK.high && !exploited(top)) { run.stats.below++; continue; }
    const ids = unique(rows.map((r) => r.id));
    if (!run.claim([top.id], ids)) continue;

    const monthName = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const count = (sev) => unique(rows.filter((r) => r.sev === sev).map((r) => r.id)).length;
    const kind = ANDROID_TYPES[top.type] ? `${ANDROID_TYPES[top.type]} bug` : 'bug';
    const others = unique(rows.filter((r) => r.sev === 'critical' && r.id !== top.id).map((r) => `${r.id} (${r.section})`)).slice(0, 5);
    const level = html.includes(`${ym}-05`) ? `${ym}-05` : `${ym}-01`;

    run.add({
      id: top.id,
      source: 'Google',
      pkg: `Android (${top.section})`,
      sev: top.sev,
      score: '',
      date,
      title: `Android ${monthName} bulletin: ${top.sev} ${kind} in ${top.section}${wild.has(top.id) ? ', under limited exploitation' : ''}`,
      note:
        `Google's Android Security Bulletin for ${monthName} lists ${plural(ids.length, 'CVE')}: ${count('critical')} critical and ${count('high')} high. ` +
        `${top.id} is a ${top.sev} ${kind} in ${top.section}.` +
        (wild.has(top.id) ? ` Google says there are indications it may be under limited, targeted exploitation.` : '') +
        run.kevSentence(top.id) +
        (others.length ? ` Other critical entries include ${others.join(', ')}.` : ''),
      fix: `Install the Android update with security patch level ${level} or later. Devices get it from their manufacturer, so check Settings for the patch level.`,
      via: 'Android Security Bulletins',
      link,
    });
  }
}

// ---------------------------------------------------------------- Google: Cloud

async function collectCloud(run) {
  const xml = await getText(FEEDS.cloud);
  for (const entry of xml.split('<entry>').slice(1)) {
    const bulletin = (entry.match(/<title>\s*(GCP-\d{4}-\d+)\s*<\/title>/) ?? [])[1];
    const date = (entry.match(/Published:<\/strong>\s*(\d{4}-\d{2}-\d{2})/) ?? [])[1];
    if (!bulletin || !date || !run.inWindow(date)) continue;

    const row = (entry.match(/<tbody>\s*<tr>([\s\S]*?)<\/tr>/) ?? [])[1] ?? '';
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    const sev = sevFromWord(cells.slice(1).map(htmlToText).find((c) => /^(Critical|High|Medium|Low)$/i.test(c)));
    const cves = unique(entry.match(/CVE-\d{4}-\d+/g) ?? []);
    const inKev = cves.find((c) => run.kev.has(c));
    if (!sev) { run.stats.unrated++; continue; }
    if (SEV_RANK[sev] > SEV_RANK.high && !inKev) { run.stats.below++; continue; }

    const id = inKev ?? cves[0] ?? bulletin;
    if (!run.claim([id, bulletin], cves)) continue;

    const [about, action = ''] = (cells[0] ?? '').split(/<h\d[^>]*>\s*What should I do\??\s*<\/h\d>/i);
    const description = htmlToText(about);
    const products = ['GKE', 'Compute Engine', 'Cloud Service Mesh', 'Cloud Run', 'Cloud SQL', 'Anthos', 'Google Distributed Cloud', 'Confidential VM', 'Vertex AI', 'Cloud Functions']
      .filter((p) => entry.includes(p));
    const link = ((entry.match(/<link rel="alternate" href="([^"]+)"/) ?? [])[1] ?? 'https://cloud.google.com/support/bulletins').replace(/^http:/, 'https:');

    run.add({
      id,
      source: 'Google',
      pkg: products.length ? `Google Cloud (${products.slice(0, 3).join(', ')})` : 'Google Cloud',
      sev,
      score: '',
      date,
      title: `Google Cloud bulletin ${bulletin}: ${stripDot(clip(description, 110))}`,
      note: clip(description, 480) + ` Google rates bulletin ${bulletin} ${sev}.` + (inKev ? run.kevSentence(inKev) : ''),
      fix: htmlToText(action) ? clip(htmlToText(action), 380) : `Follow the instructions in bulletin ${bulletin}.`,
      via: 'Google Cloud security bulletins',
      link,
    });
  }
}

// ---------------------------------------------------------------- Ubuntu

async function collectUbuntu(run) {
  // 1. Notices in the window. Linux kernel fixes arrive here as "Linux kernel (...)" notices.
  const notices = [];
  for (let page = 0; page < LIMITS.ubuntuPages; page++) {
    const data = await getJson(`${FEEDS.ubuntuNotices}&offset=${page * 20}`, { timeout: 45000 });
    const batch = data.notices ?? [];
    notices.push(...batch);
    const oldest = batch.map((n) => localDate(new Date(`${n.published}Z`))).sort()[0];
    if (!batch.length || oldest < run.since) break;
    if (page === LIMITS.ubuntuPages - 1) run.problems.push(`Ubuntu notices: stopped after ${LIMITS.ubuntuPages * 20} notices; older ones in the window were not checked.`);
  }
  const candidates = notices
    .map((n) => ({ ...n, date: localDate(new Date(`${n.published}Z`)) }))
    .filter((n) => n.type === 'USN' && !n.is_hidden && run.inWindow(n.date) && n.cves_ids?.length && !run.existing.has(norm(n.id)));
  if (!candidates.length) return;

  // 2. Ubuntu's priority and the CVSS score for the CVEs involved, from OSV's copy of
  //    the Ubuntu CVE tracker (ubuntu.com's own CVE API times out too often to rely on).
  const rated = new Map();
  const deadline = Date.now() + LIMITS.ubuntuRatingSeconds * 1000;
  let failedLookups = 0;
  let outOfTime = false;
  const wanted = unique(candidates
    .sort((a, b) => a.cves_ids.length - b.cves_ids.length) // small notices first, so they are always complete
    .flatMap((n) => n.cves_ids.slice(0, LIMITS.ubuntuRatingsPerNotice)));
  await pooled(wanted, 8, async (id) => {
    if (Date.now() > deadline) { outOfTime = true; return; }
    try {
      const data = await getJson(FEEDS.osv(`UBUNTU-${id}`), { timeout: 15000, retries: 1 });
      const severity = data.severity ?? [];
      rated.set(norm(id), {
        priority: sevFromWord(severity.find((x) => x.type === 'Ubuntu')?.score),
        score: cvss3Score(severity.find((x) => x.type === 'CVSS_V3')?.score),
      });
    } catch (err) {
      if (!/HTTP 404/.test(err.message)) failedLookups++;
    }
  });
  if (failedLookups) run.problems.push(`Ubuntu ratings: ${plural(failedLookups, 'CVE lookup')} at OSV failed.`);
  if (outOfTime) run.problems.push('Ubuntu ratings: ran out of time, so some notices may be listed as having no usable rating. Run again with a shorter window.');

  // 3. One note per notice, for its most serious CVE.
  for (const notice of candidates) {
    const cves = notice.cves_ids
      .map((id) => ({ id, ...(rated.get(norm(id)) ?? {}), kev: run.kev.has(norm(id)) }))
      // As in SOURCES.md: the CVSS score decides the level, Ubuntu's priority when there is no score.
      .map((c) => ({ ...c, sev: sevFromScore(c.score) || c.priority || '' }));
    const known = cves.filter((c) => c.sev || c.kev);
    known.sort((a, b) => Number(b.kev) - Number(a.kev) || (SEV_RANK[a.sev] ?? 9) - (SEV_RANK[b.sev] ?? 9) || (b.score || 0) - (a.score || 0));
    const top = known[0];
    const qualifies = top && (top.kev || SEV_RANK[top.sev] <= SEV_RANK.high);
    if (!qualifies) {
      if (known.length < cves.length) run.stats.unrated++; else run.stats.below++;
      continue;
    }
    if (!top.sev) { run.stats.unrated++; continue; } // exploited but no rating anywhere: left for a person to add
    if (!run.claim([top.id, notice.id], known.slice(1, 6).map((c) => c.id))) continue;

    const releaseName = Object.fromEntries((notice.releases ?? []).map((r) => [r.codename, r.version]));
    const fixed = [];
    for (const [codename, packages] of Object.entries(notice.release_packages ?? {})) {
      for (const p of packages.filter((x) => x.is_source)) fixed.push(`${p.name} ${p.version} (${releaseName[codename] ?? codename})`);
    }
    const subject = tidy(notice.title).replace(/\s+(vulnerabilit(y|ies)|regressions?|updates?)$/i, '');
    const rating = [top.priority && `Ubuntu priority ${top.priority}`, top.score && `CVSS ${scoreText(top.score)}`].filter(Boolean).join(', ');
    const others = known.slice(1, 6).filter((c) => SEV_RANK[c.sev] <= SEV_RANK.high).map((c) => c.id);

    run.add({
      id: top.id,
      source: 'Ubuntu',
      pkg: /^linux kernel/i.test(subject) ? subject.replace(/^Linux kernel/i, 'linux') : subject,
      sev: top.sev,
      score: scoreText(top.score),
      date: notice.date,
      title: /^several security issues/i.test(tidy(notice.summary))
        ? `${subject}: ${plural(cves.length, 'CVE')} fixed, the most serious rated ${top.sev}`
        : `${subject}: ${lowerFirst(stripDot(clip(notice.summary, 150)))}`,
      note:
        clip(tidy(notice.description).split(/\s*This update corrects flaws/)[0].replace(/\s*\((?:CVE-\d{4}-\d+,?\s*)+\)/g, ''), 420) +
        ` ${notice.id} covers ${plural(cves.length, 'CVE')}${cves.length > 1 ? `; the most serious rated one is ${top.id}` : ''}${rating ? ` (${rating})` : ''}.` +
        run.kevSentence(top.id) +
        (others.length ? ` Also rated high or critical: ${others.join(', ')}.` : ''),
      fix:
        (fixed.length ? `Fixed in ${fixed.slice(0, 4).join(', ')}${fixed.length > 4 ? ` and ${fixed.length - 4} more listed in ${notice.id}` : ''}. ` : '') +
        clip(notice.instructions || 'A standard system update will make all the necessary changes.', 130),
      via: 'Ubuntu Security Notices',
      link: `https://ubuntu.com/security/notices/${notice.id}`,
    });
  }
}

// ---------------------------------------------------------------- npm

async function githubAdvisories(run, type) {
  // GitHub filters on UTC dates, so ask for a day either side and filter locally.
  const shift = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let url = `${FEEDS.github}&type=${type}&sort=published&direction=desc&published=${shift(run.since, -1)}..${shift(run.until, 1)}`;
  const found = [];
  for (let page = 0; url && page < LIMITS.githubPages; page++) {
    const res = await request(url, { headers });
    found.push(...(await res.json()));
    url = (res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/) ?? [])[1];
    if (url && page === LIMITS.githubPages - 1) run.problems.push(`GitHub ${type} advisories: stopped after ${LIMITS.githubPages * 100}; set a shorter window to see the rest.`);
  }
  return found
    .filter((a) => !a.withdrawn_at && a.published_at)
    .map((a) => ({ ...a, date: localDate(new Date(a.published_at)) }))
    .filter((a) => run.inWindow(a.date));
}

const npmPackages = (a) => unique((a.vulnerabilities ?? []).filter((v) => v.package?.ecosystem === 'npm').map((v) => v.package.name));

let osvCalls = 0;
/** Fixed versions OSV records for an advisory, used when GitHub lists none. */
async function osvFixedVersions(id) {
  if (osvCalls >= LIMITS.osvLookupsPerRun) return null;
  osvCalls++;
  try {
    const data = await getJson(FEEDS.osv(id), { timeout: 15000, retries: 0 });
    return unique((data.affected ?? []).flatMap((a) => (a.ranges ?? []).flatMap((r) => (r.events ?? []).map((e) => e.fixed).filter(Boolean))));
  } catch {
    return null;
  }
}

async function collectNpmReviewed(run) {
  const advisories = (await githubAdvisories(run, 'reviewed'))
    .map((a) => {
      const score = Number(a.cvss?.score) || Number(a.cvss_severities?.cvss_v3?.score) || Number(a.cvss_severities?.cvss_v4?.score) || 0;
      return { ...a, score, sev: sevFromScore(score) || sevFromWord(a.severity), packages: npmPackages(a), kev: a.cve_id ? run.kev.has(norm(a.cve_id)) : false };
    })
    .filter((a) => a.packages.length);

  // One story per package per day: several advisories for the same package become one note.
  const stories = new Map();
  for (const a of advisories) {
    const key = `${a.date}|${a.packages[0]}`;
    stories.set(key, [...(stories.get(key) ?? []), a]);
  }

  for (const group of stories.values()) {
    group.sort((a, b) => Number(b.kev) - Number(a.kev) || (SEV_RANK[a.sev] ?? 9) - (SEV_RANK[b.sev] ?? 9) || b.score - a.score);
    const top = group[0];
    if (!top.sev) { run.stats.unrated += group.length; continue; }
    if (SEV_RANK[top.sev] > SEV_RANK.high && !top.kev) { run.stats.below += group.length; continue; }

    const id = top.cve_id || top.ghsa_id;
    const rest = group.slice(1);
    if (!run.claim([id, top.ghsa_id], rest.flatMap((a) => [a.cve_id, a.ghsa_id]))) continue;

    const affected = (top.vulnerabilities ?? []).filter((v) => v.package?.ecosystem === 'npm');
    const patched = unique(affected.filter((v) => v.first_patched_version).map((v) => `${v.package.name} ${v.first_patched_version}`));
    let fix;
    if (patched.length) {
      fix = `Upgrade to ${joinList(patched.slice(0, 4))} or later.`;
    } else {
      const fromOsv = await osvFixedVersions(top.ghsa_id);
      fix = fromOsv?.length
        ? `Upgrade ${top.packages[0]} to ${joinList(fromOsv.slice(0, 4))} or later (fixed version taken from OSV).`
        : `No patched version is listed yet. Affected: ${clip(affected.map((v) => `${v.package.name} ${v.vulnerable_version_range}`).join('; '), 160)}. Remove or isolate the package until a fix is published.`;
    }
    const serious = rest.filter((a) => SEV_RANK[a.sev] <= SEV_RANK.high).slice(0, 5).map((a) => `${a.cve_id || a.ghsa_id} (${a.sev})`);
    const range = affected.length === 1 ? ` ${affected[0].vulnerable_version_range}` : '';

    run.add({
      id,
      source: 'npm',
      pkg: clip(`${top.packages.slice(0, 3).join(', ')}${top.packages.length > 3 ? ` and ${top.packages.length - 3} more` : range}`, 80),
      sev: top.sev,
      score: scoreText(top.score),
      date: top.date,
      title: stripDot(clip(top.summary, 150)),
      note:
        clip(markdownParagraphs(top.description)[0] ?? top.summary, 480) +
        ` GitHub rates it ${top.sev}${top.score ? ` (CVSS ${scoreText(top.score)})` : ''}.` +
        (top.cve_id ? run.kevSentence(top.cve_id) : '') +
        (rest.length ? ` ${plural(rest.length, 'more advisory', 'more advisories')} for ${top.packages[0]} came out the same day${serious.length ? `, including ${serious.join(', ')}` : ''}.` : ''),
      fix,
      via: 'GitHub Advisory Database',
      link: top.html_url,
    });
  }
}

async function collectNpmMalware(run) {
  const flagged = (await githubAdvisories(run, 'malware'))
    .map((a) => ({ ...a, packages: npmPackages(a) }))
    .filter((a) => a.packages.length);
  const fix = 'Remove the package and block it in lockfiles and CI. Rotate every secret that was on the machine from a clean computer, then rebuild or reimage it. Uninstalling alone is not enough.';
  const listLink = 'https://github.com/advisories?query=type%3Amalware+ecosystem%3Anpm';

  const groups = new Map();
  for (const a of flagged) {
    const key = run.opts.eachMalware ? a.ghsa_id : a.date;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  for (const all of groups.values()) {
    // Drop packages earlier runs already covered, then make one note from what is left.
    const fresh = [];
    for (const a of all) {
      if (run.existing.has(norm(a.ghsa_id))) run.stats.dupExisting++;
      else if (run.seenThisRun.has(norm(a.ghsa_id))) run.stats.dupRun++;
      else fresh.push(a);
    }
    if (!fresh.length) continue;
    const top = fresh[0];
    if (!run.claim([top.ghsa_id], fresh.slice(1).map((a) => a.ghsa_id))) continue;

    const names = unique(fresh.flatMap((a) => a.packages));
    const shown = names.slice(0, LIMITS.malwareNamesInNote);
    const single = names.length === 1;
    run.add({
      id: top.ghsa_id,
      source: 'npm',
      pkg: single ? names[0] : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`,
      sev: 'critical',
      score: '',
      date: top.date,
      title: single
        ? `Malicious package ${names[0]}: treat any install as a full compromise`
        : `${names.length} npm packages flagged as malware on ${longDate(top.date)}: treat any install as a full compromise`,
      note: single
        ? `GitHub's advisory database flags this package as malware (CWE-506). Any machine that installed or ran it should be considered under outside control.`
        : `GitHub's advisory database flagged ${names.length} npm packages as malware (CWE-506) on ${longDate(top.date)}: ${shown.join(', ')}${names.length > shown.length ? `, and ${names.length - shown.length} more` : ''}. Any machine that installed or ran one of them should be considered under outside control.`,
      fix,
      via: 'GitHub Advisory Database',
      link: single ? top.html_url : listLink,
    });
  }
}

// ---------------------------------------------------------------- CISA KEV additions

/** Google CVEs that CISA added in the window and that no note covers yet. */
async function collectKevAdditions(run) {
  for (const v of run.kev.values()) {
    if (!run.inWindow(v.dateAdded) || !/^google$/i.test(v.vendorProject)) continue;
    if (run.existing.has(norm(v.cveID)) || run.seenThisRun.has(norm(v.cveID))) {
      run.claim([v.cveID]); // counts the duplicate
      continue;
    }
    const nvd = await nvdLookup(v.cveID);
    const sev = sevFromScore(nvd?.score);
    if (!sev) { run.stats.unrated++; run.problems.push(`${v.cveID} is new in CISA KEV but has no CVSS score yet; add it by hand.`); continue; }
    if (!run.claim([v.cveID])) continue;
    run.add({
      id: v.cveID,
      source: 'Google',
      pkg: tidy(`${v.vendorProject} ${v.product}`),
      sev,
      score: scoreText(nvd.score),
      date: v.dateAdded,
      title: `${stripDot(v.vulnerabilityName)}, listed by CISA as exploited`,
      note: `${clip(v.shortDescription, 420)}${run.kevSentence(v.cveID)}`,
      fix: endDot(clip(v.requiredAction, 300)),
      via: 'CISA Known Exploited Vulnerabilities',
      link: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
    });
  }
}

// ---------------------------------------------------------------- saving

function save(run) {
  const { file, opts } = run;
  const header = /gathered on \d{4}-\d{2}-\d{2}/;
  const order = (a, b) => b.date.localeCompare(a.date) || SEV_RANK[a.sev] - SEV_RANK[b.sev];
  run.added.sort(order);

  const before = file.text.slice(0, file.insertAt).replace(header, `gathered on ${run.today}`);
  const after = file.text.slice(file.insertAt);
  const block = run.added.length ? `\n${run.added.map(formatNote).join('\n')}` : '';
  const next = before + block + after;

  // Proof that nothing old was lost: the old notes must still be there, unchanged
  // and in the same order, directly below the new ones.
  const tmp = `${opts.file}.tmp`;
  fs.writeFileSync(tmp, next);
  let reread;
  try {
    reread = loadNotesFile(tmp).notes;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`The updated file would not parse, so nothing was saved. ${err.message}`);
  }
  const kept = JSON.stringify(reread.slice(run.added.length)) === JSON.stringify(file.notes);
  const ids = reread.map((n) => norm(n.id));
  if (!kept || reread.length !== file.notes.length + run.added.length || !next.endsWith(after) || new Set(ids).size !== ids.length && new Set(file.notes.map((n) => norm(n.id))).size === file.notes.length) {
    fs.rmSync(tmp, { force: true });
    throw new Error('Safety check failed: the update would have changed existing notes or created a duplicate ID. Nothing was saved.');
  }
  if (opts.dryRun) {
    fs.rmSync(tmp, { force: true });
    return;
  }
  fs.renameSync(tmp, opts.file);

  const coveredIds = unique([...run.ledger.map(norm), ...run.covered]).sort();
  fs.writeFileSync(run.statePath, `${JSON.stringify({ lastRun: run.today, coveredIds }, null, 1)}\n`);

  if (opts.file === DEFAULT_NOTES) appendRunLog(run);
}

/** Adds a row to the run log table at the end of SOURCES.md, when that table exists. */
function appendRunLog(run) {
  try {
    const text = fs.readFileSync(SOURCES_MD, 'utf8');
    const at = text.indexOf('## Run log');
    if (at < 0) return;
    const lines = text.slice(at).split('\n');
    let last = -1;
    lines.forEach((line, i) => { if (line.startsWith('|')) last = i; });
    if (last < 0) return;
    const window = run.since === run.until ? run.since : `${run.since} to ${run.until}`;
    const perPortal = PORTALS.map((p) => `${p} ${run.added.filter((n) => n.source === p).length}`).join(', ');
    const skipped = run.stats.dupExisting + run.stats.dupRun;
    lines.splice(last + 1, 0, `| ${run.today} | ${window} | ${run.added.length} | \`npm run update-notes\`: ${perPortal}; ${plural(skipped, 'duplicate')} skipped |`);
    fs.writeFileSync(SOURCES_MD, text.slice(0, at) + lines.join('\n'));
  } catch {
    run.problems.push('SOURCES.md run log was not updated.');
  }
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  const run = createRun(opts);

  console.log(`Redeye notes update${opts.dryRun ? ' (dry run)' : ''}`);
  console.log(`  Notes on file: ${run.file.notes.length}   Window: ${run.since === run.until ? run.since : `${run.since} to ${run.until}`}\n`);

  // Order matters only for which portal gets a CVE that several of them report.
  const steps = [
    ['CISA KEV catalogue', loadKev],
    ['Ubuntu security notices', collectUbuntu],
    ['Chrome releases', collectChrome],
    ['Android security bulletins', collectAndroid],
    ['Google Cloud security bulletins', collectCloud],
    ['npm advisories (GitHub)', collectNpmReviewed],
    ['npm malware (GitHub)', collectNpmMalware],
    ['CISA KEV additions', collectKevAdditions],
  ];
  const failed = [];
  for (const [name, step] of steps) {
    const had = run.added.length;
    process.stdout.write(`  ${name} … `);
    try {
      await step(run);
      console.log(step === loadKev ? `${run.kev.size} entries` : `${run.added.length - had} new`);
    } catch (err) {
      failed.push(name);
      console.log(`FAILED (${err.message})`);
    }
  }

  save(run);

  const line = '-'.repeat(64);
  console.log(`\n${line}\nSummary${opts.dryRun ? ' (dry run, nothing written)' : ''}\n${line}`);
  console.log(`New notes added: ${run.added.length}`);
  for (const portal of PORTALS) console.log(`  ${portal.padEnd(7)} ${run.added.filter((n) => n.source === portal).length}`);
  console.log(`Duplicates skipped: ${run.stats.dupExisting + run.stats.dupRun}`);
  console.log(`  already on file                  ${run.stats.dupExisting}`);
  console.log(`  reported twice during this run   ${run.stats.dupRun}`);
  console.log(`Not added: ${run.stats.below} below the severity threshold, ${run.stats.unrated} with no usable rating`);
  console.log(
    opts.dryRun
      ? `Existing notes: ${run.file.notes.length} on file, none would be changed.`
      : `Existing notes: all ${run.file.notes.length} kept, unchanged and in the same order (checked after writing). Total now ${run.file.notes.length + run.added.length}.`,
  );
  if (run.added.length) {
    console.log(`\n${opts.dryRun ? 'Would add' : 'Added'}:`);
    for (const n of run.added) console.log(`  ${n.date}  ${n.source.padEnd(6)} ${n.sev.padEnd(8)} ${n.id}  ${clip(n.title, 70)}`);
  }
  if (failed.length || run.problems.length) {
    console.log('\nNeeds attention:');
    for (const name of failed) console.log(`  - ${name} could not be reached; run again later to pick it up.`);
    for (const p of unique(run.problems)) console.log(`  - ${p}`);
  }
  if (!opts.dryRun) console.log(`\nSaved ${opts.file.startsWith(ROOT) ? path.relative(ROOT, opts.file) : opts.file}. Run "npm run build" to check the site still builds.`);
  if (failed.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`\nupdate-notes stopped: ${err.message}`);
  process.exitCode = 1;
});
