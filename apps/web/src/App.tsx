import "./theme.css";
import { AuthGate } from "./components/AuthGate";
import { EligibilityBadge } from "./components/EligibilityBadge";
import { PrizePool } from "./components/PrizePool";
import { Leaderboard } from "./components/Leaderboard";
import { GamePanel } from "./components/GamePanel";
import { ClaimPanel } from "./components/ClaimPanel";
import { useAuth } from "./lib/auth";
import { useLeaderboard } from "./lib/useLeaderboard";
import { DEV_BYPASS } from "./lib/config";
import { demoLeaderboard, DEMO_POOL_LAMPORTS } from "./lib/demo";
import { shortWallet } from "./lib/format";

function TopBar() {
  const { walletAddress, authenticated, logout } = useAuth();
  return (
    <header className="topbar">
      <div className="brand">
        <img className="glyph-logo" src="/logo.png" alt="" />
        <span>Chain<b>Strike</b></span>
      </div>
      <div className="topbar-right">
        <span className="live"><span className="dot" /> Live</span>
        <EligibilityBadge />
        {walletAddress && (
          <span className="wallet-chip mono">
            <b>◎</b> {shortWallet(walletAddress)}
          </span>
        )}
        {authenticated && !DEV_BYPASS && (
          <button className="btn ghost" onClick={logout}>Log out</button>
        )}
      </div>
    </header>
  );
}

/** Derive a display pool from total points (1 point ≈ 250 $TOKEN), in lamports. */
function poolFromBoard(entries: { points: number }[]): string {
  const totalPoints = entries.reduce((s, e) => s + e.points, 0);
  const lamports = BigInt(totalPoints) * 250n * 1_000_000_000n;
  return lamports.toString();
}

function Dashboard() {
  const { walletAddress } = useAuth();
  const live = useLeaderboard();

  // In dev-bypass with no API running, populate the board so the UI renders fully.
  const entries = live.entries.length > 0 ? live.entries : DEV_BYPASS ? demoLeaderboard() : [];
  const pool =
    live.entries.length === 0 && DEV_BYPASS ? DEMO_POOL_LAMPORTS : poolFromBoard(entries);

  return (
    <>
      <TopBar />
      <PrizePool poolLamports={pool} contenders={entries.length} />
      <div className="grid">
        <Leaderboard
          entries={entries}
          loading={live.loading && entries.length === 0}
          hour={live.hour}
          me={walletAddress}
        />
        <GamePanel />
      </div>
      <ClaimPanel />
    </>
  );
}

export default function App() {
  return (
    <div className="app">
      <AuthGate>
        <Dashboard />
      </AuthGate>
    </div>
  );
}
