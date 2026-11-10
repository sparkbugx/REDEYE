/**
 * Returns a date as YYYY-MM-DD in the viewer's own time zone.
 * Call it with no argument to get the current date.
 */
export function currentDate(now: Date = new Date()): string {
  const pad = (n: number): string => (n < 10 ? '0' : '') + n;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
