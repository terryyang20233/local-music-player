import { useEffect, useRef } from "react";

const BARS = 16;
const MIN_HEIGHT = 8;

type Props = {
  getAnalyser: () => AnalyserNode | null;
  playing: boolean;
};

/**
 * 频谱条。直接改 DOM 高度而不走 React state，避免整个界面每帧重渲染；
 * 暂停后衰减到底就停掉动画循环。
 */
export function Visualizer({ getAnalyser, playing }: Props) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const levelsRef = useRef<number[]>(Array(BARS).fill(0));

  useEffect(() => {
    let raf = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const levels = levelsRef.current;

    const tick = () => {
      const analyser = getAnalyser();
      let active = false;
      if (analyser && playing) {
        if (!data || data.length !== analyser.frequencyBinCount) {
          data = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(data);
        const slice = Math.max(1, Math.floor(data.length / BARS));
        for (let i = 0; i < BARS; i += 1) {
          let sum = 0;
          for (let j = 0; j < slice; j += 1) sum += data[i * slice + j] || 0;
          levels[i] = sum / slice / 255;
        }
        active = true;
      } else {
        for (let i = 0; i < BARS; i += 1) {
          levels[i] *= 0.86;
          if (levels[i] > 0.01) active = true;
          else levels[i] = 0;
        }
      }

      for (let i = 0; i < BARS; i += 1) {
        const bar = barsRef.current[i];
        if (bar) bar.style.height = `${Math.max(MIN_HEIGHT, levels[i] * 100)}%`;
      }
      if (active) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser, playing]);

  return (
    <div className="viz" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}
