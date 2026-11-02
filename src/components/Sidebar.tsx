import { memo, useState } from "react";
import { CoverArt } from "./CoverArt";
import { IconChart, IconHeart, IconList, IconPlus, IconSpark } from "./Icons";
import type { Playlist, ViewFilter } from "../types";

type ArtistRow = { name: string; count: number };

type Props = {
  artists: ArtistRow[];
  albums: { album: string; artist: string; count: number }[];
  playlists: Playlist[];
  likedCount: number;
  filter: ViewFilter;
  onFilter: (filter: ViewFilter) => void;
  onCreatePlaylist: (name: string) => void;
  musicDir: string;
};

export const Sidebar = memo(function Sidebar({
  artists,
  albums,
  playlists,
  likedCount,
  filter,
  onFilter,
  onCreatePlaylist,
  musicDir,
}: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  return (
    <aside className="sidebar">
      <div className="side-block">
        <p className="side-label">浏览</p>
        <button
          className={`side-item ${filter.kind === "all" ? "is-active" : ""}`}
          onClick={() => onFilter({ kind: "all" })}
          type="button"
        >
          全部歌曲
        </button>
        <button
          className={`side-item ${filter.kind === "recommend" ? "is-active" : ""}`}
          onClick={() => onFilter({ kind: "recommend" })}
          type="button"
        >
          <IconSpark size={16} />
          为你推荐
        </button>
        <button
          className={`side-item ${filter.kind === "liked" ? "is-active" : ""}`}
          onClick={() => onFilter({ kind: "liked" })}
          type="button"
        >
          <IconHeart size={16} />
          我喜欢
          {likedCount ? <small className="side-count">{likedCount}</small> : null}
        </button>
        <button
          className={`side-item ${filter.kind === "stats" ? "is-active" : ""}`}
          onClick={() => onFilter({ kind: "stats" })}
          type="button"
        >
          <IconChart size={16} />
          听歌统计
        </button>
      </div>

      <div className="side-block">
        <div className="side-label-row">
          <p className="side-label">歌单</p>
          <button
            className="side-add"
            type="button"
            title="新建歌单"
            aria-label="新建歌单"
            onClick={() => setNaming(true)}
          >
            <IconPlus size={14} />
          </button>
        </div>
        {naming ? (
          <form
            className="side-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onCreatePlaylist(name.trim());
              setName("");
              setNaming(false);
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={60}
              placeholder="歌单名称，回车创建"
              aria-label="新歌单名称"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (!name.trim()) setNaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName("");
                  setNaming(false);
                }
              }}
            />
          </form>
        ) : null}
        {playlists.length === 0 && !naming ? (
          <p className="side-hint">右键歌曲可以加入歌单</p>
        ) : null}
        <div className="side-scroll playlist-scroll">
          {playlists.map((p) => (
            <button
              key={p.id}
              className={`side-item ${filter.kind === "playlist" && filter.id === p.id ? "is-active" : ""}`}
              onClick={() => onFilter({ kind: "playlist", id: p.id })}
              type="button"
            >
              <IconList size={16} />
              <span className="side-item-text">
                <span>{p.name}</span>
              </span>
              <small className="side-count">{p.trackIds.length}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="side-block">
        <p className="side-label">歌手</p>
        <div className="side-scroll">
          {artists.map((artist) => (
            <button
              key={artist.name}
              className={`side-item artist-item ${
                filter.kind === "artist" && filter.artist === artist.name ? "is-active" : ""
              }`}
              onClick={() => onFilter({ kind: "artist", artist: artist.name })}
              type="button"
            >
              <CoverArt seed={artist.name} label={artist.name} size="sm" />
              <span className="side-item-text">
                <span>{artist.name}</span>
                <small>{artist.count} 首</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="side-block albums-block">
        <p className="side-label">专辑</p>
        <div className="side-scroll">
          {albums.map((album) => (
            <button
              key={`${album.artist}-${album.album}`}
              className={`side-item ${
                filter.kind === "album" && filter.album === album.album && filter.artist === album.artist
                  ? "is-active"
                  : ""
              }`}
              onClick={() => onFilter({ kind: "album", album: album.album, artist: album.artist })}
              type="button"
            >
              <span className="side-item-text">
                <span>{album.album}</span>
                <small>{album.artist}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="side-path" title={musicDir}>
        {musicDir.replace(/^\/(?:Users|home)\/[^/]+/, "~")}
      </p>
    </aside>
  );
});
