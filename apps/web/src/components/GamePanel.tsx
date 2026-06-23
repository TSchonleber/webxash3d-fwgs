import { LOBBY_URL } from "../lib/config";
import { useEligibility } from "../lib/eligibility";

/**
 * Sends players to the match lobby (the landing's "Live matches" section) so
 * they pick a server, rather than dropping into one fixed match.
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
          <h3>Pick Your Match</h3>
          <p>
            Browse the live ChainStrike servers and jump into any one — or
            spectate. Your frags feed the leaderboard.
          </p>
          {locked ? (
            <>
              <button className="btn" disabled>
                🔒 Hold ≥ {e.required} $TOKEN to play
              </button>
              <p className="lock-note">
                {e.status === "loading"
                  ? "Checking your $TOKEN balance…"
                  : `Your wallet holds ${e.balance ?? 0} $TOKEN. Acquire more to enter matches.`}
              </p>
            </>
          ) : (
            <a className="btn" href={LOBBY_URL} target="_blank" rel="noopener noreferrer">
              Browse Live Matches ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
