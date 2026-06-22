import { LOBBY_URL } from "../lib/config";

/**
 * Sends players to the match lobby (the landing's "Live matches" section) so
 * they pick a server, rather than dropping into one fixed match.
 */
export function GamePanel() {
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
          <a className="btn" href={LOBBY_URL} target="_blank" rel="noopener noreferrer">
            Browse Live Matches ↗
          </a>
        </div>
      </div>
    </div>
  );
}
