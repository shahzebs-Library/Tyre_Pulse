import { Header } from "./Header";
import { Footer } from "./Footer";

export function PageFrame({ children }: { children: React.ReactNode }) {
  return <><Header /><main>{children}</main><Footer /></>;
}
