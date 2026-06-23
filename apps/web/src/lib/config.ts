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

// A deterministic demo wallet shown in dev-bypass so the UI is fully populated.
export const DEMO_WALLET = "Dmo7xAshArEna1111111111111111111111111111111";

/** UTC hour bucket (unix-hours) used as the period id, matching the backend. */
export function currentUtcHour(now: number = Date.now()): number {
  return Math.floor(now / 1_800_000); // 30-min period
}

/** ms remaining until the top of the next UTC hour. */
export function msToNextHour(now: number = Date.now()): number {
  return 1_800_000 - (now % 1_800_000);
}
