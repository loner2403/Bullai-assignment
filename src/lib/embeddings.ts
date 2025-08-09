import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import type { EmbeddingsInterface as Embeddings } from "@langchain/core/embeddings";

class JinaEmbeddingsImpl implements Embeddings {
  private apiKey: string;
  private model: string;
  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "jina-embeddings-v3";
  }
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embedQuery(t)));
  }
  async embedQuery(text: string): Promise<number[]> {
    const res = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new Error(`Jina embeddings error: ${res.status}`);
    const data = await res.json();
    return data.data[0].embedding as number[];
  }
}

export function getEmbeddings(opts: {
  provider: "google" | "jina";
  model: string;
  googleApiKey?: string;
  jinaApiKey?: string;
}): Embeddings {
  if (opts.provider === "google") {
    if (!opts.googleApiKey) throw new Error("GOOGLE_API_KEY missing");
    return new GoogleGenerativeAIEmbeddings({
      apiKey: opts.googleApiKey,
      model: opts.model || "text-embedding-004",
    });
  }
  if (opts.provider === "jina") {
    if (!opts.jinaApiKey) throw new Error("JINA_API_KEY missing");
    return new JinaEmbeddingsImpl({ apiKey: opts.jinaApiKey, model: opts.model });
  }
  throw new Error("Unsupported embeddings provider");
}
