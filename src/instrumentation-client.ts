// Sentry client-side init. No-op until NEXT_PUBLIC_SENTRY_DSN is set.
// Medical PWA: PII disabled, and no session replay integration — replay would
// record the screen including health data (medications, doses, food).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  enableLogs: true,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
