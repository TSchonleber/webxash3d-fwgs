import "./theme.css";
import { Component, type ReactNode } from "react";
import { Home } from "./components/Home";
import { EligibilityBadge } from "./components/EligibilityBadge";
import { PrizePool } from "./components/PrizePool";
import { Leaderboard } from "./components/Leaderboard";
import { GamePanel } from "./components/GamePanel";
import { ClaimPanel } from "./components/ClaimPanel";
import { WalletPanel } from "./components/WalletPanel";
import { HowItWorks } from "./components/HowItWorks";
import { useAuth } from "./lib/auth";
import { useDailyBoard } from "./lib/useDailyBoard";
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

function Dashboard() {
  const { walletAddress } = useAuth();
  const { board, loading } = useDailyBoard();

  return (
    <>
      <TopBar />
      <PrizePool contenders={board.length} />
      <div className="grid">
        <Leaderboard
          entries={board}
          loading={loading && board.length === 0}
          me={walletAddress}
        />
        <GamePanel />
      </div>
      <div className="grid">
        <WalletPanel />
        <ClaimPanel />
      </div>
      <HowItWorks />
    </>
  );
}

function Root() {
  const { ready, authenticated } = useAuth();
  // One app: logged-out shows the marketing home, logged-in reveals the
  // dashboard. (DEV_BYPASS jumps straight to the dashboard for screenshots.)
  if (DEV_BYPASS) return <Dashboard />;
  if (ready && authenticated) return <Dashboard />;
  return <Home />;
}

/** Catches render crashes so a failure shows a message + reload, never a black screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("ChainStrike crashed:", error); }
  render() {
    if (this.state.error) {
      return (
        <div className="app" style={{ padding: 32, color: "var(--text)" }}>
          <h2>Something went wrong.</h2>
          <p style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            {this.state.error.message}
          </p>
          <button className="btn" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app">
        <Root />
      </div>
    </ErrorBoundary>
  );
}
