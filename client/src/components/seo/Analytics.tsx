const ENABLE_ANALYTICS = import.meta.env.VITE_ENABLE_ANALYTICS === "true";

export function Analytics() {
  // Analytics are intentionally disabled until a consent layer is implemented.
  // Re-enable only after implementing a compliant consent layer.

  /**
   * IMPORTANT:
   * - Do NOT enable analytics by just setting GA ID.
   * - Analytics must be gated by explicit user consent.
   */

  if (!ENABLE_ANALYTICS) {
    return null;
  }

  return null;
}
