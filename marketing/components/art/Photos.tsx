import Image from "next/image";

/**
 * Real photographs used across the marketing site.
 *
 * Sources, both supplied by the owner:
 *  - cropped from the owner's approved page mockups (2026-09-28): the wheel
 *    loader and its detail crops and the signature on a phone;
 *  - owner-supplied site photos (technician at a generator, engineer with a
 *    tablet); another company's logo was removed from the vest;
 *  - the Flutter app's own vehicle and login artwork (tyre_pulse_flutter/assets).
 * Stored locally under public/photos so the site depends on no external host.
 */
const PHOTOS = {
  loader: { src: "/photos/loader.webp", w: 1302, h: 711, alt: "Wheel loader on a quarry site" },
  loaderCab: { src: "/photos/loader-cab.webp", w: 435, h: 435, alt: "Wheel loader cab" },
  loaderTyre: { src: "/photos/loader-tyre.webp", w: 336, h: 336, alt: "Wheel loader front tyre" },
  loaderBucket: { src: "/photos/loader-bucket.webp", w: 450, h: 360, alt: "Wheel loader bucket" },
  technicianPhone: { src: "/photos/technician-phone.webp", w: 1030, h: 1124, alt: "Technician in hi-vis checking a job on his phone beside a generator" },
  technicianGenerator: { src: "/photos/technician-generator.webp", w: 1399, h: 1124, alt: "Technician servicing a generator engine with a ratchet" },
  signature: { src: "/photos/signature.webp", w: 486, h: 558, alt: "Technician signing a job completion on a phone" },
  engineer: { src: "/photos/engineer-tablet.webp", w: 1399, h: 1124, alt: "Engineer in a hard hat holding a tablet on a rooftop plant area" },
  loaderSite: { src: "/photos/wheel-loader-site.webp", w: 576, h: 347, alt: "Wheel loader parked on a construction site" },
  fleetLineup: { src: "/photos/fleet-lineup.webp", w: 1327, h: 1185, alt: "Wheel loader, concrete pump truck and staff bus in front of a city skyline" },
  mixer: { src: "/photos/transit-mixer.webp", w: 447, h: 447, alt: "Transit mixer truck" },
  riyadh: { src: "/photos/riyadh-loader.webp", w: 800, h: 1067, alt: "Wheel loader in front of the Riyadh skyline at night" },
} as const;

export type PhotoKey = keyof typeof PHOTOS;

export function Photo({
  name, className = "art", fit = "cover", position, priority, alt, sizes = "(max-width: 720px) 100vw, 50vw",
}: {
  name: PhotoKey; className?: string; fit?: "cover" | "contain"; position?: string; priority?: boolean; alt?: string; sizes?: string;
}) {
  const p = PHOTOS[name];
  return (
    <Image
      src={p.src}
      width={p.w}
      height={p.h}
      alt={alt ?? p.alt}
      className={`${className} photo-${fit}`}
      style={position ? { objectPosition: position } : undefined}
      priority={priority}
      sizes={sizes}
    />
  );
}
