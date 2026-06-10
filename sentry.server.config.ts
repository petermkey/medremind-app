// Sentry server-side init. No-op until NEXT_PUBLIC_SENTRY_DSN is set, so the
// integration can ship dark and activate by adding the env var in Vercel.
// Medical PWA: PII disabled, no session data captured.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  enableLogs: true,
  // Medical PWA: keep PII off and local variables out of stack traces — both
  // can capture health data (medication names, user identifiers).
  sendDefaultPii: false,
  includeLocalVariables: false,
});
