export function utcHourBucket(unixMs: number): number {
  return Math.floor(unixMs / 1_800_000) // 30-minute payout periods;
}
