"use client";

/**
 * Cursor spotlight for a grid of cells: the cell under the pointer gets a soft
 * highlight that follows the cursor. One delegated listener on the wrapper sets
 * two CSS variables on the hovered cell; no React state, so no re-renders.
 * Touch and pen are ignored, and CSS hides the highlight under reduced motion.
 */
export function Spotlight({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="spotlight"
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".bento-cell");
        if (!cell) return;
        const r = cell.getBoundingClientRect();
        cell.style.setProperty("--mx", `${e.clientX - r.left}px`);
        cell.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
