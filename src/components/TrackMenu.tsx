import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Playlist, Track } from "../types";

export type MenuState = {
  track: Track;
  x: number;
  y: number;
  /** 在歌单视图里打开时，提供"从歌单移除"。 */
  playlistId?: string;
  /** 在"即将播放"的手动队列项上打开时，提供"从队列移除"。 */
  queued?: boolean;
};

export type MenuActions = {
  play: (track: Track) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  toggleLike: (track: Track) => void;
  dislike: (track: Track) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
  createPlaylistWith: (name: string, track: Track) => void;
  removeFromPlaylist: (playlistId: string, track: Track) => void;
  removeFromQueue: (track: Track) => void;
  goArtist: (track: Track) => void;
  goAlbum: (track: Track) => void;
};

type Props = {
  menu: MenuState;
  playlists: Playlist[];
  liked: boolean;
  actions: MenuActions;
  onClose: () => void;
};

/** 歌曲右键菜单。键盘上可用菜单键或 Shift+F10 打开，方向键移动，Esc 关闭。 */
export function TrackMenu({ menu, playlists, liked, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const { track } = menu;

  // 贴着鼠标打开，但不超出窗口
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [menu.x, menu.y, naming]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  return (
    <div
      className="track-menu"
      ref={ref}
      role="menu"
      aria-label={`${track.title} 的操作`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="menu-title">{track.title}</p>
      <button role="menuitem" type="button" onClick={run(() => actions.play(track))}>
        播放
      </button>
      <button role="menuitem" type="button" onClick={run(() => actions.playNext(track))}>
        下一首播放
      </button>
      <button role="menuitem" type="button" onClick={run(() => actions.addToQueue(track))}>
        加入队列
      </button>
      {menu.queued ? (
        <button role="menuitem" type="button" onClick={run(() => actions.removeFromQueue(track))}>
          从队列移除
        </button>
      ) : null}
      <hr />
      <button role="menuitem" type="button" onClick={run(() => actions.toggleLike(track))}>
        {liked ? "取消喜欢" : "喜欢"}
      </button>
      <button role="menuitem" type="button" onClick={run(() => actions.dislike(track))}>
        不喜欢，少推荐这类
      </button>
      <hr />
      <button role="menuitem" type="button" onClick={run(() => actions.goArtist(track))}>
        查看歌手
        <small>{track.artist}</small>
      </button>
      <button role="menuitem" type="button" onClick={run(() => actions.goAlbum(track))}>
        查看专辑
        <small>{track.album}</small>
      </button>
      <hr />
      <p className="menu-label">添加到歌单</p>
      {playlists.map((p) => (
        <button
          key={p.id}
          role="menuitem"
          type="button"
          disabled={p.trackIds.includes(track.id)}
          onClick={run(() => actions.addToPlaylist(p.id, track))}
        >
          {p.name}
          {p.trackIds.includes(track.id) ? <small>已添加</small> : null}
        </button>
      ))}
      {naming ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            actions.createPlaylistWith(name.trim(), track);
            onClose();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="歌单名称"
            aria-label="新歌单名称"
            onChange={(e) => setName(e.target.value)}
          />
        </form>
      ) : (
        <button role="menuitem" type="button" onClick={() => setNaming(true)}>
          + 新建歌单…
        </button>
      )}
      {menu.playlistId ? (
        <>
          <hr />
          <button
            role="menuitem"
            type="button"
            onClick={run(() => actions.removeFromPlaylist(menu.playlistId!, track))}
          >
            从这个歌单移除
          </button>
        </>
      ) : null}
    </div>
  );
}
