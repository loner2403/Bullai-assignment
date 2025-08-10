#!/usr/bin/env tsx
/*
 Ingest PDFs into Qdrant Cloud.
 Usage:
   npm run ingest -- --path "../Technical task"
 Env (see env.example):
   QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION
   EMBEDDINGS_MODEL, GOOGLE_API_KEY
*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pdf from "pdf-parse";
import { getQdrantClient, ensureCollection } from "../src/lib/qdrant";
import { getEmbeddings } from "../src/lib/embeddings";
import { loadConfig } from "../src/lib/config";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

function walk(targetPath: string, filterExt = [".pdf"]): string[] {
  const out: string[] = [];
  const st = fs.statSync(targetPath);
  if (st.isFile()) {
    if (filterExt.includes(path.extname(targetPath).toLowerCase())) return [targetPath];
    return out;
  }
  for (const entry of fs.readdirSync(targetPath)) {
    const p = path.join(targetPath, entry);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (entry === "__MACOSX") continue;
      out.push(...walk(p, filterExt));
    } else if (filterExt.includes(path.extname(entry).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

function normalizeText(t: string) {
  // Remove zero-width chars, normalize whitespace, collapse long repeats
  return t
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ") // keep newlines, squash spaces/tabs only
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([\-=_])\1{3,}/g, "$1$1$1")
    .trim();
}

// Group PDF.js text items into lines using Y-coordinate deltas and hasEOL hints.
function linesFromTextContent(content: any) {
  const items = (content?.items || []) as Array<{
    str: string;
    transform?: number[];
    hasEOL?: boolean;
  }>;
  const lines: string[] = [];
  let cur: string[] = [];
  let prevY: number | null = null;
  const yThresh = 3; // px threshold to detect new line
  for (const it of items) {
    const y = Array.isArray(it.transform) && it.transform.length >= 6 ? Number(it.transform[5]) : NaN;
    if (cur.length === 0) {
      cur.push(it.str);
      prevY = y;
    } else {
      const newLine = Number.isFinite(y) && Number.isFinite(prevY!) ? Math.abs(y - (prevY as number)) > yThresh : false;
      if (newLine || it.hasEOL) {
        lines.push(cur.join(" ").trim());
        cur = [it.str];
        prevY = y;
      } else {
        cur.push(it.str);
        if (Number.isFinite(y)) prevY = y; // update baseline slowly
      }
    }
  }
  if (cur.length > 0) lines.push(cur.join(" ").trim());
  // Clean lines and drop empties
  const cleanLines = lines.map((l) => normalizeText(l)).filter((l) => l.length > 0);
  const totalChars = cleanLines.reduce((a, b) => a + b.length, 0);
  const bulletLines = cleanLines.filter((l) => /^([•\-*–—·]\s+)/.test(l)).length;
  const avgLineLen = cleanLines.length ? totalChars / cleanLines.length : 0;
  return { text: normalizeText(cleanLines.join("\n")), lines: cleanLines, stats: { bulletLines, avgLineLen, totalChars } };
}

function detectPageType(stats: { bulletLines: number; avgLineLen: number; totalChars: number }) {
  // Heuristics: low total chars, short lines, bullets => likely slide
  const slideByChars = stats.totalChars <= 800; // default threshold
  const slideByBullets = stats.bulletLines >= 2 && stats.bulletLines / Math.max(1, stats.totalChars / 200) > 0.05; // rough density
  const slideByAvgLen = stats.avgLineLen > 0 && stats.avgLineLen < 60;
  const isSlide = slideByChars || slideByBullets || slideByAvgLen;
  return isSlide ? "slide" : "text";
}

function pickHeading(lines: string[]): string | null {
  if (!lines || lines.length === 0) return null;
  const candidates = lines.slice(0, Math.min(2, lines.length));
  const score = (s: string) => {
    const len = s.length;
    if (len === 0 || len > 80) return 0;
    const letters = s.replace(/[^A-Za-z]/g, "");
    const upper = letters.replace(/[a-z]/g, "");
    const upperRatio = letters.length ? upper.length / letters.length : 0;
    const hasPunct = /[.;:!?]$/.test(s);
    const looksBullet = /^([•\-*–—·]\s+)/.test(s);
    // prefer short, upper-ish, non-bullet, no sentence punctuation
    return (1 - len / 80) + upperRatio * 0.7 + (hasPunct ? -0.6 : 0.2) + (looksBullet ? -0.8 : 0);
  };
  let best = "";
  let bestScore = -Infinity;
  for (const c of candidates) {
    const sc = score(c);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}

function fileMetaFromName(fp: string) {
  const base = path.basename(fp);
  const m = base.match(/([A-Za-z0-9\-\_]+?)[\-\_](\d{8})?\.pdf$/i);
  const title = base.replace(/\.pdf$/i, "");
  return {
    title,
    source: base,
    company: title.split("-")[0],
    published_date: (m && m[2]) || undefined,
    doc_type: /call|transcript|analyst/i.test(title) ? "transcript" : /presentation|ppt/i.test(title) ? "presentation" : undefined,
  };
}

async function main() {
  // Load env
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });
  const cfg = loadConfig();

  const args = parseArgs();
  const inputPath = args.path || path.resolve(process.cwd(), "../Technical task");
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input path not found: ${inputPath}`);
  }
  let files = walk(inputPath, [".pdf"]);
  const filesLimit = Number(args.filesLimit) || 0;
  if (filesLimit > 0) files = files.slice(0, filesLimit);
  if (files.length === 0) {
    console.log("No PDFs found to ingest.");
    return;
  }
  console.log(`Found ${files.length} PDF(s). Embedding model: ${cfg.embeddingsModel}`);

  const embeddings = getEmbeddings({
    model: cfg.embeddingsModel,
    googleApiKey: cfg.googleApiKey,
  });

  // Determine vector size by probing one embedding
  const dimVec = await embeddings.embedQuery("dimension probe");
  const vectorSize = dimVec.length;

  const client = getQdrantClient(cfg);
  await ensureCollection({ client, collection: cfg.qdrantCollection, vectorSize });

  for (const [i, file] of files.entries()) {
    console.log(`[${i + 1}/${files.length}] Reading`, path.basename(file));
    const buffer = fs.readFileSync(file);
    // Tunables (can be overridden via CLI): --chunkSize --overlap --batchSize --upsertBatch
    const chunkSize = Number(args.chunkSize) || 1200;
    const overlap = Number(args.overlap) || 200;
    const batchSize = Number(args.batchSize) || 8; // smaller batch reduces peak memory
    const upBatch = Number(args.upsertBatch) || 32; // smaller upsert slice reduces payload size
    const minChunkChars = Number(args.minChunkChars) || 200;
    const logPages = String(args.logPages || "0").toLowerCase() === "1" || String(args.logPages || "").toLowerCase() === "true";
    const dedupeWindow = Number(args.dedupeWindow) || 20000; // max hashes kept before resetting
    const perPage = String(args.perPage || "0").toLowerCase() === "1" || String(args.perPage || "").toLowerCase() === "true";
    const strategy = ((args.strategy as string) || "auto").toLowerCase() as "auto" | "recursive" | "perpage" | "semantic";
    const detectSlides = String(args.detectSlides || "1").toLowerCase() === "1" || String(args.detectSlides || "").toLowerCase() === "true";
    const headerPrefix = String(args.headerPrefix || "1").toLowerCase() === "1" || String(args.headerPrefix || "").toLowerCase() === "true";
    const pageLimit = Number(args.pageLimit) || 0;
    const timeoutMs = Number(args.timeoutMs) || 30000;

    const meta = fileMetaFromName(file);

    let processed = 0;
    let nextIndex = 0;
    let pending: { text: string; index: number; page_start?: number; page_end?: number }[] = [];
    const seen = new Set<string>(); // per-file dedupe

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
      let to: any;
      const timeout = new Promise<never>((_, rej) => {
        to = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
      });
      try {
        return await Promise.race([p, timeout]);
      } finally {
        clearTimeout(to);
      }
    }

    async function embedWithRetry(texts: string[], attempts = 3): Promise<number[][]> {
      let delay = 500;
      for (let a = 1; a <= attempts; a++) {
        try {
          console.log(`  Embedding ${texts.length} chunk(s) [attempt ${a}]...`);
          return await withTimeout(embeddings.embedDocuments(texts), timeoutMs, "embeddings");
        } catch (e) {
          console.warn(`  Embeddings attempt ${a} failed:`, (e as any)?.message || e);
          if (a === attempts) throw e;
          await sleep(delay);
          delay *= 2;
        }
      }
      throw new Error("unreachable");
    }

    async function upsertWithRetry(subPoints: any[], attempts = 3) {
      let delay = 500;
      for (let a = 1; a <= attempts; a++) {
        try {
          console.log(`  Upserting ${subPoints.length} point(s) [attempt ${a}]...`);
          await withTimeout(client.upsert(cfg.qdrantCollection, { points: subPoints as any }), timeoutMs, "qdrant upsert");
          return;
        } catch (e) {
          console.warn(`  Upsert attempt ${a} failed:`, (e as any)?.message || e);
          if (a === attempts) throw e;
          await sleep(delay);
          delay *= 2;
        }
      }
    }

    const flushPending = async () => {
      if (pending.length === 0) return;
      const texts = pending.map((c) => c.text);
      const embs = await embedWithRetry(texts);
      const points = pending.map((c, j) => {
        const md5 = crypto.createHash("md5").update(file + "#" + c.index).digest("hex");
        const id = parseInt(md5.slice(0, 12), 16);
        return {
          id,
          vector: embs[j],
          payload: {
            ...meta,
            path: path.relative(process.cwd(), file),
            chunk_index: c.index,
            text: c.text,
            page_start: c.page_start,
            page_end: c.page_end,
          },
        };
      });
      for (let p = 0; p < points.length; p += upBatch) {
        const sub = points.slice(p, p + upBatch);
        await upsertWithRetry(sub);
      }
      processed += pending.length;
      pending = [];
      console.log(`  Upserted batch, processed ~${processed} chunks so far`);
    };

    let pageCount = 0;
    await pdf(buffer, {
      pagerender: async (pageData: any) => {
        try {
          if (pageLimit > 0 && pageCount >= pageLimit) {
            return "";
          }
          const content = await pageData.getTextContent();
          const { text: pageText0, lines, stats } = linesFromTextContent(content);
          const pn = (pageData as any)?.pageNumber ?? pageCount + 1;
          const mode = perPage
            ? "perpage"
            : strategy === "auto"
            ? (detectSlides ? detectPageType(stats) : "text")
            : strategy === "semantic"
            ? "recursive"
            : strategy; // normalize aliases
          let pageText = pageText0;
          let heading: string | null = null;
          if (headerPrefix && mode !== "perpage") {
            heading = pickHeading(lines);
          } else if (headerPrefix && mode === "perpage") {
            // even for per-page, try to capture a title line to prefix
            heading = pickHeading(lines);
          }
          if (logPages) {
            console.log(`  Page ${pn}: chars=${pageText.length} mode=${mode}${heading ? " heading=\"" + heading + "\"" : ""}`);
          }

          if (mode === "perpage" || mode === "slide") {
            const text = heading ? `${heading}\n\n${pageText}` : pageText;
            if (text.length >= Math.min(80, minChunkChars)) {
              const h = crypto.createHash("md5").update(text).digest("hex");
              if (!seen.has(h)) {
                seen.add(h);
                if (seen.size > dedupeWindow) seen.clear();
                pending.push({ text, index: nextIndex++, page_start: pn, page_end: pn });
                if (pending.length >= batchSize) {
                  await flushPending();
                }
              }
            }
          } else {
            // Recursive splitter with layout-aware separators
            const splitter = new RecursiveCharacterTextSplitter({
              chunkSize,
              chunkOverlap: overlap,
              separators: ["\n\n", "\n• ", "\n- ", "\n– ", "\n— ", "\n", ". ", "; ", " "],
            });
            const base = heading ? `${heading}\n\n${pageText}` : pageText;
            const chunks = await splitter.splitText(base);
            for (const t of chunks) {
              const text = normalizeText(t);
              if (text.length < minChunkChars) continue;
              const h = crypto.createHash("md5").update(text).digest("hex");
              if (seen.has(h)) continue;
              seen.add(h);
              if (seen.size > dedupeWindow) seen.clear();
              pending.push({ text, index: nextIndex++, page_start: pn, page_end: pn });
              if (pending.length >= batchSize) {
                await flushPending();
              }
            }
            // Ensure we don't wait until file end if a page has < batchSize new chunks
            if (pending.length > 0) {
              await flushPending();
            }
          }
          pageCount++;
        } catch (e) {
          console.warn("  Page parse warning:", e);
        }
        // Return empty to avoid accumulating full text in memory
        return "";
      },
    } as any);

    // Flush remaining
    if (pending.length > 0) {
      await flushPending();
    }
    if (processed === 0) {
      console.warn("  Skipped (no text found). Consider OCR option later:", path.basename(file));
      continue;
    }
    console.log("  Upserted total chunks:", processed);
  }
  console.log("Ingestion complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
