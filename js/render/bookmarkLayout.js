/** Shared screen-space bookmark layout — keep in sync with BOOKMARK_WGSL. */

const PX_MIN = 14;
const PX_MAX = 48;
const HALF_W = 1.14;
const HALF_H = 1.44;
const LIFT = 1.84;
/** Shader adds `px / resolution` to NDC (−1..1), so screen pixels are half that. */
const NDC_TO_PX = 0.5;
const HIT_PAD_PX = 8;

export function notableBookmarkSize(clipW, width) {
  const dist = Math.max(clipW, 0.05);
  return Math.min(40, Math.max(16, (24 * (width / 1280)) * (8 / dist)));
}

/**
 * Axis-aligned hitbox of the bookmark in buffer pixels (Y down).
 * @param {{x:number, y:number}} starScreen
 * @param {number} sizePx instance size passed to the bookmark shader
 */
export function notableBookmarkHitbox(starScreen, sizePx) {
  const px = Math.min(PX_MAX, Math.max(PX_MIN, sizePx));
  const halfW = px * HALF_W * NDC_TO_PX + HIT_PAD_PX;
  const halfH = px * HALF_H * NDC_TO_PX + HIT_PAD_PX;
  const lift = px * LIFT * NDC_TO_PX;
  return {
    x: starScreen.x,
    y: starScreen.y - lift,
    halfW,
    halfH,
  };
}

/** Distance to the bookmark rect; 0 if the click is inside. */
export function distanceToBookmark(screenX, screenY, box) {
  const dx = Math.max(0, Math.abs(screenX - box.x) - box.halfW);
  const dy = Math.max(0, Math.abs(screenY - box.y) - box.halfH);
  return Math.hypot(dx, dy);
}
