import { coverPalette, initials } from "../cover";

type Props = {
  seed: string;
  label?: string;
  spinning?: boolean;
  size?: "sm" | "md" | "lg";
};

export function CoverArt({ seed, label, spinning = false, size = "md" }: Props) {
  const palette = coverPalette(seed);
  const text = initials(label || seed);
  return (
    <div
      className={`cover cover-${size} ${spinning ? "is-spinning" : ""}`}
      style={{
        background: `radial-gradient(circle at 32% 28%, ${palette.c} 0%, transparent 42%),
          linear-gradient(145deg, ${palette.b}, ${palette.a})`,
      }}
      aria-hidden
    >
      <span className="cover-ring" />
      <span className="cover-hole" />
      <span className="cover-initials">{text}</span>
    </div>
  );
}
