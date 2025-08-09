export type AppConfig = {
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
  embeddingsProvider: "google" | "jina";
  embeddingsModel: string;
  llmProvider: "gemini" | "deepseek";
  llmModel: string;
  googleApiKey?: string;
  jinaApiKey?: string;
  deepseekApiKey?: string;
};

export function loadConfig(): AppConfig {
  const cfg: AppConfig = {
    qdrantUrl: process.env.QDRANT_URL || "",
    qdrantApiKey: process.env.QDRANT_API_KEY || "",
    qdrantCollection: process.env.QDRANT_COLLECTION || "docs_text-embedding-004",
    embeddingsProvider: (process.env.EMBEDDINGS_PROVIDER as any) || "google",
    embeddingsModel: process.env.EMBEDDINGS_MODEL || "text-embedding-004",
    llmProvider: (process.env.LLM_PROVIDER as any) || "gemini",
    llmModel: process.env.LLM_MODEL || "gemini-1.5-flash",
    googleApiKey: process.env.GOOGLE_API_KEY,
    jinaApiKey: process.env.JINA_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  };

  if (!cfg.qdrantUrl || !cfg.qdrantApiKey) {
    throw new Error("Qdrant credentials missing. Set QDRANT_URL and QDRANT_API_KEY");
  }

  if (cfg.embeddingsProvider === "google" && !cfg.googleApiKey) {
    throw new Error("GOOGLE_API_KEY required for Google embeddings");
  }
  if (cfg.embeddingsProvider === "jina" && !cfg.jinaApiKey) {
    throw new Error("JINA_API_KEY required for Jina embeddings");
  }

  if (cfg.llmProvider === "gemini" && !cfg.googleApiKey) {
    throw new Error("GOOGLE_API_KEY required for Gemini LLM");
  }
  if (cfg.llmProvider === "deepseek" && !cfg.deepseekApiKey) {
    throw new Error("DEEPSEEK_API_KEY required for DeepSeek LLM");
  }

  return cfg;
}
