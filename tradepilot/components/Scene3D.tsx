// Pure markup + CSS (see app/scene.css). No JavaScript, so it can't cause hydration jitter.
const CANDLES: { h: number; y: number; k: "up" | "down" | "accent" }[] = [
  { h: 70, y: -20, k: "up" }, { h: 110, y: -70, k: "down" }, { h: 60, y: -10, k: "up" }, { h: 130, y: -90, k: "up" },
  { h: 90, y: -30, k: "accent" }, { h: 120, y: -60, k: "down" }, { h: 75, y: -40, k: "up" }, { h: 140, y: -100, k: "up" },
  { h: 85, y: 0, k: "down" }, { h: 100, y: -50, k: "up" }, { h: 65, y: -15, k: "accent" }, { h: 125, y: -80, k: "down" },
];
const COLOR = { up: "rgb(var(--em-500))", down: "rgb(var(--red-400))", accent: "rgb(var(--accent))" };

export default function Scene3D() {
  const n = CANDLES.length;
  return (
    <div className="scene" aria-hidden="true">
      <div className="floor" />
      <div className="floor f2" />
      <div className="scene-bob">
        <div className="ring">
          {CANDLES.map((c, i) => (
            <div key={i} className="candle" style={{ ["--a" as string]: `${(i * 360) / n}deg` }}>
              <i className="plane" style={{ ["--h" as string]: `${c.h}px`, ["--y" as string]: `${c.y}px`, ["--c" as string]: COLOR[c.k] }} />
              <i className="plane p2" style={{ ["--h" as string]: `${c.h}px`, ["--y" as string]: `${c.y}px`, ["--c" as string]: COLOR[c.k] }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
