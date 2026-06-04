/* ── "Done" celebration burst ───────────────────────────────────────────────
 *
 * A fire-and-forget shower of little sketchy marks flung out from a point.
 * Built imperatively on <body> so its lifetime is independent of the React
 * component that triggered it (the sidebar row unmounts as it collapses, which
 * would otherwise cut the animation short). Self-removes when done.
 *
 * Styling + keyframes live in styles/sidebar.css (.done-burst*).
 */

interface Spark {
  readonly angle: number;
  readonly distance: number;
  readonly glyph: "sparkle" | "star" | "line";
}

const SPARKS: readonly Spark[] = [
  { angle: -90, distance: 26, glyph: "sparkle" },
  { angle: -40, distance: 30, glyph: "line" },
  { angle: 10, distance: 24, glyph: "star" },
  { angle: 55, distance: 30, glyph: "line" },
  { angle: 120, distance: 22, glyph: "sparkle" },
  { angle: 165, distance: 28, glyph: "line" },
  { angle: 210, distance: 24, glyph: "star" },
  { angle: -150, distance: 30, glyph: "line" },
];

const GLYPH_SVG: Record<Spark["glyph"], string> = {
  star: '<svg viewBox="0 0 12 12"><path d="M6 1.4 7 5 10.6 6 7 7 6 10.6 5 7 1.4 6 5 5Z"/></svg>',
  sparkle: '<svg viewBox="0 0 12 12"><path d="M6 1.2 6.7 5.3 10.8 6 6.7 6.7 6 10.8 5.3 6.7 1.2 6 5.3 5.3Z"/></svg>',
  line: '<svg viewBox="0 0 12 12"><path d="M2.4 6h7.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
};

export function fireDoneCelebration(x: number, y: number): void {
  if (typeof document === "undefined") return;

  const container = document.createElement("div");
  container.className = "done-burst";
  container.style.left = `${x}px`;
  container.style.top = `${y}px`;
  container.setAttribute("aria-hidden", "true");

  const ring = document.createElement("span");
  ring.className = "done-burst__ring";
  container.appendChild(ring);

  SPARKS.forEach((spark, index) => {
    const radians = (spark.angle * Math.PI) / 180;
    const dx = Math.cos(radians) * spark.distance;
    const dy = Math.sin(radians) * spark.distance;
    const node = document.createElement("span");
    node.className = "done-burst__spark";
    node.style.setProperty("--spark-dx", `${dx.toFixed(1)}px`);
    node.style.setProperty("--spark-dy", `${dy.toFixed(1)}px`);
    node.style.setProperty("--spark-rot", `${spark.angle + 90}deg`);
    node.style.setProperty("--spark-delay", `${index * 12}ms`);
    node.innerHTML = GLYPH_SVG[spark.glyph];
    container.appendChild(node);
  });

  document.body.appendChild(container);
  window.setTimeout(() => container.remove(), 750);
}
