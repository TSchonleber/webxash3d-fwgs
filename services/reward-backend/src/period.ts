export function utcHourBucket(unixMs: number): number {
  return Math.floor(unixMs / 3_600_000);
}
