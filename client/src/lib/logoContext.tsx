import { createContext, useContext, type ReactNode } from "react";
import { getTodaysLogo } from "./imageLoader";

interface LogoContextType {
  logoSrc: string | null;
}

const dailyLogo = getTodaysLogo();

const LogoContext = createContext<LogoContextType>({ logoSrc: dailyLogo });

export function LogoProvider({ children }: { children: ReactNode }) {
  return (
    <LogoContext.Provider value={{ logoSrc: dailyLogo }}>
      {children}
    </LogoContext.Provider>
  );
}

export function useTodaysLogo(): string | null {
  const { logoSrc } = useContext(LogoContext);
  return logoSrc;
}
