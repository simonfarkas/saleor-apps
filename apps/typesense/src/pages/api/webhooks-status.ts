import { createProtectedHandler, NextProtectedApiHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { FetchOwnWebhooksDocument, OwnWebhookFragment } from "../../../generated/graphql";
import { TypesenseSearchProvider } from "../../lib/typesense/typesenseSearchProvider";
import { createSettingsManager } from "../../lib/metadata";
import {
  IWebhookActivityTogglerService,
  WebhookActivityTogglerService,
} from "../../domain/WebhookActivityToggler.service";
import { createLogger } from "../../lib/logger";
import { SettingsManager } from "@saleor/app-sdk/settings-manager";
import { SearchProvider } from "../../lib/searchProvider";
import { Client } from "urql";
import { isWebhookUpdateNeeded } from "../../lib/typesense/is-webhook-update-needed";
import { AppConfigMetadataManager } from "../../modules/configuration/app-config-metadata-manager";
import { withOtel } from "@saleor/apps-otel";
import { createInstrumentedGraphqlClient } from "../../lib/create-instrumented-graphql-client";

const logger = createLogger("webhooksStatusHandler");

/**
 * Simple dependency injection - factory injects all services, in tests everything can be configured without mocks
 */
type FactoryProps = {
  settingsManagerFactory: (
    client: Pick<Client, "query" | "mutation">,
    appId: string,
  ) => SettingsManager;
  webhookActivityTogglerFactory: (
    appId: string,
    client: Pick<Client, "query" | "mutation">,
  ) => IWebhookActivityTogglerService;
  typesenseSearchProviderFactory: (
    host: string,
    apiKey: string,
    protocol: string,
    port: number,
    connectionTimeoutSeconds: number,
    enabledKeys: string[],
  ) => Pick<SearchProvider, "ping">;
  graphqlClientFactory: (saleorApiUrl: string, token: string) => Pick<Client, "query" | "mutation">;
};

export type WebhooksStatusResponse = {
  webhooks: OwnWebhookFragment[];
  isUpdateNeeded: boolean;
};

export const webhooksStatusHandlerFactory =
  ({
    settingsManagerFactory,
    webhookActivityTogglerFactory,
    graphqlClientFactory,
    typesenseSearchProviderFactory,
  }: FactoryProps): NextProtectedApiHandler<WebhooksStatusResponse> =>
  async (req, res, { authData }) => {
    /**
     * Initialize services
     */
    const client = graphqlClientFactory(authData.saleorApiUrl, authData.token);
    const webhooksToggler = webhookActivityTogglerFactory(authData.appId, client);
    const settingsManager = settingsManagerFactory(client, authData.appId);

    const configManager = new AppConfigMetadataManager(settingsManager);

    const config = (await configManager.get(authData.saleorApiUrl)).getConfig();

    logger.debug("fetched settings");

    /**
     * If settings are incomplete, disable webhooks
     *
     * TODO Extract config operations to domain/
     */
    if (!config.appConfig) {
      logger.debug("Settings not set, will disable webhooks");

      await webhooksToggler.disableOwnWebhooks();
    } else {
      /**
       * Otherwise, if settings are set, check in Typsense if tokens are valid
       */
      const typesenseService = typesenseSearchProviderFactory(
        config.appConfig.host,
        config.appConfig.apiKey,
        config.appConfig.protocol,
        config.appConfig.port,
        config.appConfig.connectionTimeoutSeconds,
        config.fieldsMapping.enabledTypesenseFields,
      );

      try {
        logger.debug("Settings set, will ping Typesense");

        await typesenseService.ping();
      } catch (e) {
        logger.debug("Typesense ping failed, will disable webhooks");
        /**
         * If credentials are invalid, also disable webhooks
         */
        await webhooksToggler.disableOwnWebhooks();
      }
    }

    try {
      logger.debug("Settings and Typsense are correct, will fetch Webhooks from Saleor");

      const webhooks = await client
        .query(FetchOwnWebhooksDocument, { id: authData.appId })
        .toPromise()
        .then((r) => r.data?.app?.webhooks);

      if (!webhooks) {
        return res.status(500).end();
      }

      const isUpdateNeeded = isWebhookUpdateNeeded({
        existingWebhookNames: webhooks.map((w) => w.name),
      });

      return res.status(200).json({
        webhooks,
        isUpdateNeeded,
      });
    } catch (e) {
      return res.status(500).end();
    }
  };

export default withOtel(
  createProtectedHandler(
    webhooksStatusHandlerFactory({
      settingsManagerFactory: createSettingsManager,
      webhookActivityTogglerFactory: function (appId, client) {
        return new WebhookActivityTogglerService(appId, client);
      },
      typesenseSearchProviderFactory(host, apiKey, protocol, port, connectionTimeoutSeconds) {
        return new TypesenseSearchProvider({
          host,
          protocol,
          apiKey,
          port,
          connectionTimeoutSeconds,
          enabledKeys: [],
        });
      },
      graphqlClientFactory(saleorApiUrl: string, token: string) {
        return createInstrumentedGraphqlClient({
          saleorApiUrl,
          token,
        });
      },
    }),
    saleorApp.apl,
    ["MANAGE_APPS"],
  ),
  "api/webhooks-status",
);
