"""Center-crop to square and resize to JPEG. Usage: python resize-square.py SRC DEST [SIZE]

Accepts any raster format Pillow can decode (JPEG, PNG, TIFF, WebP, BMP, ...).
"""
import sys
from PIL import Image

src, dest, size_s = sys.argv[1], sys.argv[2], sys.argv[3]
size = int(size_s)
im = Image.open(src).convert("RGB")
w, h = im.size
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
sq = im.crop((left, top, left + side, top + side))
out = sq.resize((size, size), Image.Resampling.LANCZOS)
out.save(dest, "JPEG", quality=88, optimize=True)
