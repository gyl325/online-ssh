import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getBootstrapStatus } from "./api";

type BootstrapStatusState = "checking" | "ready" | "setup_required";

type BootstrapContextValue = {
  status: BootstrapStatusState;
  setupRequired: boolean;
  setupTokenRequired: boolean;
  refresh: () => Promise<void>;
  markInitialized: () => void;
};

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BootstrapStatusState>("checking");
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);

  const refresh = useCallback(async () => {
    setStatus("checking");
    try {
      const response = await getBootstrapStatus();
      setSetupTokenRequired(Boolean(response.setup_token_required));
      setStatus(response.setup_required ? "setup_required" : "ready");
    } catch {
      setSetupTokenRequired(false);
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: BootstrapContextValue = useMemo(() => ({
    status,
    setupRequired: status === "setup_required",
    setupTokenRequired: status === "setup_required" && setupTokenRequired,
    refresh,
    markInitialized: () => {
      setSetupTokenRequired(false);
      setStatus("ready");
    }
  }), [refresh, setupTokenRequired, status]);

  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}

export function useBootstrap() {
  const value = useContext(BootstrapContext);
  if (!value) {
    throw new Error("useBootstrap must be used within BootstrapProvider");
  }
  return value;
}
