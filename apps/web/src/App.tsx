import "./theme.css";
import { AuthGate } from "./components/AuthGate";
import { EligibilityBadge } from "./components/EligibilityBadge";
import { PrizePool } from "./components/PrizePool";
import { Leaderboard } from "./components/Leaderboard";
import { GamePanel } from "./components/GamePanel";
import { ClaimPanel } from "./components/ClaimPanel";
import { HowItWorks } from "./components/HowItWorks";
import { useAuth } from "./lib/auth";
import { useLeaderboard } from "./lib/useLeaderboard";
import { DEV_BYPASS } from "./lib/config";
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
function Dashboard() {
  const { walletAddress } = useAuth();
  const live = useLeaderboard();

  const entries = live.entries;

  return (
    <>
      <TopBar />
      <PrizePool contenders={entries.length} />
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
      <HowItWorks />
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
