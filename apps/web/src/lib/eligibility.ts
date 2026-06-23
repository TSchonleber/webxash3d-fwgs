// Token-hold eligibility for the play gate.
//
// Pre-launch (no VITE_TOKEN_MINT) or with VITE_GATE_BYPASS=1, the gate is OPEN:
// everyone is eligible and no balance is read. Once a mint is configured, the
// connected wallet's on-chain SPL balance is read and compared to MIN_HOLD.
import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useAuth } from "./auth";
import { DEV_BYPASS, GATE_BYPASS, TOKEN_MINT, MIN_HOLD, RPC_URL } from "./config";

export type EligStatus = "open" | "loading" | "eligible" | "ineligible" | "no-wallet";

export interface Eligibility {
  /** Coarse state for rendering. */
  status: EligStatus;
  /** May this user enter matches? (true whenever the gate is open) */
  eligible: boolean;
  /** Is the token gate actually enforcing (mint set, not bypassed)? */
  gateActive: boolean;
  /** On-chain token balance (ui amount) once read, else null. */
  balance: number | null;
  /** Minimum hold required. */
  required: number;
}

/** The gate only enforces once a mint is configured and no bypass is set. */
const GATE_ACTIVE = !DEV_BYPASS && !GATE_BYPASS && TOKEN_MINT.length > 0;

export function useEligibility(): Eligibility {
  const { walletAddress } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(GATE_ACTIVE);

  useEffect(() => {
    if (!GATE_ACTIVE || !walletAddress) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const conn = new Connection(RPC_URL, "confirmed");
        const owner = new PublicKey(walletAddress);
        const mint = new PublicKey(TOKEN_MINT);
        const res = await conn.getParsedTokenAccountsByOwner(owner, { mint });
        let total = 0;
        for (const { account } of res.value) {
          const amt = account.data.parsed?.info?.tokenAmount?.uiAmount;
          if (typeof amt === "number") total += amt;
        }
        if (!cancelled) setBalance(total);
      } catch {
        // On RPC failure, fail closed (treat as 0) so the gate isn't bypassed.
        if (!cancelled) setBalance(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  if (!GATE_ACTIVE) {
    return { status: "open", eligible: true, gateActive: false, balance: null, required: MIN_HOLD };
  }
  if (!walletAddress) {
    return { status: "no-wallet", eligible: false, gateActive: true, balance: null, required: MIN_HOLD };
  }
  if (loading) {
    return { status: "loading", eligible: false, gateActive: true, balance, required: MIN_HOLD };
  }
  const eligible = (balance ?? 0) >= MIN_HOLD;
  return {
    status: eligible ? "eligible" : "ineligible",
    eligible,
    gateActive: true,
    balance,
    required: MIN_HOLD,
  };
}
