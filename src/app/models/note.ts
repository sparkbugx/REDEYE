export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Source = 'Ubuntu' | 'Google' | 'npm';

/** Severity levels in priority order, most urgent first. */
export const LEVELS: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
export const SOURCES: readonly Source[] = ['Ubuntu', 'Google', 'npm'];

export interface Note {
  /** Reference number: CVE, GHSA, USN or similar. Also drives the barcode. */
  id: string;
  source: Source;
  pkg: string;
  sev: Severity;
  /** CVSS score as text, empty when the source gives none. */
  score: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  title: string;
  note: string;
  fix: string;
  /** Name of the site the report came from. */
  via?: string;
  link?: string;
}

export type LevelFilter = 'all' | 'today' | Severity;
export type SortMode = 'priority' | 'newest';
