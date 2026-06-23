import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLeaderboard } from "../lib/useLeaderboard";
import { API_BASE } from "../lib/config";
import { shortWallet } from "../lib/format";

/** Live prize-pool reading (on-chain treasury balance), polled. */
function usePool() {
  const [sol, setSol] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    const tick = () =>
      fetch(`${API_BASE}/pool`)
        .then((r) => r.json())
        .then((d) => on && setSol(typeof d.sol === "number" ? d.sol : 0))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 20000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return sol;
}

const STEPS = [
  { k: "DROP IN", body: "Pick a callsign and load straight into the live free-for-all. No install, no team menu — you spawn with a rifle." },
  { k: "RACK FRAGS", body: "Every kill scores. The board ranks purely by frags and wipes every 30 minutes — each round is a clean slate." },
  { k: "GET PAID", body: "When the round closes, the top fraggers are paid in SOL, straight to the wallet tied to your callsign." },
];

export function Home() {
  const { ready, login } = useAuth();
  const pool = usePool();
  const live = useLeaderboard();
  const top = live.entries.slice(0, 8);

  return (
    <div className="home">
      <header className="home-bar">
        <div className="brand">
          <img className="glyph-logo" src="/logo.png" alt="" />
          <span>Chain<b>Strike</b></span>
        </div>
        <button className="btn ghost home-signin" disabled={!ready} onClick={login}>
          {ready ? "Sign in" : "…"}
        </button>
      </header>

      {/* HERO — a live match readout */}
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="dot" /> LIVE · FREE-FOR-ALL · DE_TRAIN</div>
          <h1>Frag for <span className="g">SOL</span>.</h1>
          <p>
            Counter-Strike 1.6 in your browser. Top the kill count and the prize
            pool pays out on Solana every 30 minutes.
          </p>
          <div className="hero-cta">
            <button className="btn play" disabled={!ready} onClick={login}>▸ SIGN IN TO PLAY</button>
            <span className="hero-note">Sign in to lock your callsign to your wallet — that's how you get paid.</span>
          </div>
        </div>

        {/* HUD card: the prize pool as an in-game readout */}
        <aside className="hud">
          <div className="hud-row">
            <span className="hud-label">PRIZE POOL</span>
            <span className="hud-live"><span className="dot" />LIVE</span>
          </div>
          <div className="hud-pool">
            <span className="hud-pool-num">{pool === null ? "—" : pool.toFixed(2)}</span>
            <span className="hud-pool-unit">SOL</span>
          </div>
          <div className="hud-sub">paid to the top 7 · next payout ≤ 30 min</div>
          <div className="hud-sep" />
          <div className="hud-label">THIS ROUND · TOP FRAGGERS</div>
          <ol className="hud-board">
            {top.length === 0 && (
              <li className="hud-empty" style={{ display: "block", gridColumn: "1 / -1" }}>
                No frags logged this round yet — be the first on the board.
              </li>
            )}
            {top.map((e, i) => (
              <li key={e.wallet} className={i === 0 ? "lead" : ""}>
                <span className="hb-rank">{String(i + 1).padStart(2, "0")}</span>
                <span className="hb-name">{shortWallet(e.wallet)}</span>
                <span className="hb-kills">{(e as { kills?: number }).kills ?? 0}<i> K</i></span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      {/* HOW IT WORKS — a typed sequence (drop -> frag -> paid) */}
      <section className="home-how">
        {STEPS.map((s, i) => (
          <div key={s.k} className="hw">
            <span className="hw-n">{i + 1} / 3</span>
            <h3>{s.k}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </section>

      <footer className="home-foot">
        <span>ChainStrike</span>
        <span className="mono">CS 1.6 · WASM · SOLANA</span>
      </footer>
    </div>
  );
}
