# Sources

Where Redeye's vulnerability notes come from, and how to turn what those sites publish into notes on the front end.

This file is the brief for the recurring request **"scrape the sources and add today's vulnerabilities"**. Follow it top to bottom: check the sites in [Source list](#source-list), apply [Selection rules](#selection-rules), write notes in the [Note format](#note-format), then finish with [Update steps](#update-steps).

## How the app uses notes

- Notes shipped with the site live in `src/app/data/starter-notes.ts`, in the `STARTER_NOTES` array. This is the only file a scrape needs to edit.
- The shape of a note is the `Note` interface in `src/app/models/note.ts`.
- Each note belongs to one of three portals, the `Source` type: `Ubuntu`, `Google` or `npm`. The sites below are grouped the same way.
- Notes are ranked by severity, then newest date, then score (`src/app/services/notes.service.ts`). Nothing needs to be ordered by hand.
- A note whose `date` equals the viewer's current date gets the "Today" badge and counts in the cover panel's "Critical today" and "High today".
- Notes a viewer adds through the form are stored in their own browser and are not part of a scrape.

## Source list

Check primary sources first. They are the vendors' own publications and decide the ID, severity, affected versions and fix. Secondary sources explain impact in plain language and are what the note's `via` and `link` usually point to.

### Ubuntu (`source: "Ubuntu"`)

| Site | URL | Use it for |
| --- | --- | --- |
| Ubuntu Security Notices | https://ubuntu.com/security/notices | Primary. Every USN, newest first, with fixed package versions per release |
| USN feed (RSS) | https://ubuntu.com/security/notices/rss.xml | Same list, easier to read by machine |
| USN API (JSON) | https://ubuntu.com/security/notices.json?limit=20 | Same list as JSON, with CVE IDs and release packages |
| Ubuntu CVE tracker | https://ubuntu.com/security/cves | Primary. Ubuntu priority and per-release status (fixed, vulnerable, needs evaluation) |
| CVE tracker API (JSON) | https://ubuntu.com/security/cves.json?limit=20 | Same data as JSON. One CVE: `https://ubuntu.com/security/CVE-YYYY-NNNNN` |
| Linux Kernel Security Feed | https://www.kernel.org/feeds/feed.xml | Primary. Upstream kernel vulnerabilities affecting Ubuntu kernels |
| ubuntu-security-announce | https://lists.ubuntu.com/archives/ubuntu-security-announce/ | Mailing list archive of USNs, by month |
| TuxCare blog | https://tuxcare.com/blog/ | Secondary. Plain-language write-ups of kernel bugs |

### Google (`source: "Google"`)

| Site | URL | Use it for |
| --- | --- | --- |
| Chrome Releases | https://chromereleases.googleblog.com/ | Primary. Stable channel updates: CVE list, Google's severity rating, fixed version, "exploit exists in the wild" statements |
| Chrome Releases feed | https://chromereleases.googleblog.com/feeds/posts/default | Same posts as an Atom feed |
| Android Security Bulletins | https://source.android.com/docs/security/bulletin | Primary. Monthly Android and Pixel bulletins |
| Google Cloud security bulletins | https://cloud.google.com/support/bulletins | Primary. GKE, Compute Engine and other Cloud products |
| Project Zero 0-days in the wild | https://googleprojectzero.github.io/0days-in-the-wild/ | Background on exploited zero-days |
| Chromium issue tracker | https://issues.chromium.org/ | Bug detail once Google opens the report (often restricted for weeks) |
| Malwarebytes, bugs category | https://www.malwarebytes.com/blog/category/bugs | Secondary. Readable summary of each Chrome security update |

### npm (`source: "npm"`)

| Site | URL | Use it for |
| --- | --- | --- |
| GitHub Advisory Database, npm | https://github.com/advisories?query=type%3Areviewed+ecosystem%3Anpm | Primary. Reviewed advisories with GHSA ID, CVSS score, affected and patched versions |
| GitHub Advisory Database, npm malware | https://github.com/advisories?query=type%3Amalware+ecosystem%3Anpm | Primary. Packages flagged as malware |
| GitHub advisories API | https://api.github.com/advisories?ecosystem=npm&per_page=30 | Same data as JSON. Add `&type=malware` for malware, `&severity=critical` to narrow |
| OSV | https://osv.dev/list?ecosystem=npm | Cross-check of affected version ranges. One entry: `https://api.osv.dev/v1/vulns/<ID>` |
| Snyk vulnerability database | https://security.snyk.io/vuln/npm | Secondary. Newly disclosed npm issues, sometimes before GHSA |
| Socket blog | https://socket.dev/blog | Secondary. Supply-chain attacks and malicious packages |
| Aikido blog | https://www.aikido.dev/blog | Secondary. Supply-chain attacks and worms |
| StepSecurity blog | https://stepsecurity.io/blog | Secondary. Compromised releases and CI pipelines |
| GitHub blog, npm tag | https://github.blog/tag/npm/ | npm registry incidents and policy changes |

### Cross-checks for every portal

| Site | URL | Use it for |
| --- | --- | --- |
| NVD | https://nvd.nist.gov/vuln/search | CVSS score and description. One CVE: `https://nvd.nist.gov/vuln/detail/<CVE-ID>` |
| NVD API | https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-YYYY-NNNNN | Same data as JSON |
| CVE.org | https://www.cve.org/ | The official CVE record. One CVE: `https://www.cve.org/CVERecord?id=<CVE-ID>` |
| CISA Known Exploited Vulnerabilities | https://www.cisa.gov/known-exploited-vulnerabilities-catalog | Whether a CVE is being actively exploited |
| CISA KEV feed (JSON) | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | Same catalogue as JSON, with `dateAdded` |
| CISA Cybersecurity Advisories (RSS) | https://www.cisa.gov/cybersecurity-advisories.xml | Real-time early alerts on critical infrastructure and software vulnerabilities |
| OSV.dev Query API | https://api.osv.dev/v1/query | Structured, multi-ecosystem API query for exact version impact ranges |
| FIRST EPSS | https://api.first.org/data/v1/epss?cve=CVE-YYYY-NNNNN | Probability that a CVE will be exploited |

### General security news

Good for spotting what matters on a given day. Always confirm against a primary source before writing a note.

| Site | URL |
| --- | --- |
| BleepingComputer | https://www.bleepingcomputer.com/news/security/ |
| The Hacker News | https://thehackernews.com/ |
| SecurityWeek, vulnerabilities | https://www.securityweek.com/category/vulnerabilities/ |
| Rescana blog | https://www.rescana.com/blog |
| Helix Threat Watch | https://helix.ml/threat-watch |
| CSA Singapore advisories | https://www.csa.gov.sg/alerts-and-advisories/advisories |

## Selection rules

1. **Scope.** Only items that fit one of the three portals: Ubuntu packages and kernels, Google products (Chrome, Android, Cloud), npm packages. Anything else is skipped unless a new portal is added (see [Adding a portal](#adding-a-portal-or-a-site)).
2. **Date window.** Items published on the requested date. If none is given, use today's date. If the last run was more than a day ago, cover the gap back to the newest `date` already in `STARTER_NOTES`.
3. **What qualifies.** Critical and high severity, anything exploited in the wild or listed in CISA KEV whatever its score, and any malicious or compromised npm package. Medium and low are added only when widely deployed or otherwise notable.
4. **No duplicates.** Skip an `id` that is already in `STARTER_NOTES`. If an existing note has changed (new fixed version, now exploited), update that note instead of adding a second one.
5. **One note per story.** When one update fixes many CVEs, write a note for the most serious one and mention the others in `note`, as the Chrome 157 entry does.
6. **Two sources.** Every note needs the primary source for the facts. If only a secondary site reports it, say so in `note`.
7. **Nothing invented.** No guessed scores, versions or dates. A field the sources do not give stays empty.

## Note format

One object per note, added to `STARTER_NOTES` in the same compact style as the existing entries:

```ts
{id:"CVE-2026-12345", source:"Ubuntu", pkg:"openssl", sev:"high", score:"7.5", date:"2026-11-10",
 title:"One line saying what the bug is and why it matters",
 note:"Two to four plain sentences: what is wrong, who is affected, how it can be used, whether it is being exploited.",
 fix:"The version to install or the mitigation, and any follow-up such as a reboot or rotating secrets.",
 via:"Site name", link:"https://full-url-of-the-report"},