import jsSha3 from "js-sha3";
const { keccak_256 } = jsSha3;
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface Award { index: number; claimant: PublicKey; amount: BN; }

const u64le = (n: BN): Buffer => n.toArrayLike(Buffer, "le", 8);
const u64leNum = (n: number): Buffer => new BN(n).toArrayLike(Buffer, "le", 8);
const kc = (b: Buffer): Buffer => Buffer.from(keccak_256.arrayBuffer(b));

export function leafHash(a: Award): Buffer {
  return kc(Buffer.concat([u64leNum(a.index), a.claimant.toBuffer(), u64le(a.amount)]));
}

function parent(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return kc(Buffer.concat([lo, hi]));
}

export function buildTree(awards: Award[]): { root: Buffer; proofs: Buffer[][] } {
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
  const root = layers[layers.length - 1][0];
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
  return { root, proofs };
}
