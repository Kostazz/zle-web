import helmet from "helmet";
import type { RequestHandler } from "express";

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function securityHeaders(): RequestHandler {
  const isProd = process.env.NODE_ENV === "production";
  const reportOnly = isTruthy(process.env.CSP_REPORT_ONLY);
  const reportUri = (process.env.CSP_REPORT_URI || "").trim();

  const helmetMiddleware = helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
    contentSecurityPolicy: {
      useDefaults: true,
      reportOnly,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:", "https:"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
        "script-src": ["'self'", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
        "connect-src": ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com"],
        "frame-src": ["'self'", "https://www.youtube-nocookie.com", "https://www.youtube.com"],
        "child-src": ["'self'", "https://www.youtube-nocookie.com", "https://www.youtube.com"],
        ...(reportUri ? { "report-uri": [reportUri] } : {}),
      },
    },
  });

  return (req, res, next) => {
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(self)");
    return helmetMiddleware(req, res, next);
  };
}
