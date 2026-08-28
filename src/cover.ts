export type CoverPalette = {
  a: string;
  b: string;
  c: string;
  hue: number;
};

export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coverPalette(seed: string): CoverPalette {
  const h = hashSeed(seed);
  const hue = h % 360;
  const hue2 = (hue + 28 + (h % 40)) % 360;
  return {
    hue,
    a: `hsl(${hue} 28% 18%)`,
    b: `hsl(${hue2} 36% 32%)`,
    c: `hsl(${(hue + 12) % 360} 48% 62%)`,
  };
}

export function initials(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "♪";
  const parts = cleaned.split(" ");
  if (parts.length >= 2 && /^[\x00-\x7F]+$/.test(cleaned)) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2);
}
