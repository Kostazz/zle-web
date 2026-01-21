/**
 * Admin configuration for ZLE
 * Frontend-only soft protection - real security requires backend auth
 */

export const ZLE_ADMIN_KEY = import.meta.env.VITE_ZLE_ADMIN_KEY || "";

const ADMIN_AUTH_KEY = "zle-admin-authorized";

export function isAdminKeyConfigured(): boolean {
  return ZLE_ADMIN_KEY.length > 0;
}

export function checkAdminAuthorization(): boolean {
  if (!isAdminKeyConfigured()) {
    // No key configured = allow access (dev mode)
    return true;
  }
  
  if (typeof window === "undefined") return false;
  
  try {
    return window.localStorage.getItem(ADMIN_AUTH_KEY) === "1";
  } catch {
    return false;
  }
}

export function validateAdminKey(inputKey: string): boolean {
  if (!isAdminKeyConfigured()) return true;
  return inputKey === ZLE_ADMIN_KEY;
}

export function setAdminAuthorized(authorized: boolean) {
  if (typeof window === "undefined") return;
  
  try {
    if (authorized) {
      window.localStorage.setItem(ADMIN_AUTH_KEY, "1");
    } else {
      window.localStorage.removeItem(ADMIN_AUTH_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearAdminAuthorization() {
  setAdminAuthorized(false);
}
