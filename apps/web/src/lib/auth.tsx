import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { DEV_BYPASS, DEMO_WALLET } from "./config";

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  login: () => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

/** Privy-backed auth — only mounted when DEV_BYPASS is off. */
function PrivyAuthBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useSolanaWallets();
  const walletAddress = wallets[0]?.address ?? null;
  const value = useMemo<AuthState>(
    () => ({ ready, authenticated, walletAddress, login, logout }),
    [ready, authenticated, walletAddress, login, logout],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/** Stub auth for dev-bypass screenshots: a fixed, already-authenticated demo wallet. */
function StubAuthBridge({ children }: { children: ReactNode }) {
  const value = useMemo<AuthState>(
    () => ({
      ready: true,
      authenticated: true,
      walletAddress: DEMO_WALLET,
      login: () => {},
      logout: () => {},
    }),
    [],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return DEV_BYPASS ? (
    <StubAuthBridge>{children}</StubAuthBridge>
  ) : (
    <PrivyAuthBridge>{children}</PrivyAuthBridge>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
