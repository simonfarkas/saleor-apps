import { Box, Button, Text } from "@saleor/macaw-ui";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Products, useQueryAllProducts } from "./useQueryAllProducts";
import { trpcClient } from "../modules/trpc/trpc-client";
import { Layout } from "@saleor/apps-ui";
import { TypesenseSearchProvider } from "../lib/typesense/typesenseSearchProvider";

const BATCH_SIZE = 100;

export const ImportProductsToTypesense = () => {
  const [typesenseConfigured, setTypesenseConfigured] = useState<null | boolean>(null);
  const [started, setStarted] = useState(false);
  const [currentProductIndex, setCurrentProductIndex] = useState(0);
  const [isTypesenseImporting, setIsTypesenseImporting] = useState(false);
  const [allImported, setAllImported] = useState(false);
  const products = useQueryAllProducts(!started);

  const { data: typesenseConfiguration } = trpcClient.configuration.getConfig.useQuery();

  const searchProvider = useMemo(() => {
    if (!typesenseConfiguration?.appConfig?.host || !typesenseConfiguration.appConfig?.apiKey) {
      return null;
    }
    return new TypesenseSearchProvider({
      host: typesenseConfiguration.appConfig.host,
      apiKey: typesenseConfiguration.appConfig.apiKey,
      protocol: typesenseConfiguration.appConfig.protocol,
      port: typesenseConfiguration.appConfig.port,
      connectionTimeoutSeconds: typesenseConfiguration.appConfig.connectionTimeoutSeconds,
      enabledKeys: typesenseConfiguration.fieldsMapping.enabledTypesenseFields,
    });
  }, [
    typesenseConfiguration?.appConfig?.apiKey,
    typesenseConfiguration?.appConfig?.connectionTimeoutSeconds,
    typesenseConfiguration?.appConfig?.host,
    typesenseConfiguration?.appConfig?.port,
    typesenseConfiguration?.appConfig?.protocol,
    typesenseConfiguration?.fieldsMapping?.enabledTypesenseFields,
  ]);

  const importProducts = useCallback(() => {
    setStarted(true);
  }, []);

  useEffect(() => {
    if (searchProvider) {
      searchProvider
        .ping()
        .then(() => setTypesenseConfigured(true))
        .catch(() => setTypesenseConfigured(false));
    }
  }, [searchProvider]);

  useEffect(() => {
    const importBatch = async () => {
      if (!searchProvider || products.length <= currentProductIndex) {
        setIsTypesenseImporting(false);
        return;
      }

      const productsBatch = products.slice(currentProductIndex, currentProductIndex + BATCH_SIZE);

      await searchProvider.updatedBatchProducts(productsBatch);
      setCurrentProductIndex((prevIndex) => prevIndex + BATCH_SIZE);
      setIsTypesenseImporting(false);

      if (currentProductIndex + BATCH_SIZE >= products.length) {
        setAllImported(true);
      }
    };

    if (started && !isTypesenseImporting) {
      setIsTypesenseImporting(true);
      importBatch();
    }
  }, [searchProvider, currentProductIndex, isTypesenseImporting, products, started]);

  const productCount = products.length;
  const variantCount = useMemo(
    () => countVariants(products, currentProductIndex),
    [products, currentProductIndex],
  );
  const totalVariantCount = useMemo(
    () => countVariants(products, productCount),
    [products, productCount],
  );

  return (
    <Layout.AppSectionCard
      footer={
        searchProvider &&
        typesenseConfigured && (
          <Box display={"flex"} justifyContent={"flex-end"} gap={4}>
            {started && allImported && !isTypesenseImporting && (
              <Button disabled={true} onClick={importProducts}>
                Importing complete, refresh the page
              </Button>
            )}
            {!started && !isTypesenseImporting && (
              <Button disabled={!searchProvider} onClick={importProducts}>
                Start importing
              </Button>
            )}
          </Box>
        )
      }
      __cursor={started ? "wait" : "auto"}
    >
      {searchProvider && typesenseConfigured ? (
        <Box>
          <Text variant={"heading"} as={"p"} marginBottom={1.5}>
            Importing products & variants
          </Text>
          <Text as={"p"}>
            Trigger initial indexing for products catalogue. It can take few minutes.{" "}
          </Text>
          <Text marginBottom={5} variant={"bodyStrong"}>
            Do not close the app - its running client-side
          </Text>
        </Box>
      ) : (
        <Box>
          <Text variant={"heading"} as={"p"} color={"textCriticalDefault"} marginBottom={1.5}>
            App not configured
          </Text>
          <Text>Configure Typesense first</Text>
        </Box>
      )}
      {started && (
        <div
          style={{
            marginTop: "20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {variantCount} / {totalVariantCount}
          <progress
            value={currentProductIndex}
            max={products.length}
            style={{
              height: "30px",
              width: "500px",
              maxWidth: "100%",
            }}
          />
        </div>
      )}
    </Layout.AppSectionCard>
  );
};

const countVariants = (products: Products, index: number) =>
  products.slice(0, index).reduce((acc, p) => acc + (p.variants?.length ?? 0), 0);