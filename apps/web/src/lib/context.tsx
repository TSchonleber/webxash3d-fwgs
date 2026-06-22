import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Connection } from "@solana/web3.js";
import { RewardApi } from "./api";
import { API_BASE, RPC_URL } from "./config";

interface AppCtx {
  api: RewardApi;
  connection: Connection;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AppCtx>(
    () => ({
      api: new RewardApi(API_BASE),
      connection: new Connection(RPC_URL, "confirmed"),
    }),
    [],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppContextProvider");
  return v;
}
