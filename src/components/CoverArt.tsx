import { memo, useState } from "react";
import { coverPalette, initials } from "../cover";

type Props = {
  seed: string;
  label?: string;
  spinning?: boolean;
  size?: "sm" | "md" | "lg";
  /** 真实封面图；加载失败时退回生成的渐变唱片。 */
  src?: string | null;
};

export const CoverArt = memo(function CoverArt({ seed, label, spinning = false, size = "md", src }: Props) {
  const palette = coverPalette(seed);
  const text = initials(label || seed);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  return (
    <div
      className={`cover cover-${size} ${spinning ? "is-spinning" : ""}`}
      style={{
        background: `radial-gradient(circle at 32% 28%, ${palette.c} 0%, transparent 42%),
          linear-gradient(145deg, ${palette.b}, ${palette.a})`,
      }}
      aria-hidden
    >
      {showImage ? (
        <img
          className="cover-img"
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src!)}
        />
      ) : (
        <span className="cover-initials">{text}</span>
      )}
      <span className="cover-ring" />
      <span className="cover-hole" />
    </div>
  );
});
