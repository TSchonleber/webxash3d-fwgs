import { useState } from "react";
import { GAME_URL, API_BASE } from "../lib/config";
import { useEligibility } from "../lib/eligibility";
import { useAuth } from "../lib/auth";

/**
 * Entry to the live FFA deathmatch. The player picks a callsign which is
 * registered to their wallet (POST /register) before launch, and the game opens
 * with that exact callsign (?name=). The log sidecar resolves the in-game name
 * back to the wallet, so frags credit — and pay out to — the right player.
 *
 * When the token gate is active, entry is locked below the minimum hold.
 */
export function GamePanel() {
  const e = useEligibility();
  const { walletAddress } = useAuth();
  const locked = e.gateActive && !e.eligible;

  const [callsign, setCallsign] = useState(() => localStorage.getItem("callsign") ?? "");
  const [busy, setBusy] = useState(false);

  const play = async () => {
    const name = callsign.trim();
    if (!name) return;
    localStorage.setItem("callsign", name);
    setBusy(true);
    try {
      if (walletAddress) {
        await fetch(`${API_BASE}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName: name, wallet: walletAddress }),
        }).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
    window.open(`${GAME_URL}?name=${encodeURIComponent(name)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Combat <span className="accent">Arena</span></h2>
        <span className="hint">CS 1.6 · WASM · WEBRTC</span>
      </div>
      <div className="game-wrap">
        <div className="game-overlay">
          <h3>Enter the Arena</h3>
          <p>
            Free-for-all deathmatch on de_train — spawn with a rifle, instant
            respawn. Pick a callsign; your frags pay out to this wallet.
          </p>
          {locked ? (
            <>
              <button className="btn" disabled>🔒 Hold ≥ {e.required} $TOKEN to play</button>
              <p className="lock-note">
                {e.status === "loading"
                  ? "Checking your $TOKEN balance…"
                  : `Your wallet holds ${e.balance ?? 0} $TOKEN. Acquire more to enter the match.`}
              </p>
            </>
          ) : (
            <>
              <div className="play-row">
                <input
                  className="wallet-input mono"
                  placeholder="callsign"
                  maxLength={24}
                  value={callsign}
                  onChange={(ev) => setCallsign(ev.target.value)}
                />
                <button className="btn" disabled={busy || !callsign.trim()} onClick={play}>
                  {busy ? "…" : "▸ Drop In"}
                </button>
              </div>
              <p className="lock-note">
                You'll join under this callsign — it's how the board credits frags to your wallet.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
