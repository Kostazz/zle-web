import { createContext, useContext, type ReactNode } from "react";
import { getTodaysLogo } from "./imageLoader";

interface LogoContextType {
  logoSrc: string | null;
}

const dailyLogo = getTodaysLogo();
const dailyLogoSrc: string | null = dailyLogo.src ?? null;

const LogoContext = createContext<LogoContextType>({
  logoSrc: dailyLogoSrc,
});

export function LogoProvider({ children }: { children: ReactNode }) {
  return (
    <LogoContext.Provider value={{ logoSrc: dailyLogoSrc }}>
      {children}
    </LogoContext.Provider>
  );
}

export function useTodaysLogo(): string | null {
  const { logoSrc } = useContext(LogoContext);
  return logoSrc;
}
