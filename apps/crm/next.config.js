// @ts-check

import { withSentryConfig } from "@sentry/nextjs";
import { z } from "zod";

const RequiredEnvs = z.object({
  MAILCHIMP_CLIENT_ID: z.string().min(5),
  MAILCHIMP_CLIENT_SECRET: z.string().min(5),
});

/** @type {import('next').NextConfig} */
const nextConfig = () => {
  const parsedEnvs = RequiredEnvs.safeParse(process.env);

  if (!parsedEnvs.success) {
    console.error("🚫 Missing required env variables, see message below");
    console.error(parsedEnvs.error.issues);
    process.exit(1);
  }

  return {
    reactStrictMode: true,
    transpilePackages: ["@saleor/apps-shared"],
    experimental: {},
    /*
     * Ignore opentelemetry warnings - https://github.com/open-telemetry/opentelemetry-js/issues/4173
     * Remove when https://github.com/open-telemetry/opentelemetry-js/pull/4660 is released
     */
    /** @type {import('next').NextConfig['webpack']} */
    webpack: (config, { isServer }) => {
      if (isServer) {
        config.ignoreWarnings = [{ module: /opentelemetry/ }];
      }
      return config;
    },
  };
};

const isSentryPropertiesInEnvironment =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_PROJECT && process.env.SENTRY_ORG;

const configWithSentry = withSentryConfig(
  nextConfig,
  {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: true,
  },
  {
    hideSourceMaps: true,
    widenClientFileUpload: true,
    disableLogger: true,
    tunnelRoute: "/monitoring",
  },
);

export default isSentryPropertiesInEnvironment ? configWithSentry : nextConfig;
