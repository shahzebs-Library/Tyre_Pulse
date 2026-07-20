export function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return <div style={{ maxWidth: 780, marginBottom: 34 }}><span className="eyebrow">{eyebrow}</span><h2 className="h2">{title}</h2>{text && <p className="lead">{text}</p>}</div>;
}
