import type { RankedEntry } from "./api";
import { DEMO_WALLET } from "./config";

const HANDLES = [
  "7Gk9", "Bx2Q", "Zr4M", "Np8V", "Qw5T", "Lc3H", "Fy6R", "Vd1S", "Hu9K", "Jm2P",
  "Ao7B", "Ke4D",
];

/** A populated board used only in dev-bypass so the UI renders fully without the API. */
export function demoLeaderboard(): RankedEntry[] {
  const rows: RankedEntry[] = HANDLES.map((h, i) => ({
    wallet: `${h}${"x".repeat(36)}${(40 + i).toString(36)}`,
    points: Math.round(980 - i * 67 - (i % 3) * 11),
    matches: 12 - Math.floor(i / 2),
    rank: i + 1,
  }));
  // Drop the demo wallet into the mix so the "me" highlight is visible.
  rows[3] = { wallet: DEMO_WALLET, points: 612, matches: 9, rank: 4 };
  return rows;
}

/** Plausible pool figure (lamports) for dev-bypass. */
export const DEMO_POOL_LAMPORTS = "184250000000000"; // ~184,250 $TOKEN @ 9 decimals
