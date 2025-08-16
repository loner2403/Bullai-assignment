import { NextResponse } from "next/server";
import { getRAGAnswer } from "@/lib/rag";

// Ensure Node.js runtime for compatibility with libraries used in RAG stack
export const runtime = "nodejs";

// --- QuickChart + Twilio helpers ---
type ChartSpec = {
  type?: "line" | "bar" | "scatter" | "pie";
  labels: string[];
  series: { name: string; values: number[]; color?: string }[];
  unit?: string;
  stacked?: boolean;
};

function chartSpecToChartJs(spec: ChartSpec) {
  const type = spec.type || "line";
  const isPie = type === "pie";
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6"]; // match UI palette
  const datasets = isPie
    ? [
        {
          label: spec.series[0]?.name || "",
          data: spec.series[0]?.values || [],
          backgroundColor: spec.labels.map((_, i) => colors[i % colors.length]),
        },
      ]
    : spec.series.map((s, i) => ({
        label: s.name,
        data: s.values,
        borderColor: s.color || colors[i % colors.length],
        backgroundColor: (s.color || colors[i % colors.length]) + "80",
        fill: type === "line" ? false : true,
      }));

  const config: any = {
    type: isPie ? "pie" : type === "scatter" ? "line" : type, // scatter approximated as line+points
    data: {
      labels: spec.labels,
      datasets,
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top", labels: { color: "#e5e7eb" } },
        title: { display: false },
      },
      scales: isPie
        ? undefined
        : {
            x: { ticks: { color: "#e5e7eb" }, grid: { color: "#374151" } },
            y: {
              stacked: type === "bar" && !!spec.stacked,
              ticks: { color: "#e5e7eb" },
              grid: { color: "#374151" },
              title: spec.unit ? { display: true, text: spec.unit, color: "#e5e7eb" } : undefined,
            },
          },
      elements: {
        point: { radius: 3 },
      },
    },
  };
  return config;
}

async function createQuickChartUrl(config: any): Promise<string | null> {
  const base = process.env.QUICKCHART_BASE_URL || "https://quickchart.io";
  const key = process.env.QUICKCHART_API_KEY;
  const body = { chart: config, backgroundColor: "transparent", format: "png", ...(key ? { key } : {}) } as any;

  const doPost = async () => {
    const resp = await fetch(`${base}/chart/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`QuickChart create failed: ${resp.status} ${text.slice(0, 200)}`);
    }
    const data = (await resp.json().catch(() => ({}))) as any;
    if (data?.success && data?.url) return data.url as string;
    throw new Error("QuickChart returned no url");
  };

  try {
    return await doPost();
  } catch (e) {
    console.warn("QuickChart create POST failed, retrying once:", (e as any)?.message || e);
    try {
      return await doPost();
    } catch (e2) {
      // Fallback: construct a GET rendering URL so Twilio can fetch the image directly
      try {
        const c = encodeURIComponent(JSON.stringify(config));
        const qs = `c=${c}&format=png&backgroundColor=transparent${key ? `&key=${encodeURIComponent(key)}` : ""}`;
        const url = `${base}/chart?${qs}`;
        return url;
      } catch (e3) {
        console.warn("QuickChart fallback URL failed:", (e3 as any)?.message || e3);
        return null;
      }
    }
  }
}

// Utility to timebox async operations
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return (await Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])) as any;
}

async function sendTwilioMessage(opts: { to: string; from: string; body?: string; mediaUrl?: string }) {
  const { to, from, body, mediaUrl } = opts;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials missing");

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  if (body) form.set("Body", body);
  if (mediaUrl) form.append("MediaUrl", mediaUrl);

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: form.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio send failed: ${resp.status} ${text}`);
  }
}

function buildTwimlMessage(text: string, mediaUrls?: string[]) {
  // TwiML with optional media (WhatsApp-compatible)
  const xmlEscape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const safe = xmlEscape((text || "").replace(/[\u0000-\u001F]/g, ""));
  const media = (mediaUrls || [])
    .filter(Boolean)
    .map((u) => `<Media>${xmlEscape(u)}</Media>`) // Twilio allows multiple Media elements
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message><Body>${safe}</Body>${media}</Message></Response>`;
}

export async function POST(req: Request) {
  try {
    // Twilio sends application/x-www-form-urlencoded by default
    const raw = await req.text();
    const params = new URLSearchParams(raw);
    const from = params.get("From") || params.get("WaId") || ""; // e.g., "whatsapp:+1415..."
    const toNum = params.get("To") || ""; // your Twilio WA number
    const body = (params.get("Body") || "").trim();

    if (!body) {
      const xml = buildTwimlMessage("Please send a question text.");
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
    }

    // Use RAG directly: no company inference. Forward user's message as-is.
    const question = body;
    const company: string | undefined = undefined;
    console.log("WA inbound:", { from, body, company, question });

    // Decide early if user wants a chart
    const wantsChart = /\b(chart|graph|plot|visuali[sz]e|trend|compare)\b/i.test(question);

    // Time budgets: keep total < ~15s to satisfy Twilio webhook
    const TIMEOUT_MS = Number(process.env.WHATSAPP_REPLY_TIMEOUT_MS || 9000);
    const CHEAP_TIMEOUT_MS = Math.max(2500, Math.min(6000, Math.floor(TIMEOUT_MS * 0.6)));

    // Kick off text answer and (optional) cheap chart concurrently
    const answerPromise = withTimeout(
      getRAGAnswer({ question, company, charts: false }),
      TIMEOUT_MS
    );

    const chartPromise: Promise<string | null> = wantsChart
      ? withTimeout(
          (async () => {
            const rich = await getRAGAnswer({ question, company, charts: true, chartStrategy: "cheap" });
            if (!rich?.chartSpec) return null;
            const config = chartSpecToChartJs(rich.chartSpec as ChartSpec);
            // Keep QuickChart call within the same budget window
            const url = await withTimeout(
              createQuickChartUrl({
                ...config,
                options: { ...config.options, layout: { padding: 8 } },
              }),
              Math.max(1500, CHEAP_TIMEOUT_MS - 500)
            );
            return url;
          })(),
          CHEAP_TIMEOUT_MS
        )
      : Promise.resolve(null);

    const [result, chartUrl] = (await Promise.all([answerPromise, chartPromise])) as [
      Awaited<ReturnType<typeof getRAGAnswer>> | null,
      string | null
    ];

    let answer = result?.answer || "I'm thinking about that. If you don't get a detailed reply, please rephrase your question and try again.";

    // Keep response concise for WhatsApp; truncate very long replies
    const maxLen = 2000; // keep under typical WA/Twilio limits
    if (answer.length > maxLen) {
      answer = answer.slice(0, maxLen - 20) + "\n… [truncated]";
    }

    // Attach chart media if ready within budget
    const mediaUrls: string[] = [];
    try {
      if (chartUrl) mediaUrls.push(chartUrl);
      else if (wantsChart) console.info("Chart not included (timed out or unavailable)");
    } catch (e) {
      console.warn("Chart attach failed", (e as any)?.message || e);
    }

    const xml = buildTwimlMessage(answer, mediaUrls);
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
  } catch (e: any) {
    console.error("/api/whatsapp error", e);
    const xml = buildTwimlMessage("Server error handling your message.");
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
  }
}

export async function GET() {
  // Optional: basic health endpoint
  return NextResponse.json({ ok: true, service: "whatsapp-webhook" });
}
