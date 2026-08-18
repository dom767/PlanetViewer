/**
 * Shared image format checks and Commons download URL selection.
 * Probe/fetch pipelines normalize all accepted hits to JPEG via resize-square.py.
 */

/** Formats we never attempt to convert (animated/vector/doc). */
export const SKIP_IMAGE_EXT_RE = /\.(gif|svg|pdf|djvu)$/i;

/** Filename extensions Pillow can normally read and resize-square.py can convert. */
export const CONVERTIBLE_EXT_RE = /\.(jpe?g|png|webp|tiff?|bmp)$/i;

const CONVERTIBLE_MIME_RE =
  /^image\/(jpeg|png|webp|tiff|x-tiff|bmp|vnd\.microsoft\.icon|x-icon|x-portable-bitmap|x-portable-graymap|x-portable-pixmap)$/i;

export function isSkippedImageName(name) {
  return SKIP_IMAGE_EXT_RE.test(String(name || ""));
}

export function isConvertibleImage({ mime, fileTitle, filename } = {}) {
  const name = fileTitle || filename || "";
  if (!name || isSkippedImageName(name)) return false;
  const m = String(mime || "").toLowerCase();
  if (CONVERTIBLE_MIME_RE.test(m)) return true;
  return CONVERTIBLE_EXT_RE.test(name);
}

/** Pick a download URL suitable for JPEG conversion (JPEG thumb when needed). */
export function commonsDownloadUrl(info) {
  if (!info) return null;
  const mime = String(info.mime || "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/png") {
    return info.url || info.thumburl || null;
  }
  return info.thumburl || info.url || null;
}

export function stripImageExtension(name) {
  return String(name)
    .replace(/^File:/i, "")
    .replace(/\.[^.]+$/, "");
}

export function commonsSearchRank(title) {
  const t = String(title || "").toLowerCase();
  if (/\.jpe?g$/i.test(t)) return 0;
  if (/\.png$/i.test(t)) return 1;
  if (/\.webp$/i.test(t)) return 2;
  if (/\.tiff?$/i.test(t)) return 3;
  if (/\.bmp$/i.test(t)) return 4;
  return 9;
}
