import type { MetadataRoute } from "next";
import { SITE_URL } from "./schema";

/** The English home page and the Arabic home page are a real translation pair. */
const HOME_ALTERNATES = {
  languages: {
    en: `${SITE_URL}/`,
    ar: `${SITE_URL}/ar`,
    "x-default": `${SITE_URL}/`,
  },
};

type Entry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  alternates?: typeof HOME_ALTERNATES;
};

/**
 * Only routes that genuinely exist. Inner pages carry no language alternates
 * because they have no Arabic counterpart yet.
 */
const ENTRIES: Entry[] = [
  { path: "/", changeFrequency: "weekly", priority: 1, alternates: HOME_ALTERNATES },
  { path: "/product", changeFrequency: "monthly", priority: 0.9 },
  { path: "/industries", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/security", changeFrequency: "monthly", priority: 0.7 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.7 },
  { path: "/ar", changeFrequency: "weekly", priority: 0.9, alternates: HOME_ALTERNATES },
  // Plain-text summaries for AI assistants, listed so crawlers can find them.
  { path: "/llms.txt", changeFrequency: "monthly", priority: 0.5 },
  { path: "/llms-full.txt", changeFrequency: "monthly", priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ENTRIES.map(({ path, changeFrequency, priority, alternates }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
    ...(alternates ? { alternates } : {}),
  }));
}
