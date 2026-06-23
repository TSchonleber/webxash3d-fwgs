// Payout period length. Rounds are ~5 min; payouts settle every 15 min.
export const PERIOD_MS = 900_000;

export function utcHourBucket(unixMs: number): number {
  return Math.floor(unixMs / PERIOD_MS) // period index (10-minute payout periods)
}
