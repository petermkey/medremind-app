// Sentry edge-runtime init (middleware / edge routes). No-op until
// NEXT_PUBLIC_SENTRY_DSN is set. See sentry.server.config.ts.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
