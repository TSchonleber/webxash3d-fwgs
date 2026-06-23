// Centralized env access. Vite inlines import.meta.env.* at build time.

export const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS === "1";
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
export const GAME_URL = import.meta.env.VITE_GAME_URL ?? "https://game.chainstrike.fun";
export const LOBBY_URL = import.meta.env.VITE_LOBBY_URL ?? "https://chainstrike.fun";
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://api.devnet.solana.com";
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";
export const DISTRIBUTOR_PROGRAM_ID =
  import.meta.env.VITE_DISTRIBUTOR_PROGRAM_ID ?? "6jSjkNJg2ap9Mxmj6prQ7bEnBQsSWvf6t5p5vWLBzSx4";

// --- Token-hold gate ---------------------------------------------------------
// The play gate stays OPEN until a token mint is configured (pre-launch), so
// everyone can play. Once VITE_TOKEN_MINT is set, the dashboard enforces a
// minimum on-chain balance before letting a wallet enter matches.
// VITE_GATE_BYPASS=1 forces the gate open even with a mint set (for testers).
export const TOKEN_MINT = import.meta.env.VITE_TOKEN_MINT ?? "";
export const MIN_HOLD = Number(import.meta.env.VITE_MIN_HOLD ?? 1000);
export const GATE_BYPASS = import.meta.env.VITE_GATE_BYPASS === "1";
export const TOKEN_SYMBOL = import.meta.env.VITE_TOKEN_SYMBOL ?? "$TOKEN";

// --- Swap (SOL -> game token via Jupiter) ------------------------------------
// Native SOL mint (wrapped-SOL address Jupiter expects for the SOL side).
export const SOL_MINT = "So11111111111111111111111111111111111111112";
// Jupiter's free swap API. Override if you move to the keyed (api.jup.ag) tier.
export const JUPITER_API = import.meta.env.VITE_JUPITER_API ?? "https://lite-api.jup.ag/swap/v1";
// Slippage tolerance for the swap, in basis points (150 = 1.5%). A freshly
// launched, thin-liquidity token may need this raised to avoid failed swaps.
export const SWAP_SLIPPAGE_BPS = Number(import.meta.env.VITE_SWAP_SLIPPAGE_BPS ?? 150);

// A deterministic demo wallet shown in dev-bypass so the UI is fully populated.
export const DEMO_WALLET = "Dmo7xAshArEna1111111111111111111111111111111";

// Payout period — MUST match services/reward-backend/src/period.ts (15 min).
export const PERIOD_MS = 1_800_000;

/** Period-index id used as the period id, matching the backend. */
export function currentUtcHour(now: number = Date.now()): number {
  return Math.floor(now / PERIOD_MS);
}

/** ms remaining until the next payout period boundary. */
export function msToNextHour(now: number = Date.now()): number {
  return PERIOD_MS - (now % PERIOD_MS);
}

// Payouts fire ~this long AFTER the round boundary (the scheduler waits for the
// oracle's final kill snapshot). Keep in sync with the box payout scheduler so
// the on-site countdown hits 0 when SOL actually disperses.
export const PAYOUT_OFFSET_MS = 25_000;

/** ms until the next actual payout (round boundary + the dispersal offset). */
export function msToNextPayout(now: number = Date.now()): number {
  const lastBoundary = Math.floor(now / PERIOD_MS) * PERIOD_MS;
  const thisPayout = lastBoundary + PAYOUT_OFFSET_MS;
  return (now < thisPayout ? thisPayout : lastBoundary + PERIOD_MS + PAYOUT_OFFSET_MS) - now;
}

/**
 * Period the leaderboard should DISPLAY. It lags the live period by the payout
 * offset so a round keeps showing its final standings until its payout has gone
 * out, then resets for the new round — instead of blanking at the boundary
 * mid-countdown.
 */
export function displayHour(now: number = Date.now()): number {
  return Math.floor((now - PAYOUT_OFFSET_MS) / PERIOD_MS);
}
