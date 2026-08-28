import { CoverArt } from "./CoverArt";
import { IconSpark } from "./Icons";
import type { ViewFilter } from "../types";

type ArtistRow = { name: string; count: number };

type Props = {
  artists: ArtistRow[];
  albums: { album: string; artist: string; count: number }[];
  filter: ViewFilter;
  onFilter: (filter: ViewFilter) => void;
  musicDir: string;
};

export function Sidebar({ artists, albums, filter, onFilter, musicDir }: Props) {
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
        {musicDir.replace(/\/Users\/[^/]+/, "~")}
      </p>
    </aside>
  );
}
