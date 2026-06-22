import { keccak_256 } from "js-sha3";
import { PublicKey } from "@solana/web3.js";
import type { Award } from "./types";

const kc = (b: Buffer): Buffer => Buffer.from(keccak_256.arrayBuffer(b));
const u64le = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u64leNum = (n: number): Buffer => u64le(BigInt(n));

export function leafHash(a: Award): Buffer {
  return kc(Buffer.concat([u64leNum(a.index), new PublicKey(a.wallet).toBuffer(), u64le(a.amount)]));
}

function parent(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return kc(Buffer.concat([lo, hi]));
}

export function buildTree(awards: Award[]): { root: Buffer; proofs: Buffer[][] } {
  if (awards.length === 0) throw new Error("empty award set");
  let layer = awards.map(leafHash);
  const layers: Buffer[][] = [layer];
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? parent(layer[i], layer[i + 1]) : layer[i]);
    }
    layer = next;
    layers.push(layer);
  }
  const proofs = awards.map((_, idx) => {
    const proof: Buffer[] = [];
    let i = idx;
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = i % 2 === 0 ? i + 1 : i - 1;
      if (sib < layers[l].length) proof.push(layers[l][sib]);
      i = Math.floor(i / 2);
    }
    return proof;
  });
  return { root: layers[layers.length - 1][0], proofs };
}
