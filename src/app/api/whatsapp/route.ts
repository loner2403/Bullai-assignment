import { NextResponse } from "next/server";
import { getRAGAnswer } from "@/lib/rag";

// Ensure Node.js runtime for compatibility with libraries used in RAG stack
export const runtime = "nodejs";

function buildTwimlMessage(text: string) {
  // Basic TwiML response
  const safe = (text || "").replace(/[\u0000-\u001F]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${safe}</Message></Response>`;
}

export async function POST(req: Request) {
  try {
    // Twilio sends application/x-www-form-urlencoded by default
    const raw = await req.text();
    const params = new URLSearchParams(raw);
    const from = params.get("From") || params.get("WaId") || ""; // e.g., "whatsapp:+1415..."
    const body = (params.get("Body") || "").trim();

    if (!body) {
      const xml = buildTwimlMessage("Please send a question text.");
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
    }

    // Optional: infer a simple company tag if user prefixes like "@Company: question"
    let question = body;
    let company: string | undefined = undefined;
    const m = /^@([^:]+):\s*(.*)$/i.exec(body);
    if (m) {
      company = m[1].trim();
      question = m[2].trim();
    }

    // Call RAG core
    const result = await getRAGAnswer({ question, company });

    let answer = result?.answer || "Sorry, I couldn't generate an answer right now.";

    // Keep response concise for WhatsApp; truncate very long replies
    const maxLen = 2000; // keep under typical WA/Twilio limits
    if (answer.length > maxLen) {
      answer = answer.slice(0, maxLen - 20) + "\n… [truncated]";
    }

    const xml = buildTwimlMessage(answer);
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
