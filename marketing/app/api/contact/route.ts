import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(200),
  company: z.string().trim().min(2).max(160),
  country: z.string().trim().min(2).max(100),
  fleetSize: z.string().trim().max(100).optional().default(""),
  industry: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  website: z.string().max(0).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Please check the highlighted information and try again." }, { status: 400 });
    if (parsed.data.website) return NextResponse.json({ message: "Request received." });

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
