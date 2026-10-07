import Image from "next/image";

/**
 * Real photographs of the asset classes Tyre Pulse tracks, for the moving strip on
 * the home page. Sources are owner-supplied only (the app's own vehicle photos in
 * public/vehicle-photos and the cleaned site photos in marketing/public/photos).
 *
 * OWNER RULE: no third-party logos or brand marks on the public site. Every
 * maker's wordmark, badge, plate logo and model sticker was removed from these
 * copies (OpenCV inpaint or a fill in the panel colour) and each tile was checked
 * at 2x before shipping. The originals are untouched. Backgrounds are normalised
 * to the same light neutral (#f4f3ee) so the tiles read as one set.
 *
 * Decorative: the visible name next to each photo is the accessible label.
 */
export const FLEET = [
  { name: "Transit mixers", src: "/fleet/transit-mixer.webp", w: 320, h: 200 },
  { name: "Concrete pumps", src: "/fleet/concrete-pump.webp", w: 320, h: 200 },
  { name: "Placing booms", src: "/fleet/placing-boom.webp", w: 320, h: 200 },
  { name: "Line pumps", src: "/fleet/line-pump.webp", w: 320, h: 200 },
  { name: "Stationary pumps", src: "/fleet/stationary-pump.webp", w: 320, h: 200 },
  { name: "Wheel loaders", src: "/fleet/wheel-loader.webp", w: 320, h: 200 },
  { name: "Skid loaders", src: "/fleet/skid-loader.webp", w: 320, h: 200 },
  { name: "Generators", src: "/fleet/generator.webp", w: 320, h: 200 },
  { name: "Batching plants", src: "/fleet/batching-plant.webp", w: 320, h: 200 },
  { name: "Pickups", src: "/fleet/pickup.webp", w: 320, h: 200 },
  { name: "Staff buses", src: "/fleet/staff-bus.webp", w: 320, h: 200 },
  { name: "Vans", src: "/fleet/van.webp", w: 320, h: 200 },
] as const;

export function FleetVehicle({ src, w, h }: { src: string; w: number; h: number }) {
  return (
    <span className="fv">
      <Image className="fv-img" src={src} width={w} height={h} sizes="150px" loading="lazy" alt="" />
    </span>
  );
}
