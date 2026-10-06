import { NextResponse } from "next/server";
import { z } from "zod";

// Single-line fields: control characters and line breaks are folded to one space, so a
// submitted value can never forge an extra "Field: value" line in the delivered email.
const line = (min: number, max: number) =>
  z.string().transform((v) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()).pipe(z.string().min(min).max(max));

const requestSchema = z.object({
  name: line(2, 100),
  email: z.string().trim().email().max(200),
  company: line(2, 160),
  country: line(2, 100),
  fleetSize: line(1, 100),
  industry: line(0, 120).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  website: z.string().max(0).optional().default(""),
});

// A real request is well under 4 KB; anything far larger is refused before it is read.
const MAX_BODY_BYTES = 16 * 1024;

// Best-effort abuse guard: each serverless instance keeps a short per-IP window.
// It does not replace an edge rate limit, but it stops one client flooding the inbox.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

function header(request: Request, name: string): string | null {
  return request.headers?.get?.(name) ?? null;
}

function sameSite(request: Request): boolean {
  const origin = header(request, "origin");
  if (!origin) return true; // non-browser clients still pass the schema + rate limit
  try {
    return new URL(origin).host === header(request, "host");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameSite(request)) {
    return NextResponse.json({ message: "Request not allowed." }, { status: 403 });
  }
  const ip = (header(request, "x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ message: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }
  if (Number(header(request, "content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ message: "Request is too large." }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ message: "Please send a valid JSON request." }, { status: 400 });
  }
  // Honeypot: a filled hidden field is a bot. Answer exactly as a success would, so the
  // bot learns nothing, and never deliver it.
  if (raw && typeof raw === "object" && String((raw as { website?: unknown }).website ?? "") !== "") {
    return NextResponse.json({ message: "Thank you. Your demo request has been received." });
  }
  try {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Please check the highlighted information and try again." }, { status: 400 });

    const apiKey = process.env.RESEND_API_KEY;
    const recipient = process.env.CONTACT_TO_EMAIL;
    const sender = process.env.CONTACT_FROM_EMAIL;
    if (!apiKey || !recipient || !sender) {
      return NextResponse.json({ message: "Demo requests are temporarily unavailable. Please try again later." }, { status: 503 });
    }
    const { name, email, company, country, fleetSize, industry, message } = parsed.data;
    const delivery = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        reply_to: email,
        subject: "Tyre Pulse demo request",
        text: [`Name: ${name}`, `Email: ${email}`, `Company: ${company}`, `Country: ${country}`, `Fleet size: ${fleetSize}`, `Industry: ${industry}`, "", message].join("\n"),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const receipt = await delivery.json();
    if (!delivery.ok || typeof receipt?.id !== "string" || !receipt.id) {
      return NextResponse.json({ message: "We could not send your request. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ message: "Thank you. Your demo request has been received." });
  } catch {
    return NextResponse.json({ message: "We could not send your request. Please try again." }, { status: 500 });
  }
}
