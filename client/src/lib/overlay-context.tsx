import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

export type OverlayEntry =
  | { type: "product"; productId: string }
  | { type: "cart" }
  | { type: "mobile-menu" };

export type OverlayType = OverlayEntry["type"];

type OverlayContextValue = {
  overlays: OverlayEntry[];
  topOverlay: OverlayEntry | null;
  openOverlay: (entry: OverlayEntry) => void;
  closeTopOverlay: () => void;
  closeOverlay: (type: OverlayType) => void;
  closeOverlayAndWait: (type: OverlayType) => Promise<void>;
  isOpen: (type: OverlayType) => boolean;
  isTopOverlay: (type: OverlayType) => boolean;
  getOverlay: <T extends OverlayType>(type: T) => Extract<OverlayEntry, { type: T }> | null;
};

const OverlayContext = createContext<OverlayContextValue | undefined>(undefined);

function pushOverlayState(type: OverlayType) {
  window.history.pushState(
    {
      ...window.history.state,
      __zleOverlay: type,
    },
    "",
    window.location.href
  );
}

function moveOverlayToTop(overlays: OverlayEntry[], entry: OverlayEntry): OverlayEntry[] {
  let existingIndex = -1;
  for (let index = overlays.length - 1; index >= 0; index -= 1) {
    if (overlays[index]?.type === entry.type) {
      existingIndex = index;
      break;
    }
  }

  if (existingIndex === -1) {
    return [...overlays, entry];
  }

  const next = [...overlays];
  next.splice(existingIndex, 1);
  next.push(entry);
  return next;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [overlays, setOverlays] = useState<OverlayEntry[]>([]);
  const overlaysRef = useRef<OverlayEntry[]>([]);
  const isHandlingPopstateRef = useRef(false);
  const previousBodyOverflowRef = useRef<string | null>(null);
  const closeWaitersRef = useRef<Partial<Record<OverlayType, Array<() => void>>>>({});

  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  const openOverlay = useCallback((entry: OverlayEntry) => {
    let shouldPushHistory = false;

    setOverlays((prev) => {
      const currentTop = prev[prev.length - 1];
      const next = moveOverlayToTop(prev, entry);
      const nextTop = next[next.length - 1];
      const isNoopReopen = currentTop && nextTop && currentTop.type === nextTop.type && JSON.stringify(currentTop) === JSON.stringify(nextTop);
      shouldPushHistory = Boolean(nextTop && (!currentTop || (currentTop.type !== nextTop.type && !isNoopReopen)));
      return next;
    });

    if (typeof window !== "undefined" && shouldPushHistory && !isHandlingPopstateRef.current) {
      pushOverlayState(entry.type);
    }
  }, []);

  const closeTopOverlay = useCallback(() => {
    const topOverlay = overlaysRef.current[overlaysRef.current.length - 1];
    if (!topOverlay) {
      return;
    }

    if (typeof window !== "undefined" && !isHandlingPopstateRef.current) {
      window.history.back();
      return;
    }

    setOverlays((prev) => prev.slice(0, -1));
  }, []);

  const closeOverlay = useCallback(
    (type: OverlayType) => {
      const current = overlaysRef.current;
      const index = current.findIndex((entry) => entry.type === type);
      if (index === -1) {
        return;
      }

      const isTop = index === current.length - 1;
      if (isTop) {
        closeTopOverlay();
        return;
      }

      setOverlays((prev) => prev.filter((entry) => entry.type !== type));
    },
    [closeTopOverlay]
  );

  const closeOverlayAndWait = useCallback(
    async (type: OverlayType) => {
      if (!overlaysRef.current.some((entry) => entry.type === type)) {
        return;
      }

      await new Promise<void>((resolve) => {
        const waiters = closeWaitersRef.current[type] ?? [];
        waiters.push(resolve);
        closeWaitersRef.current[type] = waiters;
        closeOverlay(type);
      });
    },
    [closeOverlay]
  );

  useEffect(() => {
    const openTypes = new Set(overlays.map((entry) => entry.type));

    for (const type of Object.keys(closeWaitersRef.current) as OverlayType[]) {
      if (openTypes.has(type)) {
        continue;
      }

      const waiters = closeWaitersRef.current[type];
      if (!waiters || waiters.length === 0) {
        continue;
      }

      delete closeWaitersRef.current[type];
      waiters.forEach((resolve) => resolve());
    }
  }, [overlays]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopstate = () => {
      if (overlaysRef.current.length === 0) {
        return;
      }

      const stateOverlay = window.history.state?.__zleOverlay ?? window.history.state?._zleOverlay;
      if (!stateOverlay) {
        console.debug("[overlay] popstate without overlay marker, closing top overlay safely");
      }

      isHandlingPopstateRef.current = true;
      setOverlays((prev) => prev.slice(0, -1));
      queueMicrotask(() => {
        isHandlingPopstateRef.current = false;
      });
    };

    window.addEventListener("popstate", handlePopstate);
    return () => {
      window.removeEventListener("popstate", handlePopstate);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const bodyStyle = document.body.style;

    if (overlays.length > 0) {
      if (previousBodyOverflowRef.current === null) {
        previousBodyOverflowRef.current = bodyStyle.overflow;
      }
      bodyStyle.overflow = "hidden";
      return;
    }

    if (previousBodyOverflowRef.current !== null) {
      bodyStyle.overflow = previousBodyOverflowRef.current;
      previousBodyOverflowRef.current = null;
    }
  }, [overlays.length]);

  useEffect(() => {
    return () => {
      if (typeof document === "undefined") {
        return;
      }

      if (previousBodyOverflowRef.current !== null) {
        document.body.style.overflow = previousBodyOverflowRef.current;
        previousBodyOverflowRef.current = null;
        return;
      }

      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (overlaysRef.current.length === 0) {
      return;
    }

    setOverlays([]);
  }, [location]);

  const topOverlay = overlays[overlays.length - 1] ?? null;

  const contextValue = useMemo<OverlayContextValue>(
    () => ({
      overlays,
      topOverlay,
      openOverlay,
      closeTopOverlay,
      closeOverlay,
      closeOverlayAndWait,
      isOpen: (type) => overlays.some((entry) => entry.type === type),
      isTopOverlay: (type) => topOverlay?.type === type,
      getOverlay: (type) => {
        const match = overlays.find((entry) => entry.type === type);
        if (!match) {
          return null;
        }
        return match as Extract<OverlayEntry, { type: typeof type }>;
      },
    }),
    [closeOverlay, closeOverlayAndWait, closeTopOverlay, openOverlay, overlays, topOverlay]
  );

  return <OverlayContext.Provider value={contextValue}>{children}</OverlayContext.Provider>;
}

export function useOverlay() {
  const context = useContext(OverlayContext);
  if (!context) {
    throw new Error("useOverlay must be used within an OverlayProvider");
  }
  return context;
}
