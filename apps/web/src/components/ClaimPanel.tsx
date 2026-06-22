import { useEffect, useState } from "react";
import type { ClaimData } from "../lib/api";
import { useApp } from "../lib/context";
import { useAuth } from "../lib/auth";
import { currentUtcHour } from "../lib/config";
import { formatTokenAmount } from "../lib/format";

type TxState =
  | { kind: "none" }
  | { kind: "signing" }
  | { kind: "ok"; sig: string }
  | { kind: "err"; msg: string };

export function ClaimPanel() {
  const { api } = useApp();
  const { walletAddress } = useAuth();
  const prevHour = currentUtcHour() - 1;

  const [claim, setClaim] = useState<ClaimData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tx, setTx] = useState<TxState>({ kind: "none" });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setTx({ kind: "none" });
    (async () => {
      if (!walletAddress) {
        if (alive) { setClaim(null); setLoading(false); }
        return;
      }
      try {
        const c = await api.claim(prevHour, walletAddress);
        if (alive) setClaim(c);
      } catch {
        if (alive) setClaim(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [api, walletAddress, prevHour]);

  async function onClaim() {
    if (!claim || !walletAddress) return;
    setTx({ kind: "signing" });
    try {
      // Anchor (and its Buffer usage) is imported lazily, only on claim, so it
      // never runs on the main render path.
      const [{ buildClaimProgram }, { submitClaim }] = await Promise.all([
        import("../lib/program"),
        import("../lib/claim"),
      ]);
      const program = await buildClaimProgram(walletAddress);
      const sig = await submitClaim(program, walletAddress, claim);
      setTx({ kind: "ok", sig });
    } catch (err) {
      setTx({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  const amount = claim ? formatTokenAmount(claim.amount) : null;

  return (
    <div className="claim">
      <div className="left">
        <span className="label">Last Settlement · Hour #{prevHour}</span>
        {loading ? (
          <span className="amt none mono">Checking…</span>
        ) : amount ? (
          <span className="amt mono">{amount} <span style={{ fontSize: "0.4em", color: "var(--text)" }}>$TOKEN</span></span>
        ) : (
          <span className="amt none mono">No reward to claim</span>
        )}
      </div>
      <div className="right">
        {tx.kind === "ok" && <span className="tx ok mono">✓ {tx.sig}</span>}
        {tx.kind === "err" && <span className="tx err mono">{tx.msg}</span>}
        <button
          className="btn mag"
          disabled={!claim || tx.kind === "signing" || tx.kind === "ok"}
          onClick={onClaim}
        >
          {tx.kind === "signing" ? "Signing…" : tx.kind === "ok" ? "Claimed" : "Claim Reward"}
        </button>
      </div>
    </div>
  );
}
