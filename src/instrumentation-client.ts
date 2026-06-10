// Sentry client-side init. No-op until NEXT_PUBLIC_SENTRY_DSN is set.
// Medical PWA: PII disabled, no session replay (avoids capturing health data).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
