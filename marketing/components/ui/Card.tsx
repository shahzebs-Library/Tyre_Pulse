import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Photo, type PhotoKey } from "@/components/art/Photos";
import { StatusBadge, type CapabilityStatus } from "./StatusBadge";

/**
 * The one card on the marketing site, in three variants:
 *
 *  - plain: white surface, hairline border. The default.
 *  - dark:  asphalt surface, white text. At most one per grid, for emphasis.
 *  - photo: a real photograph on top, the same body underneath. The text never
 *           sits on the photograph, so its contrast does not depend on the image.
 *
 * Title level is set by the caller (h2 when the card grid follows the page h1
 * directly, h3 under a section heading) so the page outline stays in order.
 */
export type CardProps = {
  variant?: "plain" | "dark" | "photo";
  as?: "li" | "div" | "article";
  titleAs?: "h2" | "h3";
  icon?: LucideIcon;
  photo?: { name: PhotoKey; position?: string; alt?: string };
  title: string;
  text?: string;
  status?: CapabilityStatus;
  /** A short label above the title, for example "Configured on request". */
  note?: string;
  href?: string;
  linkLabel?: string;
  /** Screen-reader name for the link when the visible label repeats across cards. */
  linkAria?: string;
  children?: React.ReactNode;
  className?: string;
};

export function Card({
  variant = "plain", as: Tag = "li", titleAs: Title = "h3", icon: Icon, photo, title, text, status, note,
  href, linkLabel = "Learn more", linkAria, children, className,
}: CardProps) {
  const kind = photo ? "photo" : variant;
  const external = href?.startsWith("http");
  return (
    <Tag className={`tp-card tp-card--${kind}${href ? " has-link" : ""}${className ? ` ${className}` : ""}`}>
      {photo && (
        <div className="tp-card-media">
          <Photo name={photo.name} position={photo.position} alt={photo.alt} sizes="(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 420px" />
        </div>
      )}
      <div className="tp-card-body">
        {(Icon || status) && (
          <div className="tp-card-top">
            {Icon && <Icon className="tp-card-icon" size={26} strokeWidth={1.7} aria-hidden="true" />}
            {status && <StatusBadge status={status} />}
          </div>
        )}
        {note && <span className="tp-card-note">{note}</span>}
        <Title className="tp-card-title">{title}</Title>
        {text && <p className="tp-card-text">{text}</p>}
        {children}
        {href && (external
          ? <a className="tp-card-link" href={href} aria-label={linkAria}>{linkLabel} <ArrowRight size={15} aria-hidden="true" /></a>
          : <Link className="tp-card-link" href={href} aria-label={linkAria} prefetch={false}>{linkLabel} <ArrowRight size={15} aria-hidden="true" /></Link>)}
      </div>
    </Tag>
  );
}

/** A responsive grid of cards. `cols` is the desktop column count; it steps down on tablets and phones. */
export function CardGrid({ cols = 3, children, as: Tag = "ul", className }: { cols?: 2 | 3 | 4; children: React.ReactNode; as?: "ul" | "div"; className?: string }) {
  return <Tag className={`tp-grid tp-grid--${cols}${className ? ` ${className}` : ""}`} data-reveal-group="">{children}</Tag>;
}
