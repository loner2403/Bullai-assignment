import { loadConfig } from "./config";
import { getQdrantClient } from "./qdrant";
import { getEmbeddings } from "./embeddings";
import type { AnswerResponse, Source } from "./types";

function buildPrompt(question: string, contexts: SourceWithText[]) {
  const sources = contexts
    .map(
      (c, i) => `Source ${i + 1}:
Title: ${c.title ?? c.source}
Company: ${c.company ?? ""}
DocType: ${c.doc_type ?? ""}
Date: ${c.published_date ?? ""}
Excerpt:\n${c.text}`
    )
    .join("\n\n");

  return `You are a helpful financial research assistant. Answer the user's question using ONLY the information from the provided sources. If the answer is not present, say you don't know. Be concise, factual, and include exact numbers/periods when present. Output an answer followed by a short list of citations like [S1], [S2].

Question: ${question}

${sources}`;
}

async function callGemini(modelName: string, apiKey: string, prompt: string) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const resp = await model.generateContent(prompt);
  const text = resp.response.text();
  return text ?? "";
}

async function callDeepSeek(modelName: string, apiKey: string, prompt: string) {
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName || "deepseek-chat",
      messages: [
        { role: "system", content: "You are a helpful financial research assistant." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek error: ${resp.status}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

type SourceWithText = Source & { text: string };

export async function getRAGAnswer(opts: { question: string; company?: string | null }): Promise<AnswerResponse> {
  const question = opts.question.trim();
  const cfg = loadConfig();

  const embeddings = getEmbeddings({
    provider: cfg.embeddingsProvider,
    model: cfg.embeddingsModel,
    googleApiKey: cfg.googleApiKey,
    jinaApiKey: cfg.jinaApiKey,
  });
  const qvec = await embeddings.embedQuery(question);

  const client = getQdrantClient(cfg);
  const filter = opts.company
    ? ({
        must: [
          {
            key: "company",
            match: { value: opts.company },
          },
        ],
      } as any)
    : undefined;

  const searchRes = await client.search(cfg.qdrantCollection, {
    vector: qvec,
    limit: 8,
    with_payload: true,
    score_threshold: 0.2,
    filter,
  } as any);

  const contexts: SourceWithText[] = (searchRes as any).map((p: any) => ({
    id: p.id?.toString?.(),
    source: p.payload?.path || p.payload?.source,
    title: p.payload?.title,
    company: p.payload?.company,
    doc_type: p.payload?.doc_type,
    published_date: p.payload?.published_date,
    page_start: p.payload?.page_start,
    page_end: p.payload?.page_end,
    chunk_index: p.payload?.chunk_index,
    text: p.payload?.text || "",
  }));

  // For compact prompt size, include only the top N small excerpts
  const prompt = buildPrompt(question, contexts.slice(0, 6));

  let answer = "";
  if (cfg.llmProvider === "gemini") {
    answer = await callGemini(cfg.llmModel, cfg.googleApiKey!, prompt);
  } else {
    answer = await callDeepSeek(cfg.llmModel, cfg.deepseekApiKey!, prompt);
  }

  // Simple heuristic to map [S1], [S2] citations if present; else attach all sources
  const sources: Source[] = contexts.slice(0, 6).map((c) => ({
    id: c.id,
    source: c.source,
    title: c.title,
    company: c.company,
    doc_type: c.doc_type,
    published_date: c.published_date,
    page_start: c.page_start,
    page_end: c.page_end,
    chunk_index: c.chunk_index,
  }));

  return { answer, sources, chartSpec: null };
}
