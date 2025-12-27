import Stripe from 'stripe';

let connectionSettings: any;
let stripeDisabled = false;

export function isStripeAvailable(): boolean {
  return !stripeDisabled && (
    Boolean(process.env.STRIPE_SECRET_KEY) ||
    Boolean(process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL)
  );
}

function isReplitEnvironment(): boolean {
  return Boolean(process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL);
}

async function getCredentialsFromReplit() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  const data = await response.json();
  
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

async function getCredentials() {
  if (process.env.STRIPE_SECRET_KEY) {
    return {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: process.env.STRIPE_SECRET_KEY,
    };
  }
  
  if (isReplitEnvironment()) {
    return getCredentialsFromReplit();
  }
  
  throw new Error('No Stripe credentials available');
}

export async function getUncachableStripeClient() {
  if (!isStripeAvailable()) {
    throw new Error('Stripe is disabled');
  }
  
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
  });
}

export async function getStripePublishableKey() {
  if (!isStripeAvailable()) {
    throw new Error('Stripe is disabled');
  }
  
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  if (!isStripeAvailable()) {
    throw new Error('Stripe is disabled');
  }
  
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!isStripeAvailable()) {
    throw new Error('Stripe is disabled');
  }
  
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}

export function disableStripe() {
  stripeDisabled = true;
  console.warn('[stripe] disabled - no credentials available');
}
