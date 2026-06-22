import { Keypair } from "@solana/web3.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { settleHour } from "../src/settle";
import type { MatchResult } from "../src/types";

const OUT = new URL("../../../solana/distributor/tests/settlement.fixture.json", import.meta.url);

async function main() {
  // 10 deterministic winners (seeded) + 10 losers
  const winners = Array.from({ length: 10 }, (_, i) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => i + 1)));
  const losers = Array.from({ length: 10 }, (_, i) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => i + 100)));

  const matches: MatchResult[] = [{
    matchId: "m1", endedAtMs: 1_000_000,
    players: [
      ...winners.map((k) => ({ wallet: k.publicKey.toBase58(), team: "A" as const, won: true, kills: 18, deaths: 6, headshots: 3, shotsFired: 180, shotsHit: 70, avgReactionMs: 240 })),
      ...losers.map((k) => ({ wallet: k.publicKey.toBase58(), team: "B" as const, won: false, kills: 7, deaths: 14, headshots: 1, shotsFired: 180, shotsHit: 60, avgReactionMs: 270 })),
    ],
  }];

  const s = await settleHour(matches, { vaultLamports: 1_000_000_000n, budgetBps: 1000, minMatches: 1, isEligible: async () => true, periodId: 777 });

  const byWallet = new Map(winners.map((k) => [k.publicKey.toBase58(), k]));
  const fixture = {
    periodId: s.periodId,
    rootHex: s.root.toString("hex"),
    total: s.totalAmount.toString(),
    awards: s.awards.map((a) => ({
      index: a.index,
      wallet: a.wallet,
      amount: a.amount.toString(),
      secretKey: Array.from(byWallet.get(a.wallet)!.secretKey),
      proofHex: s.proofsByWallet[a.wallet].map((b) => b.toString("hex")),
    })),
  };
  mkdirSync(new URL("./", OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2));
  console.log(`wrote ${fixture.awards.length} awards, total ${fixture.total} lamports -> ${OUT.pathname}`);
}
main();
