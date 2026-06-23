import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { API_BASE, TOKEN_MINT, TOKEN_SYMBOL, msToNextDailyPayout } from "../lib/config";
import type { DailyEntry } from "../lib/api";
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
    const id = setInterval(tick, 8000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return sol;
}

/** Recent on-chain payouts from the treasury (server-cached, polled). */
function usePayouts() {
  const [payouts, setPayouts] = useState<{ sig: string; to: string; lamports: number; blockTime: number }[]>([]);
  useEffect(() => {
    let on = true;
    const tick = () =>
      fetch(`${API_BASE}/payouts`)
        .then((r) => r.json())
        .then((d) => on && setPayouts(Array.isArray(d) ? d : []))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return payouts;
}

/** Daily Top-10 skill leaderboard (kills/wins/streaks − deaths), polled. */
function useDailyBoard() {
  const [board, setBoard] = useState<DailyEntry[]>([]);
  useEffect(() => {
    let on = true;
    const tick = () =>
      fetch(`${API_BASE}/leaderboard/daily`)
        .then((r) => r.json())
        .then((d) => on && setBoard(Array.isArray(d) ? d : []))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return board;
}

const TREASURY = "6omjnxK1H4X3JaJZmwr8jzyEUY5jwgaDsP4mQcxeDJjk";

const STEPS = [
  { k: "DROP IN", body: "Pick a callsign and load straight into the live free-for-all. No install, no team menu — you spawn with a rifle." },
  { k: "RACK FRAGS", body: "Every kill scores. You're ranked by a skill score — kills, win streaks and lobby wins, minus deaths — on a board that runs all day and resets at midnight UTC." },
  { k: "GET PAID", body: "Each day the Top 10 on the leaderboard are paid in SOL, straight to the wallet tied to your callsign." },
];

export function Home() {
  const { ready, login } = useAuth();
  const pool = usePool();
  const top = useDailyBoard().slice(0, 10);
  const payouts = usePayouts();
  const [toPay, setToPay] = useState(() => msToNextDailyPayout());
  useEffect(() => {
    const id = setInterval(() => setToPay(msToNextDailyPayout()), 1000);
    return () => clearInterval(id);
  }, []);
  const payHrs = Math.max(0, Math.floor(toPay / 3_600_000));
  const payMin = Math.max(0, Math.floor((toPay % 3_600_000) / 60000));
  const paySec = Math.max(0, Math.floor((toPay % 60000) / 1000));
  const [caCopied, setCaCopied] = useState(false);
  const copyCA = () => {
    navigator.clipboard?.writeText(TOKEN_MINT);
    setCaCopied(true);
    setTimeout(() => setCaCopied(false), 1500);
  };

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
            Counter-Strike 1.6 in your browser. Climb the daily skill
            leaderboard — the Top 10 are paid in SOL every day.
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
          <div className="hud-sub">paid to today's <b>Top 10</b> · daily payout in <b className="mono">{payHrs}:{String(payMin).padStart(2, "0")}:{String(paySec).padStart(2, "0")}</b></div>
          <div className="hud-sep" />
          <div className="hud-label">TODAY · TOP 10 · BY SKILL SCORE</div>
          <ol className="hud-board">
            {top.length === 0 && (
              <li className="hud-empty" style={{ display: "block", gridColumn: "1 / -1" }}>
                No frags logged today yet — be the first on the board.
              </li>
            )}
            {top.map((e, i) => (
              <li key={e.wallet} className={i === 0 ? "lead" : ""}>
                <span className="hb-rank">{String(i + 1).padStart(2, "0")}</span>
                <span className="hb-name">
                  <span className="hb-who">{shortWallet(e.wallet)}</span>
                  <small className="hb-sub">{e.kills}K / {e.deaths}D · {e.kd} K/D · {e.winPct}% W{e.accuracy ? ` · ${e.accuracy}% ACC` : ""}{e.bestStreak ? ` · ${e.bestStreak} streak` : ""}</small>
                </span>
                <span className="hb-kills">{e.score}<i> PTS</i></span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      {/* CONTRACT ADDRESS — placeholder pre-launch, real CA + copy once minted */}
      <section className="ca-strip">
        <span className="ca-label">{TOKEN_SYMBOL} CONTRACT</span>
        {TOKEN_MINT ? (
          <>
            <code className="ca-addr mono">{TOKEN_MINT}</code>
            <button className="ca-copy" onClick={copyCA}>{caCopied ? "Copied" : "Copy"}</button>
            <a className="ca-link" href={`https://solscan.io/token/${TOKEN_MINT}`} target="_blank" rel="noreferrer">Solscan ↗</a>
          </>
        ) : (
          <span className="ca-soon mono">Address posts here at token launch</span>
        )}
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

      {/* RECENT PAYOUTS — live on-chain transparency */}
      {payouts.length > 0 && (
        <section className="payouts">
          <div className="payouts-head">
            <span className="ca-label">RECENT PAYOUTS · ON-CHAIN</span>
            <a className="ca-link" href={`https://solscan.io/account/${TREASURY}`} target="_blank" rel="noreferrer">Treasury ↗</a>
          </div>
          <ul className="payouts-list mono">
            {payouts.slice(0, 10).map((p) => (
              <li key={p.sig}>
                <span className="po-amt">{(p.lamports / 1e9).toFixed(3)} SOL</span>
                <span className="po-to">→ {shortWallet(p.to)}</span>
                <a className="po-tx" href={`https://solscan.io/tx/${p.sig}`} target="_blank" rel="noreferrer">tx ↗</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="home-foot">
        <span>ChainStrike</span>
        <span className="mono">CS 1.6 · WASM · SOLANA</span>
      </footer>
    </div>
  );
}
