import { GAME_URL } from "../lib/config";
import { useEligibility } from "../lib/eligibility";

/**
 * Drops the player straight into the single live FFA deathmatch server.
 *
 * When the token gate is active, entry is locked for wallets below the minimum
 * hold. Pre-launch / bypass the gate is open and the button works normally.
 */
export function GamePanel() {
  const e = useEligibility();
  const locked = e.gateActive && !e.eligible;

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
            respawn. Click play and you're in. Every frag climbs the leaderboard.
          </p>
          {locked ? (
            <>
              <button className="btn" disabled>
                🔒 Hold ≥ {e.required} $TOKEN to play
              </button>
              <p className="lock-note">
                {e.status === "loading"
                  ? "Checking your $TOKEN balance…"
                  : `Your wallet holds ${e.balance ?? 0} $TOKEN. Acquire more to enter the match.`}
              </p>
            </>
          ) : (
            <a className="btn" href={GAME_URL} target="_blank" rel="noopener noreferrer">
              ▸ Drop Into the Game
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
