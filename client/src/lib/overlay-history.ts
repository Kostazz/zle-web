import { useEffect, useRef } from "react";

type CloseHandler = () => void;

type OverlayEntry = {
  id: string;
  close: CloseHandler;
};

const OVERLAY_STATE_KEY = "__zleOverlay";

const overlayStack: OverlayEntry[] = [];
let isListenerRegistered = false;
let suppressNextPopstate = 0;
let hookSubscriptions = 0;
const suppressedPopCallbacks: Array<() => void> = [];

const handlePopstate = () => {
  if (suppressNextPopstate > 0) {
    suppressNextPopstate -= 1;
    const callback = suppressedPopCallbacks.shift();
    callback?.();
    return;
  }

  const topOverlay = overlayStack[overlayStack.length - 1];
  topOverlay?.close();
};

function registerPopstateListener() {
  if (isListenerRegistered || typeof window === "undefined") {
    return;
  }

  window.addEventListener("popstate", handlePopstate);

  isListenerRegistered = true;
}

function unregisterPopstateListener() {
  if (!isListenerRegistered || typeof window === "undefined") {
    return;
  }

  window.removeEventListener("popstate", handlePopstate);
  isListenerRegistered = false;
}

function pushOverlayState(id: string) {
  window.history.pushState(
    {
      ...window.history.state,
      [OVERLAY_STATE_KEY]: id,
    },
    "",
    window.location.href
  );
}

function registerOverlay(id: string, close: CloseHandler) {
  registerPopstateListener();

  const existingIndex = overlayStack.findIndex((entry) => entry.id === id);
  if (existingIndex !== -1) {
    overlayStack[existingIndex] = { id, close };
    return;
  }

  overlayStack.push({ id, close });
  pushOverlayState(id);
}

function unregisterOverlay(id: string) {
  const index = overlayStack.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return;
  }

  overlayStack.splice(index, 1);
}

export function closeOverlayWithHistory(
  id: string,
  close: CloseHandler,
  afterPopstate?: () => void
) {
  const topOverlay = overlayStack[overlayStack.length - 1];
  close();

  if (!topOverlay || topOverlay.id !== id || typeof window === "undefined") {
    afterPopstate?.();
    return;
  }

  if (afterPopstate) {
    suppressedPopCallbacks.push(afterPopstate);
  }

  suppressNextPopstate += 1;
  window.history.back();
}

export function useOverlayHistory(id: string, isOpen: boolean, onClose: CloseHandler) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    hookSubscriptions += 1;
    registerPopstateListener();

    return () => {
      hookSubscriptions -= 1;
      if (hookSubscriptions <= 0) {
        overlayStack.length = 0;
        suppressNextPopstate = 0;
        suppressedPopCallbacks.length = 0;
        unregisterPopstateListener();
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      return;
    }

    registerOverlay(id, () => closeRef.current());

    return () => {
      unregisterOverlay(id);
    };
  }, [id, isOpen]);
}
