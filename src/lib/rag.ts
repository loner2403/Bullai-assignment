import { loadConfig } from "./config";
import { getQdrantClient } from "./qdrant";
import { getEmbeddings } from "./embeddings";
import type { AnswerResponse, Source, ChartSpec } from "./types";

function buildPrompt(question: string, contexts: SourceWithText[]) {
  const sources = contexts
    .map(
      (c, i) => `Source ${i + 1}:
 Title: ${c.title ?? c.source}
 Company: ${c.company ?? ""}
 DocType: ${c.doc_type ?? ""}
 Date: ${c.published_date ?? ""}
 Excerpt:
 ${c.text}`
    )
    .join("\n\n");

  return `You are a helpful financial research assistant. Answer the user's question using ONLY the information from the provided sources.
Strict rules:
- Do NOT guess. If the exact figure is not present, reply: "I don't know." 
- Answer ONLY for the metric explicitly asked. If the question asks for PAT/Profit After Tax/Net Profit, return the monetary amount (e.g., ₹, Cr, mn/mm, bn) — NOT margins in % or bps.
- When multiple metrics are listed together (e.g., Total Income, PAT, Operating Margin), pick ONLY the one matching the question by name.
- Keep numbers and periods exactly as shown in sources, including units. Do not convert bps to % or vice versa unless explicitly asked.
- Be concise and end with citations like [S1], [S2].

Question: ${question}

${sources}`;
}

function isChartIntent(question: string) {
  const q = question.toLowerCase();
  const kws = [
    "chart",
    "graph",
    "plot",
    "visualize",
    "visualise",
    "visualization",
    "line chart",
    "bar chart",
    "scatter",
    "pie",
    "donut",
    "stacked",
    "stacked bar",
    "composition",
    "breakdown",
    "mix",
    "distribution",
    "proportion",
    "show trend",
    "display trend",
    "trend",
    "over time",
    "timeline",
    "compare",
    "comparison",
    "vs",
    "qoq",
    "yoy",
    "quarter",
    "year",
    "monthly",
    "growth",
    "decline",
    "increase",
    "decrease",
  ];
  return kws.some((k) => q.includes(k));
}

function extractJson(text: string): any | null {
  // attempt to parse raw JSON or fenced code; be tolerant of extra prose
  if (!text) return null;
  const t = String(text).trim();
  // handle literal null (possibly fenced)
  if (/^```\s*null\s*```$/i.test(t) || /^null$/i.test(t)) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const bodies = [] as string[];
  bodies.push(fence ? fence[1] : t);
  // try to extract first JSON object substring as a fallback
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    bodies.push(t.slice(firstBrace, lastBrace + 1));
  }
  for (const body of bodies) {
    try {
      return JSON.parse(body);
    } catch {}
  }
  return null;
}

// Fallback: derive a simple chart from answer text when it contains period->value pairs
function chartFromAnswerText(ans: string): ChartSpec | null {
  if (!ans) return null;
  const text = ans.replace(/\s+/g, " ");
  // labels: FY24, FY2024, FY21, 2021, Q1 FY24, Q2FY25
  const labelRe = /\b((?:FY\s?\d{2,4})|(?:20\d{2})|(?:Q[1-4]\s*FY\s*\d{2,4})|(?:Q[1-4]\s*\d{4}))\b/gi;
  // numbers like 1,234.56 or 12.3% or 45 Cr
  const numRe = /([+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)(?:\s*(%|cr|bn|mn|crore|million|billion))?/i;
  const pairs: { label: string; value: number; unit?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text))) {
    const label = m[1].replace(/\s+/g, "").toUpperCase();
    // Look ahead for number after the label (e.g., "FY21 0.90")
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const nmAfter = numRe.exec(after);
    if (nmAfter) {
      const raw = nmAfter[1].replace(/,/g, "");
      const val = Number(raw);
      if (Number.isFinite(val)) {
        const unit = (nmAfter[2] || "").toLowerCase();
        pairs.push({ label, value: val, unit: unit || undefined });
        continue; // prefer forward match if present
      }
    }
    // Look behind for number before the label (e.g., "0.90 FY21") within a small window
    const beforeStart = Math.max(0, m.index - 60);
    const before = text.slice(beforeStart, m.index);
    // Search for the last number in this window
    let lastMatch: RegExpExecArray | null = null;
    let bm: RegExpExecArray | null;
    const globalNum = new RegExp(numRe.source, "ig");
    while ((bm = globalNum.exec(before))) {
      lastMatch = bm;
    }
    if (lastMatch) {
      const raw = lastMatch[1].replace(/,/g, "");
      const val = Number(raw);
      if (Number.isFinite(val)) {
        const unit = (lastMatch[2] || "").toLowerCase();
        pairs.push({ label, value: val, unit: unit || undefined });
      }
    }
  }
  // dedupe by label (keep first occurrence)
  const seen = new Set<string>();
  const uniq = pairs.filter((p) => (seen.has(p.label) ? false : (seen.add(p.label), true)));
  if (uniq.length < 2) return null;
  // infer dominant unit
  const unitCounts = uniq.reduce<Record<string, number>>((acc, p) => {
    const k = p.unit || "";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  let unit: string | undefined = undefined;
  let best = 0;
  for (const [k, v] of Object.entries(unitCounts)) {
    if (v > best && k) {
      unit = k === "%" ? "%" : k;
      best = v;
    }
  }
  const labels = uniq.map((p) => p.label);
  const values = uniq.map((p) => p.value);
  // Require at least two non-zero values
  const nonZero = values.filter((v) => Math.abs(v) > 0).length;
  if (nonZero < 2) return null;
  return {
    type: "line",
    labels,
    series: [{ name: unit === "%" ? "Value (%)" : "Value", values }],
    unit: unit && unit !== "million" && unit !== "billion" && unit !== "crore" ? unit.toUpperCase() : undefined,
  };
}

function validateChartSpec(obj: any): ChartSpec | null {
  if (!obj || typeof obj !== "object") return null;
  if (!Array.isArray(obj.labels) || !Array.isArray(obj.series)) return null;
  const labels: string[] = obj.labels.map((x: any) => String(x));
  const series = obj.series
    .map((s: any) => ({ name: String(s?.name ?? ""), values: (s?.values ?? []).map((v: any) => Number(v)) }))
    .filter((s: any) => s.name && Array.isArray(s.values));
  if (labels.length < 2 || series.length === 0) return null;
  const sameLen = series.every((s: any) => s.values.length === labels.length);
  if (!sameLen) return null;
  const type: ChartSpec["type"] = obj.type === "bar" || obj.type === "scatter" || obj.type === "pie" ? obj.type : "line";
  const unit = obj.unit ? String(obj.unit) : undefined;
  const stacked = obj.stacked === true && type === "bar" ? true : undefined;
  // Require at least two non-zero numeric points across all series to avoid fabricated single-point charts
  const nonZeroPoints = labels.reduce((acc, _lab, i) => {
    const anyNonZero = series.some((s: any) => Number.isFinite(s.values[i]) && Math.abs(s.values[i]) > 0);
    return acc + (anyNonZero ? 1 : 0);
  }, 0);
  if (nonZeroPoints < 2) return null;
  // Extra rules for pie
  if (type === "pie") {
    if (series.length !== 1) return null; // single series expected
    const total = series[0].values.reduce((a: number, b: number) => a + (Number.isFinite(b) ? b : 0), 0);
    if (!(total > 0)) return null;
  }
  return { type, labels, series, unit, stacked } as ChartSpec;
}

async function buildChartSpecViaLLM(
  provider: "gemini" | "deepseek",
  model: string,
  apiKey: string,
  question: string,
  contexts: SourceWithText[]
): Promise<ChartSpec | null> {
  const ctx = contexts
    .map((c, i) => `S${i + 1} (${c.company ?? ""} ${c.published_date ?? ""} ${c.doc_type ?? ""}):\n${c.text}`)
    .join("\n\n");
  const prompt = `You will extract a concise chart specification suitable for plotting (time series, comparison, or composition) from the sources below, if and only if the question implies a chart/graph/visualization.

Question: ${question}

Rules:
- Do NOT fabricate numbers. If figures are not explicitly present, do not guess.
- Do NOT use 0 to represent missing/unknown values. Omit such periods instead.
- If fewer than 2 categories/periods with numeric values are available, output exactly: null
- Otherwise output ONLY a JSON object with fields: { "type": "line"|"bar"|"scatter"|"pie", "labels": string[], "series": [{"name": string, "values": number[]}], "unit"?: string, "stacked"?: boolean }
- If the question asks for a breakdown/composition/mix/proportion at a single point (e.g., AUM by asset class), prefer type "pie" with one series where labels are categories.
- If the question explicitly requests a stacked bar, set type "bar" and stacked=true. Values should stack per label.
- For time trends, labels should be short periods (FY2022, Q1 FY24, 2023) ordered chronologically.
- series.values must be numeric and aligned 1:1 to labels.
- Keep series count small (<= 3).
- Choose an appropriate unit (e.g., %, Cr, Bn) when inferable; else omit. For proportions, prefer % values when available.

Sources:\n${ctx}`;

  let raw = "";
  if (provider === "gemini") {
    raw = await callGemini(model, apiKey, prompt);
  } else {
    raw = await callDeepSeek(model, apiKey, prompt);
  }
  const parsed = extractJson(raw);
  const spec = validateChartSpec(parsed);
  return spec;
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

async function getAnswerWithFallback(
  cfg: ReturnType<typeof loadConfig>,
  prompt: string
): Promise<string> {
  // Try primary provider
  try {
    if (cfg.llmProvider === "gemini") {
      return await callGemini(cfg.llmModel, cfg.googleApiKey!, prompt);
    } else {
      return await callDeepSeek(cfg.llmModel, cfg.deepseekApiKey!, prompt);
    }
  } catch (e) {
    // Fallback to the other provider when available
    try {
      if (cfg.llmProvider === "gemini" && cfg.deepseekApiKey) {
        return await callDeepSeek("deepseek-chat", cfg.deepseekApiKey, prompt);
      }
      if (cfg.llmProvider === "deepseek" && cfg.googleApiKey) {
        return await callGemini("gemini-1.5-flash", cfg.googleApiKey, prompt);
      }
      throw e;
    } catch (e2) {
      throw e2;
    }
  }
}

type SourceWithText = Source & { text: string };

export async function getRAGAnswer(opts: {
  question: string;
  company?: string | null;
  charts?: boolean;
  chartStrategy?: "cheap" | "full";
}): Promise<AnswerResponse> {
  const question = opts.question.trim();
  const cfg = loadConfig();

  const embeddings = getEmbeddings({
    model: cfg.embeddingsModel,
    googleApiKey: cfg.googleApiKey,
  });
  const qvec = await embeddings.embedQuery(question);

  const client = getQdrantClient(cfg);
  try {
    console.info(
      `Qdrant search setup: collection='${cfg.qdrantCollection}', qvec.length=${qvec.length}`
    );
  } catch {}
  // Validate collection vector size vs embedding dimension to avoid 400 errors
  try {
    const coll: any = await (client as any).getCollection(cfg.qdrantCollection);
    const vectorsCfg = coll?.result?.config?.params?.vectors ?? coll?.result?.vectors;
    let expected = 0;
    if (vectorsCfg && typeof vectorsCfg.size === "number") {
      expected = vectorsCfg.size;
    } else if (vectorsCfg && typeof vectorsCfg === "object") {
      // named vectors shape { name: { size, distance } }
      const first = Object.values(vectorsCfg as any)[0] as any;
      if (first && typeof first.size === "number") expected = first.size;
    }
    if (expected) {
      try {
        console.info(
          `Qdrant collection '${cfg.qdrantCollection}' vector size=${expected}, qvec.length=${qvec.length}`
        );
      } catch {}
    }
    if (expected && expected !== qvec.length) {
      throw new Error(
        `Embedding dimension (${qvec.length}) does not match Qdrant collection '${cfg.qdrantCollection}' vector size (${expected}). ` +
          `Make sure EMBEDDINGS_MODEL matches the model used for ingestion, or re-ingest into this collection, ` +
          `or set QDRANT_COLLECTION to the correct one.`
      );
    }
  } catch (e: any) {
    if (!/does not match Qdrant collection/.test(String(e?.message || ""))) {
      // Non-fatal if fetch fails; continue
      console.warn("Qdrant getCollection check skipped:", e?.message || e);
    } else {
      throw e;
    }
  }
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

  let searchRes: any[] = [];
  let points: any[] = [];
  try {
    searchRes = (await client.search(cfg.qdrantCollection, {
      vector: qvec,
      limit: 8,
      with_payload: true,
      score_threshold: 0.2,
      filter,
    } as any)) as any[];
    points = searchRes as any[];
  } catch (e: any) {
    const detail = e?.response?.data || e?.message || e;
    console.error(
      "Qdrant search error (with filter):",
      typeof detail === "object" ? JSON.stringify(detail) : String(detail)
    );
    // Fallback: retry without filter (some clusters may reject the filter shape depending on payload types)
    try {
      const fallback = (await client.search(cfg.qdrantCollection, {
        vector: qvec,
        limit: 16,
        with_payload: true,
        score_threshold: 0.2,
      } as any)) as any[];
      points = fallback as any[];
    } catch (e2: any) {
      const d2 = e2?.response?.data || e2?.message || e2;
      console.error(
        "Qdrant unfiltered search also failed:",
        typeof d2 === "object" ? JSON.stringify(d2) : String(d2)
      );
      throw e; // surface original filtered error
    }
  }
  // If the strict equality filter returns no hits (common when filenames vary),
  // retry without filter and then apply a soft company check on payload fields.
  if ((points?.length ?? 0) === 0 && opts.company) {
    try {
      const fallback = (await client.search(cfg.qdrantCollection, {
        vector: qvec,
        limit: 16,
        with_payload: true,
        score_threshold: 0.2,
      } as any)) as any[];
      const toKey = (s: any) =>
        (s?.toString?.() || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");
      const want = toKey(opts.company);
      const soft = fallback.filter((p: any) => {
        const cand = toKey(`${p.payload?.company ?? ""} ${p.payload?.title ?? ""}`);
        return cand.includes(want);
      });
      points = soft.length > 0 ? soft : fallback;
    } catch (e) {
      console.warn("Qdrant fallback search failed:", (e as any)?.message || e);
    }
  }

  const contexts: SourceWithText[] = (points as any).map((p: any) => ({
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
  try {
    answer = await getAnswerWithFallback(cfg, prompt);
  } catch (e) {
    console.error("Primary & fallback LLM failed:", (e as any)?.message || e);
    // Provide a friendly message while still allowing chart derivation from the question
    answer = "I'm rate-limited right now and cannot generate a detailed answer. Please retry shortly. [System]";
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

  let chartSpec: ChartSpec | null = null;
  const chartsEnabled = opts.charts !== false;
  // If strategy is not explicitly cheap, allow LLM-based chart extraction
  if (chartsEnabled && isChartIntent(question) && opts.chartStrategy !== "cheap") {
    try {
      const chartProvider = (cfg.llmProviderChart || cfg.llmProvider) === "gemini" ? "gemini" : "deepseek";
      const chartModel = cfg.llmModelChart || cfg.llmModel;
      const apiKey = chartProvider === "gemini" ? cfg.googleApiKey : cfg.deepseekApiKey;
      if (!apiKey) throw new Error(`${chartProvider === "gemini" ? "GOOGLE_API_KEY" : "DEEPSEEK_API_KEY"} missing for chart model`);
      chartSpec = await buildChartSpecViaLLM(chartProvider as any, chartModel, apiKey, question, contexts.slice(0, 10));
    } catch (e) {
      console.warn("ChartSpec generation failed:", (e as any)?.message || e);
      // Try alternate provider if available
      try {
        const altProvider = (cfg.llmProviderChart || cfg.llmProvider) === "gemini" ? "deepseek" : "gemini";
        const altApiKey = altProvider === "gemini" ? cfg.googleApiKey : cfg.deepseekApiKey;
        const altModel = altProvider === "gemini" ? "gemini-1.5-flash" : "deepseek-chat";
        if (altApiKey) {
          chartSpec = await buildChartSpecViaLLM(altProvider as any, altModel, altApiKey, question, contexts.slice(0, 10));
        }
      } catch (e2) {
        console.warn("ChartSpec alt provider failed:", (e2 as any)?.message || e2);
      }
    }
  }

  // Guard: if the textual answer itself indicates insufficient info, suppress any chart
  if (chartsEnabled) {
    try {
      const a = (answer || "").toLowerCase();
      const indicatesNoData = /cannot be answered|insufficient data|don't know|do not know|not available/.test(a);
      if (indicatesNoData) {
        chartSpec = null;
      }
    } catch {}
  }

  // Sanitize: drop periods where all series values are missing/invalid/zero; require >=2 remaining
  if (chartsEnabled && chartSpec) {
    try {
      const keepIdx: number[] = [];
      for (let i = 0; i < chartSpec.labels.length; i++) {
        const anyValid = chartSpec.series.some((s) => Number.isFinite(s.values[i]) && Math.abs(s.values[i]) > 0);
        if (anyValid) keepIdx.push(i);
      }
      if (keepIdx.length >= 2) {
        const labels = keepIdx.map((i) => chartSpec!.labels[i]);
        const series = chartSpec.series.map((s) => ({ ...s, values: keepIdx.map((i) => s.values[i]) }));
        chartSpec = { ...chartSpec, labels, series } as ChartSpec;
      } else {
        chartSpec = null;
      }
    } catch {
      chartSpec = null;
    }
  }

  // Fallback or "cheap" strategy: If no chart spec yet, attempt to parse the textual answer for period->value pairs
  if (chartsEnabled && !chartSpec && isChartIntent(question)) {
    try {
      const derived = chartFromAnswerText(answer);
      if (derived) {
        chartSpec = derived;
      }
    } catch {}
  }
  // Fallback: As a last resort, parse from the question itself when user provides values directly
  if (chartsEnabled && !chartSpec && isChartIntent(question)) {
    try {
      const derivedQ = chartFromAnswerText(question);
      if (derivedQ) {
        chartSpec = derivedQ;
      }
    } catch {}
  }

  return { answer, sources, chartSpec };
}
