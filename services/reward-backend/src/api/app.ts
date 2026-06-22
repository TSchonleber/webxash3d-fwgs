import { Hono } from "hono";
import { verifyEnvelope, type SignedEnvelope } from "./verify";
import { MatchStore } from "./store";
import { rankHour } from "../leaderboard";
import { settleHour } from "../settle";
import { buildClaimArgs } from "../publisher";

export interface AppDeps {
  allowlist: string[];
  minMatches: number;
  vaultLamports: bigint;
  budgetBps: number;
  isEligible: (wallet: string) => Promise<boolean>;
  store?: MatchStore;
  adminToken?: string;
}

export function createApp(deps: AppDeps) {
  const store = deps.store ?? new MatchStore();
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/results", async (c) => {
    const env = (await c.req.json()) as SignedEnvelope;
    const result = verifyEnvelope(env, deps.allowlist);
    if (!result) return c.json({ error: "invalid signature or unknown server" }, 401);
    store.addMatch(result);
    return c.json({ stored: true });
  });

  app.get("/leaderboard/:hour", (c) => {
    const hour = Number(c.req.param("hour"));
    return c.json(rankHour(store.matchesForHour(hour), { minMatches: deps.minMatches }));
  });

  app.post("/settle/:hour", async (c) => {
    const hour = Number(c.req.param("hour"));
    const s = await settleHour(store.matchesForHour(hour), {
      vaultLamports: deps.vaultLamports, budgetBps: deps.budgetBps,
      minMatches: deps.minMatches, isEligible: deps.isEligible, periodId: hour,
    });
    store.saveSettlement(hour, s);
    return c.json({ periodId: s.periodId, total: s.totalAmount.toString(), winners: s.awards.length });
  });

  app.get("/claim/:hour/:wallet", (c) => {
    const hour = Number(c.req.param("hour"));
    const wallet = c.req.param("wallet");
    const s = store.getSettlement(hour);
    if (!s) return c.json({ error: "hour not settled" }, 404);
    try {
      const args = buildClaimArgs(s, wallet);
      return c.json({
        periodId: args.periodId.toNumber(),
        index: args.index.toNumber(),
        amount: args.amount.toString(),
        proof: args.proof.map((p) => Buffer.from(p).toString("hex")),
      });
    } catch {
      return c.json({ error: "not a winner" }, 404);
    }
  });

  // --- admin (operator) routes ---
  const requireAdmin = (c: any): Response | null => {
    if (!deps.adminToken) return c.json({ error: "admin disabled" }, 404);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${deps.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    return null;
  };

  app.get("/admin/settlement/:hour", (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const hour = Number(c.req.param("hour"));
    const s = store.getSettlement(hour);
    if (!s) return c.json({ error: "hour not settled" }, 404);
    return c.json({
      periodId: s.periodId,
      rootHex: Buffer.from(s.root).toString("hex"),
      total: s.totalAmount.toString(),
      awards: s.awards.map((a) => ({
        index: a.index, wallet: a.wallet, amount: a.amount.toString(),
        proofHex: s.proofsByWallet[a.wallet].map((b) => Buffer.from(b).toString("hex")),
      })),
    });
  });

  return app;
}
