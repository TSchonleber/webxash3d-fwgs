// Legacy per-period bucketing (kept for the hourly leaderboard/settlement paths).
export const PERIOD_MS = 1_800_000;

export function utcHourBucket(unixMs: number): number {
  return Math.floor(unixMs / PERIOD_MS) // period index (30-minute payout periods)
}

// --- Reward window (the payout cadence) -------------------------------------
// One reward window = 8 hours, so payouts fire 3× per UTC day (00:00 / 08:00 /
// 16:00 UTC — 8h windows align to the UTC epoch). Change WINDOW_MS to retune the
// whole cadence; everything below derives from it.
export const WINDOW_MS = 3_600_000; // 1 hour (tournament window)

// The payout fires this long after each window boundary (waits for the oracle's
// final snapshot of the window's last matches). The board's display window lags
// by the same offset, so the leaderboard RESETS exactly when the payout fires —
// not the instant before it — keeping the paid window on screen until SOL goes out.
export const PAYOUT_OFFSET_MS = 25_000;

export function utcWindowBucket(unixMs: number): number {
  return Math.floor(unixMs / WINDOW_MS);
}

/** Reward window the board should DISPLAY/settle now — lags real time by the payout offset. */
export function displayWindow(now: number = Date.now()): number {
  return Math.floor((now - PAYOUT_OFFSET_MS) / WINDOW_MS);
}
