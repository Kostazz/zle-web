// Resend email client integration for ZLE e-commerce
import { Resend } from "resend";

type ResendSettings = { apiKey: string; fromEmail: string };

function getEnvSettings(): ResendSettings {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.MAIL_FROM ||
    "onboarding@resend.dev";

  return { apiKey, fromEmail };
}

export async function getUncachableResendClient() {
  const { apiKey, fromEmail } = getEnvSettings();

  return {
    client: new Resend(apiKey),
    fromEmail,
  };
}
