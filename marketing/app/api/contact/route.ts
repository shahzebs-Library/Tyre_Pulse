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

    // Connect an approved server-side email/CRM provider here. Never expose provider secrets in browser code.
    console.info("Qualified Tyre Pulse demo request received", {
      ...parsed.data,
      email: parsed.data.email.replace(/(^.).*(@.*$)/, "$1***$2"),
    });

    return NextResponse.json({ message: "Thank you. Your demo request has been received." });
  } catch {
    return NextResponse.json({ message: "We could not send your request. Please try again." }, { status: 500 });
  }
}
