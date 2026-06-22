import nacl from "tweetnacl";
import type { MatchResult } from "../types";

export interface SignedEnvelope { result: string; signature: string; serverPubkey: string; }

export function verifyEnvelope(env: SignedEnvelope, allowlist: string[]): MatchResult | null {
  if (!allowlist.includes(env.serverPubkey)) return null;
  try {
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(env.result),
      Buffer.from(env.signature, "base64"),
      Buffer.from(env.serverPubkey, "base64")
    );
    if (!ok) return null;
    return JSON.parse(env.result) as MatchResult;
  } catch {
    return null;
  }
}
