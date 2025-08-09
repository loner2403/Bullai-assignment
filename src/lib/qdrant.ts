import { QdrantClient } from "@qdrant/js-client-rest";
import type { AppConfig } from "./config";

export function getQdrantClient(cfg: AppConfig) {
  return new QdrantClient({ url: cfg.qdrantUrl, apiKey: cfg.qdrantApiKey });
}

export async function ensureCollection(opts: {
  client: QdrantClient;
  collection: string;
  vectorSize: number;
}) {
  const { client, collection, vectorSize } = opts;
  try {
    await client.getCollection(collection);
    return;
  } catch (_) {
    // create if missing
  }
  await client.createCollection(collection, {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  });
}
