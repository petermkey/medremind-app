import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  // Route Sentry events through our own origin so ad-blockers don't drop them.
  // The /monitoring path is excluded from the middleware matcher.
  tunnelRoute: "/monitoring",
  // Source map upload — active only when SENTRY_AUTH_TOKEN is set (CI/Vercel).
  // Without it, error capture still works but stack traces are minified.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
