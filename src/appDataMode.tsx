import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAppDataMode,
  setAppDataMode as writeAppDataMode,
  type AppDataMode,
} from "./appDataModeStorage";

type AppDataModeContextValue = {
  dataMode: AppDataMode;
  setDataMode: (mode: AppDataMode) => void;
};

const AppDataModeContext = createContext<AppDataModeContextValue | null>(null);

export function AppDataModeProvider({ children }: { children: ReactNode }) {
  const [dataMode] = useState<AppDataMode>(() => getAppDataMode());

  const setDataMode = useCallback((mode: AppDataMode) => {
    if (mode === getAppDataMode()) return;
    writeAppDataMode(mode);
    window.location.reload();
  }, []);

  const value = useMemo(
    () => ({ dataMode, setDataMode }),
    [dataMode, setDataMode]
  );

  return (
    <AppDataModeContext.Provider value={value}>
      {children}
    </AppDataModeContext.Provider>
  );
}

export function useAppDataMode(): AppDataModeContextValue {
  const ctx = useContext(AppDataModeContext);
  if (!ctx) {
    throw new Error("useAppDataMode 须在 AppDataModeProvider 内使用");
  }
  return ctx;
}

export type { AppDataMode };
