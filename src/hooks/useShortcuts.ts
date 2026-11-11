import { useEffect, useRef } from "react";

export type ShortcutHandlers = {
  togglePlay: () => void;
  seekBy: (delta: number) => void;
  volumeBy: (delta: number) => void;
  next: () => void;
  prev: () => void;
  toggleMute: () => void;
};

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range";
}

/** 滑杆自己处理方向键（音量条、进度条）。 */
function isSlider(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.getAttribute("role") === "slider" || (target as HTMLInputElement).type === "range";
}

/** 全局键盘快捷键。handlers 每次渲染都可以是新函数，这里只注册一次监听。 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const h = ref.current;
      const arrow = e.code.startsWith("Arrow");
      if (arrow && isSlider(e.target)) return;

      if (e.code === "Space") {
        // 菜单项照常用空格激活；其余地方空格都是播放 / 暂停（包括焦点停在歌曲行上时）
        if ((e.target as HTMLElement | null)?.getAttribute?.("role") === "menuitem") return;
        e.preventDefault();
        h.togglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        h.seekBy(e.shiftKey ? 30 : 10);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        h.seekBy(e.shiftKey ? -30 : -10);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        h.volumeBy(0.05);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        h.volumeBy(-0.05);
      } else if (e.key === "n" || e.key === "N") {
        h.next();
      } else if (e.key === "p" || e.key === "P") {
        h.prev();
      } else if (e.key === "m" || e.key === "M") {
        h.toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
