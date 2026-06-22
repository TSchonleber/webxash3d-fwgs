import { GAME_URL } from "../lib/config";

/**
 * The playable client lives on the standalone cs-web-server (with the CS 1.6
 * assets + WebRTC). The dashboard just launches it rather than re-embedding a
 * second copy (which has no valve.zip and no server on its own origin).
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
          <h3>Drop Into the Server</h3>
          <p>
            Launch the browser-native Counter-Strike 1.6 client. Your frags this
            round feed the leaderboard.
          </p>
          <a className="btn" href={GAME_URL} target="_blank" rel="noopener noreferrer">
            Launch Client ↗
          </a>
        </div>
      </div>
    </div>
  );
}
