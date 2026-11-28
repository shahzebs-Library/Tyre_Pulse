import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

/*
 * Every Arabic page shares this frame: the Arabic font, right-to-left direction, and the
 * header and footer in Arabic. Header links go to the Arabic page where one exists.
 * 400 for body text and 700 for headings (heavier CSS weights resolve to 700).
 */
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "700"], variable: "--font-arabic", display: "swap" });

export default function ArabicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`rtl ar-page ${arabic.variable}`} lang="ar" dir="rtl">
      {/* Sets <html lang> and <html dir> before first paint; LocaleSync keeps it right after navigation. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.lang='ar';document.documentElement.dir='rtl'" }} />
      <Header locale="ar" />
      <main id="main-content" tabIndex={-1}>{children}</main>
      <Footer locale="ar" />
    </div>
  );
}
