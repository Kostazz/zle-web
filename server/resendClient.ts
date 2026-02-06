// Resend email client integration for ZLE e-commerce
import { Resend } from "resend";

/**
 * D3 hardening:
 * - Production (Render): use RESEND_API_KEY (+ optional RESEND_FROM_EMAIL)
 * - Replit: fallback to Replit Connector (resend)
 *
 * This keeps email usable in both worlds without code changes.
 */

type ResendSettings = { apiKey: string; fromEmail: string };

let connectionSettings: any;

async function getReplitConnectorSettings(): Promise<ResendSettings> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Replit connector environment missing");
  }

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=resend",
    {
      headers: {
        Accept: "application/json",
        "X_REPLIT_TOKEN": xReplitToken,
      },
    }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const apiKey = connectionSettings?.settings?.api_key;
  const fromEmail = connectionSettings?.settings?.from_email;

  if (!apiKey) {
    throw new Error("Resend not connected");
  }

  return { apiKey, fromEmail: fromEmail || "onboarding@resend.dev" };
}

function getEnvSettings(): ResendSettings | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.MAIL_FROM ||
    "onboarding@resend.dev";

  return { apiKey, fromEmail };
}

export async function getUncachableResendClient() {
  const envSettings = getEnvSettings();
  const { apiKey, fromEmail } = envSettings
    ? envSettings
    : await getReplitConnectorSettings();

  return {
    client: new Resend(apiKey),
    fromEmail,
  };
}
