// Load environment variables for non-Next scripts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { loadConfig } from "../src/lib/config";
import { getQdrantClient } from "../src/lib/qdrant";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out as {
    collection?: string;
    company?: string;
    limit?: string;
    showText?: string | boolean;
  };
}

function truncate(s: any, n = 140) {
  const t = (s ?? "").toString();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

async function main() {
  const args = parseArgs();
  let cfg: any;
  try {
    cfg = loadConfig();
  } catch (_) {
    // Fallback: only use Qdrant envs
    cfg = {
      qdrantUrl: process.env.QDRANT_URL || "",
      qdrantApiKey: process.env.QDRANT_API_KEY || "",
      qdrantCollection: process.env.QDRANT_COLLECTION || "docs_text-embedding-004",
    } as any;
    if (!cfg.qdrantUrl || !cfg.qdrantApiKey) {
      throw new Error("Qdrant credentials missing. Set QDRANT_URL and QDRANT_API_KEY");
    }
  }
  const client = getQdrantClient(cfg as any);
  const collection = (args.collection as string) || (cfg as any).qdrantCollection;
  const limit = Math.max(1, Number(args.limit ?? 10));
  const showText = String(args.showText ?? "false").toLowerCase() === "true";

  console.log("\n== Qdrant: Collections ==");
  const cols: any = await client.getCollections();
  console.table(cols.collections?.map((c: any) => ({
    name: c.name,
    points_count: c.points_count,
  })) || []);

  console.log(`\n== Qdrant: Collection '${collection}' info ==`);
  const info: any = await client.getCollection(collection);
  console.dir(info?.result?.config ?? info?.result ?? info, { depth: 5 });

  console.log(`\n== Count points in '${collection}' ==`);
  try {
    const cnt: any = await (client as any).count(collection, { exact: true });
    console.log("count:", cnt?.result?.count ?? cnt?.count ?? cnt);
  } catch (e) {
    console.warn("count failed:", (e as any)?.message || e);
  }

  console.log(`\n== Sample ${limit} points (with_payload) ==`);
  const filter = args.company
    ? ({ must: [{ key: "company", match: { value: args.company } }] } as any)
    : undefined;
  const sc: any = await client.scroll(collection, {
    limit,
    with_payload: true,
    with_vector: false,
    filter,
  } as any);
  const points = sc.points || sc.result || [];
  const rows = points.map((p: any) => ({
    id: p.id,
    path: p.payload?.path,
    title: p.payload?.title,
    company: p.payload?.company,
    doc_type: p.payload?.doc_type,
    published_date: p.payload?.published_date,
    chunk_index: p.payload?.chunk_index,
    page_start: p.payload?.page_start,
    page_end: p.payload?.page_end,
    text: showText ? truncate(p.payload?.text) : undefined,
  }));
  console.table(rows);

  // Summarize payload keys
  const keys = new Set<string>();
  for (const p of points) {
    Object.keys(p.payload || {}).forEach((k) => keys.add(k));
  }
  console.log("\nPayload keys (sample):", Array.from(keys).sort());

  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error("inspect-qdrant error:", e?.message || e);
  process.exit(1);
});
