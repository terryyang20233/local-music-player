#!/usr/bin/env python3
"""Generate a vinyl-style PNG for the Changji macOS app icon."""
from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path


def write_png(path: Path, size: int, rgba_at) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(rgba_at(x, y, size))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def pixel(x: int, y: int, size: int) -> bytes:
    cx = cy = (size - 1) / 2
    r = math.hypot(x - cx, y - cy) / (size / 2)
    if r > 0.98:
        return b"\x00\x00\x00\x00"
    # outer gold ring
    if r > 0.90:
        return bytes((215, 165, 110, 255))
    # vinyl grooves
    groove = 0.55 + 0.12 * math.sin(r * 42)
    shade = int(18 + groove * 22)
    if r < 0.18:
        return bytes((12, 10, 8, 255))
    if r < 0.22:
        return bytes((240, 196, 138, 255))
    # highlight
    hx, hy = x - cx + size * 0.18, y - cy - size * 0.22
    highlight = max(0.0, 1.0 - math.hypot(hx, hy) / (size * 0.45))
    g = min(255, int(shade + highlight * 70))
    return bytes((g + 8, g, max(0, g - 6), 255))


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    write_png(out, 1024, pixel)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
