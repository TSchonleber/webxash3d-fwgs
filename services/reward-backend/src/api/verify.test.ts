import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { verifyEnvelope } from "./verify";

function makeEnvelope(matchId: string, keypair: nacl.SignKeyPair) {
  const result = JSON.stringify({ matchId, endedAtMs: 1, players: [] });
  const sig = nacl.sign.detached(new TextEncoder().encode(result), keypair.secretKey);
  return {
    result,
    signature: Buffer.from(sig).toString("base64"),
    serverPubkey: Buffer.from(keypair.publicKey).toString("base64"),
  };
}

describe("verifyEnvelope", () => {
  it("accepts a valid signature from an allowlisted server", () => {
    const kp = nacl.sign.keyPair();
    const allow = [Buffer.from(kp.publicKey).toString("base64")];
    const res = verifyEnvelope(makeEnvelope("m1", kp), allow);
    expect(res?.matchId).toBe("m1");
  });
  it("rejects a server not on the allowlist", () => {
    const kp = nacl.sign.keyPair();
    expect(verifyEnvelope(makeEnvelope("m1", kp), [])).toBeNull();
  });
  it("rejects a tampered result", () => {
    const kp = nacl.sign.keyPair();
    const allow = [Buffer.from(kp.publicKey).toString("base64")];
    const env = makeEnvelope("m1", kp);
    env.result = env.result.replace("m1", "m2"); // tamper after signing
    expect(verifyEnvelope(env, allow)).toBeNull();
  });
});
