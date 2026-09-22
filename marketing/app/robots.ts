import type { MetadataRoute } from "next";
import { SITE_URL } from "./schema";

/**
 * Tyre Pulse marketing content is public and we want it quoted accurately by
 * assistants, so the major AI crawlers are named explicitly rather than left to
 * infer permission from the wildcard rule. The API route stays closed to everyone.
 */
const AI_CRAWLERS = [
  // OpenAI
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Google and Apple AI training controls
  "Google-Extended",
  "Applebot-Extended",
  // Common Crawl, which feeds many model corpora
  "CCBot",
  // Search and assistant crawlers
  "Bingbot",
  "Amazonbot",
  "meta-externalagent",
  "Bytespider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: ["/api/"] })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
