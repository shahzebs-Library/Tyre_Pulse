import { Header } from "./Header";
import { Footer } from "./Footer";

export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {/*
        The id is the skip link target. tabIndex of -1 lets the browser move
        focus here rather than only scrolling, so a keyboard user genuinely
        lands past the navigation instead of tabbing back through it.
      */}
      <main id="main" tabIndex={-1}>{children}</main>
      <Footer />
    </>
  );
}
