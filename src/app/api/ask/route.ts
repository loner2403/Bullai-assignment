import { NextResponse } from "next/server";
import { getRAGAnswer } from "@/lib/rag";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = (body?.question || "").toString();
    const company = body?.company ? String(body.company) : undefined;
    if (!question.trim()) {
      return NextResponse.json({ error: "Invalid question" }, { status: 400 });
    }
    const result = await getRAGAnswer({ question, company });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("/api/ask error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
