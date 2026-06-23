import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyEnvelope, type SignedEnvelope } from "./verify";
import { MatchStore, type MatchStoreApi } from "./store";
import { rankHour } from "../leaderboard";
import { settleHour } from "../settle";
import { buildClaimArgs } from "../publisher";

export interface AppDeps {
  allowlist: string[];
  minMatches: number;
  vaultLamports: bigint;
  budgetBps: number;
  isEligible: (wallet: string) => Promise<boolean>;
  store?: MatchStoreApi;
  adminToken?: string;
  poolReader?: () => Promise<{ vaultAddress: string; lamports: number }>;
  payoutsReader?: () => Promise<{ sig: string; to: string; lamports: number; blockTime: number }[]>;
}

export function createApp(deps: AppDeps) {
  const store = deps.store ?? new MatchStore();
  const app = new Hono();

  // Player browsers fetch the leaderboard cross-origin (game page :27016 -> API :8787).
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  // TURN credentials for WebRTC NAT traversal. Generates short-lived Cloudflare TURN
  // creds server-side (keeps the API token off the client) and caches them 6h since
  // they're valid 24h. Returns {iceServers:[]} if unconfigured -> client uses direct.
  let iceCache: { servers: unknown; exp: number } | null = null;
  app.get("/ice", async (c) => {
    const keyId = process.env.TURN_KEY_ID;
    const token = process.env.TURN_API_TOKEN;
    if (!keyId || !token) return c.json({ iceServers: [] });
    const now = Date.now();
    if (!iceCache || iceCache.exp < now) {
      try {
        const r = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ttl: 86400 }),
          },
        );
        const d = (await r.json()) as { iceServers?: unknown };
        iceCache = { servers: d.iceServers ?? [], exp: now + 6 * 3600 * 1000 };
      } catch {
        return c.json({ iceServers: [] });
      }
    }
    return c.json({ iceServers: iceCache.servers });
  });

  // Live prize pool = the on-chain vault's SOL balance. Cached 5s so clients can
  // poll fast (to reflect a payout promptly) without hammering the RPC, and so a
  // transient RPC error serves the last good value instead of flapping to 0.
  let poolCache: { ts: number; data: { vaultAddress: string | null; lamports: number; sol: number; denom: string } | null } = { ts: 0, data: null };
  app.get("/pool", async (c) => {
    if (!deps.poolReader) return c.json({ vaultAddress: null, lamports: 0, sol: 0, denom: "SOL" });
    if (poolCache.data && Date.now() - poolCache.ts < 5_000) return c.json(poolCache.data);
    try {
      const { vaultAddress, lamports } = await deps.poolReader();
      const data = { vaultAddress, lamports, sol: lamports / 1e9, denom: "SOL" };
      poolCache = { ts: Date.now(), data };
      return c.json(data);
    } catch {
      if (poolCache.data) return c.json(poolCache.data);
      return c.json({ vaultAddress: null, lamports: 0, sol: 0, denom: "SOL" });
    }
  });

  // Recent on-chain payouts from the treasury, for a public transparency page.
  // Cached 25s so the payout list reflects promptly without hammering the RPC.
  let payoutsCache: { ts: number; data: unknown } = { ts: 0, data: [] };
  app.get("/payouts", async (c) => {
    if (!deps.payoutsReader) return c.json([]);
    if (Date.now() - payoutsCache.ts < 25_000) return c.json(payoutsCache.data);
    try {
      const data = await deps.payoutsReader();
      payoutsCache = { ts: Date.now(), data };
      return c.json(data);
    } catch {
      return c.json(payoutsCache.data);
    }
  });

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
    const vaultLamports = deps.poolReader
      ? BigInt(Math.floor((await deps.poolReader()).lamports))
      : deps.vaultLamports;
    const s = await settleHour(store.matchesForHour(hour), {
      vaultLamports, budgetBps: deps.budgetBps,
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

  // --- player callsign -> wallet registration (persisted via the store) ---
  app.post("/register", async (c) => {
    const { playerName, wallet } = (await c.req.json()) as { playerName?: string; wallet?: string };
    if (!playerName || !wallet) return c.json({ error: "playerName and wallet required" }, 400);
    store.registerName(playerName, wallet);
    return c.json({ registered: true });
  });

  app.get("/resolve/:name", (c) => {
    const wallet = store.resolveName(c.req.param("name"));
    if (!wallet) return c.json({ error: "unknown name" }, 404);
    return c.json({ wallet });
  });

  return app;
}
