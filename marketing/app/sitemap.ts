import type { MetadataRoute } from "next";
import { SITE_URL } from "./schema";
import { AR_PAGES, englishPathOf } from "@/lib/nav";

type Entry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
};

/**
 * Only routes that genuinely exist. A page that has an Arabic translation (lib/nav AR_PAGES)
 * lists both language versions as alternates; the others list their English URL only.
 */
const ENTRIES: Entry[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/platform", changeFrequency: "monthly", priority: 0.9 },
  { path: "/platform/fleet-assets", changeFrequency: "monthly", priority: 0.8 },
  { path: "/platform/maintenance", changeFrequency: "monthly", priority: 0.8 },
  { path: "/platform/inspections", changeFrequency: "monthly", priority: 0.8 },
  { path: "/platform/tyre-lifecycle", changeFrequency: "monthly", priority: 0.8 },
  { path: "/platform/inventory", changeFrequency: "monthly", priority: 0.8 },
  { path: "/platform/reports", changeFrequency: "monthly", priority: 0.8 },
  { path: "/solutions", changeFrequency: "monthly", priority: 0.8 },
  { path: "/solutions/tyre-management", changeFrequency: "monthly", priority: 0.8 },
  { path: "/solutions/ready-mix-fleet", changeFrequency: "monthly", priority: 0.8 },
  { path: "/solutions/spreadsheets-to-platform", changeFrequency: "monthly", priority: 0.7 },
  { path: "/industries", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/security", changeFrequency: "monthly", priority: 0.7 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.7 },
  { path: "/ar", changeFrequency: "weekly", priority: 0.9 },
  { path: "/ar/platform", changeFrequency: "monthly", priority: 0.8 },
  { path: "/ar/pricing", changeFrequency: "monthly", priority: 0.7 },
  { path: "/ar/security", changeFrequency: "monthly", priority: 0.6 },
  { path: "/ar/contact", changeFrequency: "monthly", priority: 0.6 },
  { path: "/ar/solutions", changeFrequency: "monthly", priority: 0.7 },
  { path: "/ar/industries", changeFrequency: "monthly", priority: 0.7 },
  // Plain-text summaries for AI assistants, listed so crawlers can find them.
  { path: "/llms.txt", changeFrequency: "monthly", priority: 0.5 },
  { path: "/llms-full.txt", changeFrequency: "monthly", priority: 0.5 },
];

function alternatesOf(path: string) {
  const en = englishPathOf(path);
  const ar = AR_PAGES[en];
  if (!ar) return undefined;
  return { languages: { en: `${SITE_URL}${en}`, ar: `${SITE_URL}${ar}`, "x-default": `${SITE_URL}${en}` } };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ENTRIES.map(({ path, changeFrequency, priority }) => {
    const alternates = alternatesOf(path);
    return {
      url: `${SITE_URL}${path}`,
      lastModified,
      changeFrequency,
      priority,
      ...(alternates ? { alternates } : {}),
    };
  });
}
