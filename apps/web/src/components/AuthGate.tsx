import type { ReactNode } from "react";
import { DEV_BYPASS } from "../lib/config";
import { useAuth } from "../lib/auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, login } = useAuth();

  // Dev bypass renders the main app directly (no Privy app id required).
  if (DEV_BYPASS || authenticated) return <>{children}</>;

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <img className="glyph-logo" src="/logo.png" alt="" />
        <span>Chain<b>Strike</b></span>
        </div>
        <h1>Enter ChainStrike</h1>
        <p>
          Log in to track your live ranking, watch the prize pool, and claim your cut
          of the 15-min settlement. Email or connect a Solana wallet.
        </p>
        <button className="btn" disabled={!ready} onClick={login}>
          {ready ? "Log in / Connect Wallet" : "Loading…"}
        </button>
        <div className="fine">SOLANA · DEVNET · NON-CUSTODIAL · POWERED BY PRIVY</div>
      </div>
    </div>
  );
}
