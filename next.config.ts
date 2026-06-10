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
  // To upload source maps for readable stack traces, set org/project slugs and
  // a SENTRY_AUTH_TOKEN env var here. Runtime error capture works without them.
});
