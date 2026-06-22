import { useRef, useState } from "react";

type Phase = "idle" | "loading" | "connecting" | "needs-assets" | "running" | "error";

/**
 * Ports the Xash3DWebRTC start-button + canvas from the existing embed
 * (examples/react-typescript-cs16-webrtc). The engine + .wasm/asset URLs live in
 * ../game/* and are loaded *lazily* via dynamic import, so the initial render and
 * the leaderboard/prize/claim UI never depend on the game bundle.
 *
 * Actually playing needs the CS 1.6 assets (valve.zip) + a running cs-web-server
 * on ws://localhost:27016, so without those we surface a "connecting / assets
 * required" state (documented in the README).
 */
export function GamePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string>("");

  async function start() {
    if (!canvasRef.current) return;
    setPhase("loading");
    setDetail("Streaming WASM engine modules…");
    try {
      const mod = await import("../game/launch");
      setPhase("connecting");
      setDetail("Reaching cs-web-server on ws://localhost:27016 …");
      await mod.launchGame(canvasRef.current);
      setPhase("running");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Missing assets / server / mic permission => the expected "needs-assets" path.
      if (/valve\.zip|assets|websocket|getUserMedia|fetch|network|404/i.test(msg)) {
        setPhase("needs-assets");
      } else {
        setPhase("error");
      }
      setDetail(msg);
    }
  }

  const overlayVisible = phase !== "running";

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Combat <span className="accent">Arena</span></h2>
        <span className="hint">CS 1.6 · WASM · WEBRTC</span>
      </div>
      <div className="game-wrap">
        <canvas id="canvas" ref={canvasRef} />
        {overlayVisible && (
          <div className="game-overlay">
            <span className="tag">XASH3D-FWGS ENGINE</span>
            {phase === "idle" && (
              <>
                <h3>Drop Into the Server</h3>
                <p>
                  Launch the browser-native Counter-Strike 1.6 client. Live matches
                  feed the leaderboard above.
                </p>
                <button className="btn" onClick={start}>Launch Client</button>
              </>
            )}
            {phase === "loading" && (
              <>
                <h3>Booting Engine…</h3>
                <p>{detail}</p>
              </>
            )}
            {phase === "connecting" && (
              <>
                <h3>Connecting…</h3>
                <p>Negotiating WebRTC with the match server.</p>
                <div className="game-status">{detail}</div>
              </>
            )}
            {phase === "needs-assets" && (
              <>
                <h3>Assets Required</h3>
                <p>
                  Gameplay needs the CS 1.6 assets (valve.zip) and a running
                  cs-web-server. The panel is wired and ready once those are in place.
                </p>
                <div className="game-status">{detail || "Engine bundle / assets not present."}</div>
                <button className="btn ghost" onClick={start}>Retry</button>
              </>
            )}
            {phase === "error" && (
              <>
                <h3>Launch Failed</h3>
                <p>The engine could not start.</p>
                <div className="game-status">{detail}</div>
                <button className="btn ghost" onClick={start}>Retry</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
