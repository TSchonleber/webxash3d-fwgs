import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { createApp } from "./app";

// Plan 2's merkle leafHash decodes each wallet as a base58 Solana PublicKey,
// so the fixture must use valid base58 pubkeys (the plan's "W${i}" strings are
// not valid base58). Identities only; ranking is positional (see matchAt stats).
const wallets = Array.from({ length: 10 }, () => Keypair.generate().publicKey.toBase58());

function signedEnvelope(result: object, kp: nacl.SignKeyPair) {
  const r = JSON.stringify(result);
  const sig = nacl.sign.detached(new TextEncoder().encode(r), kp.secretKey);
  return { result: r, signature: Buffer.from(sig).toString("base64"), serverPubkey: Buffer.from(kp.publicKey).toString("base64") };
}

const hour = 100;
const matchAt = (id: string) => ({
  matchId: id, endedAtMs: hour * 3600_000,
  players: Array.from({ length: 10 }, (_, i) => ({
    wallet: wallets[i], team: i < 5 ? "A" : "B", won: i < 5, kills: 15 - i, deaths: 5, headshots: 2,
    shotsFired: 100, shotsHit: 40, avgReactionMs: 300,
  })),
});

describe("createApp", () => {
  const kp = nacl.sign.keyPair();
  const deps = {
    allowlist: [Buffer.from(kp.publicKey).toString("base64")],
    minMatches: 1,
    vaultLamports: 1_000_000_000n,
    budgetBps: 1000,
    isEligible: async () => true,
  };

  it("health ok", async () => {
    const res = await createApp(deps).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects an unsigned/forged result with 401", async () => {
    const app = createApp(deps);
    const forged = { result: JSON.stringify(matchAt("m1")), signature: "AA", serverPubkey: "BB" };
    const res = await app.request("/results", { method: "POST", body: JSON.stringify(forged), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("ingests a signed result, ranks it, settles, and serves a claim", async () => {
    const app = createApp(deps);
    const post = await app.request("/results", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(signedEnvelope(matchAt("m1"), kp)),
    });
    expect(post.status).toBe(200);

    const lb = await (await app.request(`/leaderboard/${hour}`)).json();
    expect(lb.length).toBe(10);
    expect(lb[0].rank).toBe(1);

    const settle = await (await app.request(`/settle/${hour}`, { method: "POST" })).json();
    expect(settle.winners).toBeGreaterThan(0);
    expect(settle.total).toBe("100000000");

    const top = lb[0].wallet;
    const claim = await app.request(`/claim/${hour}/${top}`);
    expect(claim.status).toBe(200);
    const cj = await claim.json();
    expect(cj.index).toBe(0);
    expect(Array.isArray(cj.proof)).toBe(true);

    const miss = await app.request(`/claim/${hour}/NOBODY`);
    expect(miss.status).toBe(404);
  });
});
