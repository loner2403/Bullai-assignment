import fs from "fs";
import path from "path";
import pdf from "pdf-parse";

async function main() {
  const file = process.argv[2];
  const max = Number(process.argv[3] || 2500);
  if (!file) {
    console.error("Usage: tsx scripts/peek-pdf.ts <pdf_path> [max_chars]");
    process.exit(1);
  }
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  const buf = fs.readFileSync(abs);
  const data = await pdf(buf);
  const text = (data.text || "").replace(/\s+$/g, "");
  const out = text.slice(0, max);
  console.log(out);
}

main().catch((e) => {
  console.error("peek-pdf error:", e?.message || e);
  process.exit(1);
});
