import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AppContextProvider } from "../lib/context";
import { AuthProvider } from "../lib/auth";
import { DEV_BYPASS, PRIVY_APP_ID } from "../lib/config";

/**
 * Root providers.
 *
 * In DEV_BYPASS mode we skip PrivyProvider entirely so the app renders without
 * a real Privy app id (viewable / screenshot-able). The auth layer is stubbed
 * by AuthProvider in that mode, so no Privy hooks are ever called.
 */
export function Providers({ children }: { children: ReactNode }) {
  const inner = (
    <AppContextProvider>
      <AuthProvider>{children}</AuthProvider>
    </AppContextProvider>
  );

  if (DEV_BYPASS) return inner;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "dark", accentColor: "#c6ff3d", walletChainType: "solana-only" },
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {inner}
    </PrivyProvider>
  );
}
