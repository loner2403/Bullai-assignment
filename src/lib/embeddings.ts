import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import type { EmbeddingsInterface as Embeddings } from "@langchain/core/embeddings";

export function getEmbeddings(opts: { model: string; googleApiKey?: string }): Embeddings {
  if (!opts.googleApiKey) throw new Error("GOOGLE_API_KEY missing");
  return new GoogleGenerativeAIEmbeddings({
    apiKey: opts.googleApiKey,
    model: opts.model || "text-embedding-004",
  });
}
