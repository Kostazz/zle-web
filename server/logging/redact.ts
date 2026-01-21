/**
 * ZLE Log Sanitizer (ZLE v1.2.3)
 * Prevents accidental PII leakage via logs and exception printing.
 * In production, sensitive data is masked; in development, logs are more verbose.
 */

const SENSITIVE_KEYS = new Set([
  'email',
  'customerEmail',
  'customer_email',
  'phone',
  'customerPhone',
  'customer_phone',
  'address',
  'customerAddress',
  'customer_address',
  'street',
  'city',
  'zip',
  'postalCode',
  'postal_code',
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'sid',
  'stripe_signature',
  'webhook_secret',
  'twoFactorSecret',
  'two_factor_secret',
  'twoFactorRecoveryCodes',
  'two_factor_recovery_codes',
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'name',
  'customerName',
  'customer_name',
  'creditCard',
  'credit_card',
  'cardNumber',
  'card_number',
  'cvv',
  'cvc',
  'pan',
  'ssn',
  'nationalId',
  'national_id',
]);

const SENSITIVE_PATTERNS = [
  /sk_live_[a-zA-Z0-9]+/g,    // Stripe live secret key
  /sk_test_[a-zA-Z0-9]+/g,    // Stripe test secret key
  /whsec_[a-zA-Z0-9]+/g,      // Stripe webhook secret
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email pattern
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // Phone number pattern
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // Card number pattern
];

const MASK = '[REDACTED]';

/**
 * Check if we're in production mode.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Mask a sensitive string value.
 */
function maskValue(value: string): string {
  if (value.length <= 4) {
    return MASK;
  }
  // Show first 2 and last 2 characters for debugging
  return `${value.substring(0, 2)}...${value.substring(value.length - 2)}`;
}

/**
 * Recursively redact sensitive fields from an object.
 * Returns a new object with sensitive data masked.
 */
export function redactSensitive(obj: unknown): unknown {
  // In development, return as-is for easier debugging
  if (!isProduction()) {
    return obj;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    let result = obj;
    for (const pattern of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, MASK);
    }
    return result;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lowerKey)) {
      if (typeof value === 'string') {
        result[key] = maskValue(value);
      } else {
        result[key] = MASK;
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value);
    } else if (typeof value === 'string') {
      let redacted = value;
      for (const pattern of SENSITIVE_PATTERNS) {
        redacted = redacted.replace(pattern, MASK);
      }
      result[key] = redacted;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Create a safe log message from an error object.
 * Redacts sensitive data from error message and stack trace in production.
 */
export function safeErrorLog(error: unknown): string {
  if (!isProduction()) {
    return String(error);
  }

  if (error instanceof Error) {
    let message = error.message;
    for (const pattern of SENSITIVE_PATTERNS) {
      message = message.replace(pattern, MASK);
    }
    return `${error.name}: ${message}`;
  }

  return redactSensitive(String(error)) as string;
}

/**
 * Log helper that automatically redacts in production.
 */
export function safeLog(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const redactedData = data ? redactSensitive(data) : undefined;
  
  const logEntry = {
    timestamp,
    level,
    message,
    ...(redactedData ? { data: redactedData } : {}),
  };

  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry));
      break;
    default:
      console.log(JSON.stringify(logEntry));
  }
}
