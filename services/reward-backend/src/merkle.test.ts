import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { keccak_256 } from "js-sha3";
import { buildTree, leafHash } from "./merkle";
import type { Award } from "./types";

const A = (index: number, wallet: string, amount: bigint): Award => ({ index, wallet, amount });

describe("merkle", () => {
  it("single-leaf tree root equals the leaf hash", () => {
    const w = PublicKey.default.toBase58();
    const award = A(0, w, 500_000_000n);
    const { root } = buildTree([award]);
    expect(Buffer.compare(root, leafHash(award))).toBe(0);
  });

  it("produces valid proofs that re-derive the root (sorted-pair convention)", () => {
    const ws = Array.from({ length: 5 }, (_, i) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58());
    const awards = ws.map((w, i) => A(i, w, BigInt((i + 1) * 1e8)));
    const { root, proofs } = buildTree(awards);
    // re-derive root from each leaf + proof exactly as the on-chain program does
    const kc = (b: Buffer) => Buffer.from(keccak_256.arrayBuffer(b));
    awards.forEach((a, i) => {
      let node = leafHash(a);
      for (const sib of proofs[i]) {
        const [lo, hi] = Buffer.compare(node, sib) <= 0 ? [node, sib] : [sib, node];
        node = kc(Buffer.concat([lo, hi]));
      }
      expect(Buffer.compare(node, root)).toBe(0);
    });
  });

  it("matches the on-chain helper's root for a fixed vector (cross-compat lock)", () => {
    // EXPECTED is generated once from solana/distributor/tests/merkle.ts on the
    // same awards (index i, claimant = 32-byte buffer filled with i+1, amount=(i+1)*1e8, 3 leaves).
    // Implementer: produce this hex with the anchor helper and paste it here.
    const ws = Array.from({ length: 3 }, (_, i) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58());
    const awards = ws.map((w, i) => A(i, w, BigInt((i + 1) * 1e8)));
    const { root } = buildTree(awards);
    const EXPECTED = "f2fee5023af12745d423133e9f73063d3a4ab8c45b74504edf6b99e08b6a2cc8";
    expect(root.toString("hex")).toBe(EXPECTED);
  });
});
