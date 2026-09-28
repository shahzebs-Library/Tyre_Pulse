/**
 * Original machine illustrations for the marketing site.
 *
 * Every drawing here was made for Tyre Pulse in plain SVG: no photographs, no
 * stock art, no manufacturer livery or logos. That keeps the site free of any
 * image-licensing question while still showing the plant, machinery and
 * vehicles the product manages. Server components, zero client JavaScript.
 */

const Y = "#F2B400"; // body yellow
const YS = "#C98C00"; // body shade
const YL = "#FFD34D"; // body highlight
const K = "#1C1C1C"; // tyre / outline
const ST = "#5D6368"; // steel
const STL = "#8E959A"; // light steel
const GL = "#2E3E48"; // glass
const GLH = "#6E8796"; // glass highlight

type ArtProps = { className?: string; title?: string };

/** A tyre with lugs, a painted rim and a hub. */
function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const lugs = Array.from({ length: 18 }, (_, i) => i * 20);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={K} />
      {lugs.map((a) => (
        <rect
          key={a}
          x={cx - r * 0.09}
          y={cy - r - r * 0.04}
          width={r * 0.18}
          height={r * 0.16}
          rx={r * 0.03}
          fill="#2B2B2B"
          transform={`rotate(${a} ${cx} ${cy})`}
        />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.78} fill="#262626" />
      <circle cx={cx} cy={cy} r={r * 0.5} fill={Y} stroke={YS} strokeWidth={r * 0.06} />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={ST} />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <circle key={a} cx={cx} cy={cy - r * 0.34} r={r * 0.045} fill={YS} transform={`rotate(${a} ${cx} ${cy})`} />
      ))}
    </g>
  );
}

/** Warm site backdrop: haze, a far spoil heap and packed ground. */
function SiteBackdrop({ w, h, ground }: { w: number; h: number; ground: number }) {
  return (
    <g>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EDE7DA" />
          <stop offset="1" stopColor="#D9CDB4" />
        </linearGradient>
        <linearGradient id="dirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B99C73" />
          <stop offset="1" stopColor="#8E744F" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill="url(#sky)" />
      <path d={`M0 ${ground - 40} Q ${w * 0.18} ${ground - 120} ${w * 0.36} ${ground - 50} T ${w * 0.7} ${ground - 70} T ${w} ${ground - 30} V ${ground} H0z`} fill="#CBB894" opacity=".7" />
      <rect y={ground} width={w} height={h - ground} fill="url(#dirt)" />
      {Array.from({ length: 14 }, (_, i) => (
        <ellipse key={i} cx={(i * 97) % w} cy={ground + 18 + ((i * 37) % (h - ground - 20))} rx={10 + (i % 4) * 6} ry={3} fill="#7B6342" opacity=".35" />
      ))}
    </g>
  );
}

function Frame({ vb, children, className, title }: { vb: string; children: React.ReactNode } & ArtProps) {
  return (
    <svg className={className} viewBox={vb} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} preserveAspectRatio="xMidYMid slice">
      {children}
    </svg>
  );
}

function LoaderBody() {
  return (
    <g>
      {/* rear engine hood and counterweight */}
      <path d="M430 170 h120 q14 0 16 14 l6 60 h-156z" fill={Y} />
      <path d="M430 170 h120 q14 0 16 14 l2 14 h-138z" fill={YL} opacity=".55" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={452 + i * 20} y={200} width={10} height={32} rx={3} fill={YS} />)}
      <rect x="560" y="236" width="26" height="30" rx="4" fill={K} />
      <rect x="505" y="150" width="10" height="22" rx="3" fill={K} />
      {/* chassis */}
      <path d="M170 228 h410 v34 q0 8 -8 8 h-394 q-8 0 -8 -8z" fill={YS} />
      <path d="M170 228 h410 v10 h-410z" fill={Y} />
      {/* cab */}
      <path d="M330 92 h104 q8 0 8 8 v128 h-120 v-128 q0 -8 8 -8z" fill={Y} />
      <rect x="322" y="84" width="128" height="14" rx="4" fill={YS} />
      <path d="M338 106 h86 v96 h-92z" fill={GL} />
      <path d="M346 112 l24 0 l-30 82 h-6z" fill={GLH} opacity=".45" />
      <rect x="378" y="106" width="6" height="96" fill={Y} />
      <rect x="360" y="206" width="22" height="18" rx="3" fill={K} />
      {/* lift arm and cylinder */}
      <path d="M318 196 L148 172 L136 196 L312 222z" fill={Y} />
      <path d="M318 196 L148 172 L146 180 L316 204z" fill={YL} opacity=".5" />
      <path d="M300 238 L178 196" stroke={STL} strokeWidth="11" strokeLinecap="round" />
      <path d="M300 238 L238 217" stroke={ST} strokeWidth="15" strokeLinecap="round" />
      <circle cx="318" cy="208" r="12" fill={K} />
      <circle cx="146" cy="186" r="10" fill={K} />
      {/* bucket */}
      <path d="M150 150 Q 62 150 44 206 L36 286 H154 L160 250 Q 118 240 128 200 Q 136 172 164 170z" fill={Y} />
      <path d="M150 150 Q 62 150 44 206 L42 222 Q 70 170 150 166z" fill={YL} opacity=".5" />
      <path d="M36 286 H154 L150 296 H34z" fill={ST} />
      {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${40 + i * 23} 296 l8 14 l8 -14z`} fill={STL} />)}
    </g>
  );
}

/** Articulated wheel loader, side view, on site. */
export function WheelLoaderScene({ className, title = "Illustration of a wheel loader on a work site" }: ArtProps) {
  return (
    <Frame vb="0 0 640 400" className={className} title={title}>
      <SiteBackdrop w={640} h={400} ground={318} />
      <ellipse cx="330" cy="352" rx="290" ry="14" fill="#5E4A2E" opacity=".35" />
      <LoaderBody />
      <Wheel cx={225} cy={288} r={62} />
      <Wheel cx={478} cy={288} r={62} />
    </Frame>
  );
}

/** Hydraulic excavator, side view. */
export function ExcavatorScene({ className, title = "Illustration of a tracked excavator" }: ArtProps) {
  return (
    <Frame vb="0 0 640 400" className={className} title={title}>
      <SiteBackdrop w={640} h={400} ground={320} />
      <ellipse cx="350" cy="350" rx="230" ry="12" fill="#5E4A2E" opacity=".35" />
      {/* tracks */}
      <rect x="200" y="282" width="300" height="58" rx="29" fill={K} />
      <rect x="212" y="292" width="276" height="38" rx="19" fill="#2B2B2B" />
      {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={236 + i * 46} cy={311} r={12} fill={ST} />)}
      {/* upper structure */}
      <path d="M232 214 h258 q14 0 14 14 v56 h-272z" fill={Y} />
      <path d="M404 206 h100 q16 0 16 16 v62 h-116z" fill={YS} />
      <rect x="232" y="214" width="272" height="10" fill={YL} opacity=".5" />
      {/* cab */}
      <path d="M236 142 h70 q8 0 8 8 v64 h-86 v-56 q0 -16 8 -16z" fill={Y} />
      <path d="M242 152 h60 v56 h-66 v-48z" fill={GL} />
      <path d="M250 156 h14 l-22 50 h-4z" fill={GLH} opacity=".45" />
      {/* boom */}
      <path d="M318 226 L300 196 L178 80 L152 96 L286 232z" fill={Y} />
      <path d="M300 196 L178 80 L170 86 L292 202z" fill={YL} opacity=".5" />
      <path d="M318 246 L214 146" stroke={STL} strokeWidth="10" strokeLinecap="round" />
      {/* arm */}
      <path d="M168 84 L150 100 L96 236 L116 244z" fill={Y} />
      <path d="M190 104 L128 190" stroke={STL} strokeWidth="8" strokeLinecap="round" />
      {/* bucket */}
      <path d="M92 226 Q 60 238 62 282 L128 286 Q 128 250 118 236z" fill={Y} />
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M${66 + i * 16} 284 l6 12 l6 -12z`} fill={STL} />)}
      <circle cx="165" cy="92" r="8" fill={K} />
      <circle cx="106" cy="238" r="7" fill={K} />
    </Frame>
  );
}

/** Three-axle tipper truck. */
export function TipperScene({ className, title = "Illustration of a tipper truck" }: ArtProps) {
  return (
    <Frame vb="0 0 640 400" className={className} title={title}>
      <SiteBackdrop w={640} h={400} ground={322} />
      <ellipse cx="330" cy="352" rx="270" ry="12" fill="#5E4A2E" opacity=".35" />
      <rect x="80" y="262" width="490" height="22" rx="6" fill={K} />
      {/* cab */}
      <path d="M78 150 h110 v118 h-126 v-80 q0 -38 16 -38z" fill="#E9E9E6" />
      <path d="M86 162 h70 v52 h-86 v-14 q0 -38 16 -38z" fill={GL} />
      <path d="M96 166 h14 l-22 44 h-6z" fill={GLH} opacity=".45" />
      <rect x="62" y="236" width="126" height="10" fill="#C9C9C4" />
      <rect x="54" y="248" width="30" height="20" rx="4" fill={K} />
      {/* dump body */}
      <path d="M198 132 h372 l-18 128 h-336z" fill={Y} />
      <path d="M198 132 h372 l-2 16 h-368z" fill={YL} opacity=".6" />
      {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={236 + i * 54} y={150} width="8" height="104" fill={YS} />)}
      <Wheel cx={138} cy={296} r={40} />
      <Wheel cx={410} cy={296} r={40} />
      <Wheel cx={504} cy={296} r={40} />
    </Frame>
  );
}

/** Truck-mounted concrete mixer. */
export function MixerScene({ className, title = "Illustration of a transit mixer truck" }: ArtProps) {
  return (
    <Frame vb="0 0 640 400" className={className} title={title}>
      <SiteBackdrop w={640} h={400} ground={322} />
      <ellipse cx="330" cy="352" rx="270" ry="12" fill="#5E4A2E" opacity=".35" />
      <rect x="80" y="262" width="490" height="22" rx="6" fill={K} />
      <path d="M78 150 h110 v118 h-126 v-80 q0 -38 16 -38z" fill="#E9E9E6" />
      <path d="M86 162 h70 v52 h-86 v-14 q0 -38 16 -38z" fill={GL} />
      <rect x="54" y="248" width="30" height="20" rx="4" fill={K} />
      <g transform="rotate(-10 390 190)">
        <ellipse cx="390" cy="190" rx="170" ry="72" fill={Y} />
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${270 + i * 70} 128 q 30 60 -6 124`} stroke={YS} strokeWidth="14" fill="none" />
        ))}
        <ellipse cx="390" cy="160" rx="150" ry="28" fill={YL} opacity=".35" />
      </g>
      <path d="M548 190 l40 -8 l6 26 l-40 10z" fill={ST} />
      <Wheel cx={138} cy={296} r={40} />
      <Wheel cx={410} cy={296} r={40} />
      <Wheel cx={504} cy={296} r={40} />
    </Frame>
  );
}

/** Close-up of a single tyre for thumbnails. */
export function TyreCloseup({ className, title = "Illustration of an earthmover tyre" }: ArtProps) {
  return (
    <Frame vb="0 0 200 200" className={className} title={title}>
      <rect width="200" height="200" fill="#D9CDB4" />
      <Wheel cx={100} cy={104} r={86} />
    </Frame>
  );
}

/** Cab-side detail for thumbnails. */
export function CabDetail({ className, title = "Illustration of a loader cab" }: ArtProps) {
  return (
    <Frame vb="300 70 200 200" className={className} title={title}>
      <SiteBackdrop w={640} h={400} ground={318} />
      <LoaderBody />
      <Wheel cx={478} cy={288} r={62} />
    </Frame>
  );
}

/** Bucket and teeth detail for thumbnails. */
export function BucketDetail({ className, title = "Illustration of a loader bucket" }: ArtProps) {
  return (
    <Frame vb="20 130 200 200" className={className} title={title}>
      <SiteBackdrop w={640} h={400} ground={318} />
      <LoaderBody />
      <Wheel cx={225} cy={288} r={62} />
    </Frame>
  );
}
