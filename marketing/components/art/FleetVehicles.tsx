/**
 * Side-view illustrations of the asset classes Tyre Pulse tracks. Drawn here, so
 * no third-party badges or logos. All face left, the way the strip moves, and
 * their wheels (and the mixer drum) turn with it. Decorative: the text label next
 * to each one is the accessible name.
 */

const S = { fill: "#fff", stroke: "#161616", strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const GLASS = "#dbe7ee";
const BRAND = "#FFC629";

function Wheel({ x, y = 64, r = 7 }: { x: number; y?: number; r?: number }) {
  return (
    <g className="fv-wheel" style={{ transformOrigin: `${x}px ${y}px` }}>
      <circle cx={x} cy={y} r={r} fill="#161616" />
      <circle cx={x} cy={y} r={r * 0.48} fill="#cfcdc4" />
      <path d={`M${x - r * 0.48} ${y}H${x + r * 0.48}M${x} ${y - r * 0.48}V${y + r * 0.48}`} stroke="#161616" strokeWidth="1.2" />
    </g>
  );
}

function Cab({ x, w = 26, h = 30, base = 58 }: { x: number; w?: number; h?: number; base?: number }) {
  return (
    <g>
      <path {...S} d={`M${x + w} ${base}V${base - h}H${x + 8}L${x} ${base - h + 12}V${base}Z`} />
      <path d={`M${x + 4} ${base - h + 12}L${x + 9} ${base - h + 4}H${x + w - 5}V${base - h + 12}Z`} fill={GLASS} stroke="#161616" strokeWidth="1.2" />
    </g>
  );
}

const Ground = () => <path d="M2 72H158" stroke="#d6d3c8" strokeWidth="1.4" />;

function Mixer() {
  return (
    <>
      <Ground />
      <path {...S} d="M10 58H150V64H10Z" />
      <Cab x={10} />
      <ellipse cx="98" cy="38" rx="44" ry="18" {...S} />
      <path className="fv-drum" d="M66 28C78 42 92 50 112 52M78 22C92 36 108 46 132 46" stroke={BRAND} strokeWidth="3" fill="none" strokeDasharray="10 6" />
      <path {...S} d="M140 34L152 30V44Z" />
      <Wheel x={24} /><Wheel x={104} /><Wheel x={124} />
    </>
  );
}

function Pump() {
  return (
    <>
      <Ground />
      <path {...S} d="M10 58H150V64H10Z" />
      <Cab x={10} />
      <path {...S} d="M40 50H146V58H40Z" />
      <path d="M58 46L104 18L150 22" stroke={BRAND} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 46L104 18L150 22" stroke="#161616" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <circle cx="58" cy="46" r="4" {...S} />
      <Wheel x={24} /><Wheel x={92} /><Wheel x={112} /><Wheel x={132} />
    </>
  );
}

function Boom() {
  return (
    <>
      <Ground />
      <path {...S} d="M60 72L80 58L100 72M80 58V46" />
      <path d="M80 46L56 16L118 10L132 30" stroke={BRAND} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M80 46L56 16L118 10L132 30" stroke="#161616" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <rect x="72" y="40" width="16" height="10" rx="2" {...S} />
      <path d="M132 30V44" stroke="#161616" strokeWidth="1.6" />
    </>
  );
}

function WheelLoader() {
  return (
    <>
      <Ground />
      <path {...S} fill={BRAND} d="M44 58V40H118L128 50V58Z" />
      <path {...S} d="M70 40V14H100L104 40Z" />
      <path d="M74 18H98L100 36H74Z" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      <path {...S} d="M44 46L24 40M44 54L22 56" />
      <path {...S} d="M8 44L24 38L28 62H6Z" />
      <Wheel x={56} y={60} r={12} /><Wheel x={112} y={60} r={12} />
    </>
  );
}

function SkidLoader() {
  return (
    <>
      <Ground />
      <path {...S} fill={BRAND} d="M58 60V36H108V60Z" />
      <path {...S} d="M66 36V16H100V36Z" />
      <path d="M70 20H96V34H70Z" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      <path {...S} d="M58 44L36 50" />
      <path {...S} d="M22 48L38 44L40 64H20Z" />
      <Wheel x={70} y={64} r={8} /><Wheel x={98} y={64} r={8} />
    </>
  );
}

function Backhoe() {
  return (
    <>
      <Ground />
      <path {...S} fill={BRAND} d="M36 58V40H112V58Z" />
      <path {...S} d="M66 40V16H96V40Z" />
      <path d="M70 20H92V36H70Z" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      <path {...S} d="M8 46L22 40L26 60H6Z" />
      <path {...S} d="M36 48L22 46" />
      <path d="M112 44L136 18L150 40" stroke="#161616" strokeWidth="3" fill="none" strokeLinejoin="round" />
      <path {...S} d="M146 38L154 44L148 52Z" />
      <Wheel x={48} y={60} r={9} /><Wheel x={100} y={58} r={13} />
    </>
  );
}

function Generator() {
  return (
    <>
      <Ground />
      <path {...S} d="M24 62V24H136V62Z" />
      <path d="M24 24H136" stroke={BRAND} strokeWidth="5" />
      <path d="M36 34V52M44 34V52M52 34V52M60 34V52" stroke="#161616" strokeWidth="1.2" />
      <rect x="96" y="32" width="28" height="18" rx="2" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      <path {...S} d="M30 62V70M130 62V70" />
    </>
  );
}

function Plant() {
  return (
    <>
      <Ground />
      <path {...S} d="M30 34Q30 18 42 18Q54 18 54 34V52H30Z" />
      <path {...S} d="M64 34Q64 18 76 18Q88 18 88 34V52H64Z" />
      <path d="M30 30H54M64 30H88" stroke={BRAND} strokeWidth="4" />
      <path {...S} d="M24 52H120V60H24ZM34 60V72M84 60V72M116 60V72" />
      <path {...S} d="M96 52L132 26L146 30L110 56" />
    </>
  );
}

function Pickup() {
  return (
    <>
      <Ground />
      <path {...S} d="M14 58V44L30 42L44 28H82V44H146V58Z" />
      <path d="M36 42L46 31H62V42ZM66 31H80V42H66Z" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      <path d="M14 50H146" stroke={BRAND} strokeWidth="2" />
      <Wheel x={36} y={60} r={9} /><Wheel x={122} y={60} r={9} />
    </>
  );
}

function Bus() {
  return (
    <>
      <Ground />
      <path {...S} d="M10 60V22Q10 16 18 16H148V60Z" />
      <path d="M12 22H24V44H12Z" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      {[34, 56, 78, 100, 122].map((x) => <rect key={x} x={x} y="22" width="18" height="14" rx="1.5" fill={GLASS} stroke="#161616" strokeWidth="1.2" />)}
      <path d="M10 48H148" stroke={BRAND} strokeWidth="3" />
      <Wheel x={32} y={62} r={8} /><Wheel x={126} y={62} r={8} />
    </>
  );
}

function Trailer() {
  return (
    <>
      <Ground />
      <path {...S} d="M8 60V30H34L42 46V60Z" />
      <path d="M12 34H30L36 46H12Z" fill={GLASS} stroke="#161616" strokeWidth="1.2" />
      <path {...S} d="M44 50H152V58H44Z" />
      <path d="M44 50H152" stroke={BRAND} strokeWidth="3" />
      <Wheel x={22} /><Wheel x={118} /><Wheel x={134} />
    </>
  );
}

function Forklift() {
  return (
    <>
      <Ground />
      <path {...S} fill={BRAND} d="M60 60V38H120V60Z" />
      <path {...S} fill="none" d="M68 38V14H108V38" />
      <path {...S} d="M48 66V10M54 66V10" />
      <path {...S} d="M24 56H50V60H24Z" />
      <rect x="100" y="42" width="22" height="16" {...S} />
      <Wheel x={70} y={62} r={8} /><Wheel x={112} y={62} r={8} />
    </>
  );
}

export const FLEET = [
  { name: "Transit mixers", Art: Mixer },
  { name: "Concrete pumps", Art: Pump },
  { name: "Placing booms", Art: Boom },
  { name: "Wheel loaders", Art: WheelLoader },
  { name: "Skid loaders", Art: SkidLoader },
  { name: "Backhoes", Art: Backhoe },
  { name: "Generators", Art: Generator },
  { name: "Batching plants", Art: Plant },
  { name: "Pickups", Art: Pickup },
  { name: "Staff buses", Art: Bus },
  { name: "Trailers", Art: Trailer },
  { name: "Forklifts", Art: Forklift },
] as const;

export function FleetVehicle({ Art }: { Art: () => React.ReactElement }) {
  return (
    <svg className="fv" viewBox="0 0 160 76" width="132" height="63" aria-hidden="true" focusable="false">
      <Art />
    </svg>
  );
}
