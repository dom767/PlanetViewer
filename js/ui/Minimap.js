/**
 * Top-left plan-view minimap (X–Y projection, Z up).
 * Auto-zooms so the camera stays inside the middle 75% of the view.
 */
export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.rangePc = 50; // half-extent of view in parsecs
    this.minRangePc = 12;
    this.maxRangePc = 2500;
    /** Fraction of half-extent the camera may occupy (middle 75% ⇒ 0.75). */
    this.cameraFrame = 0.75;
    this.onJump = null;
    this._systems = [];
    this._camera = null;

    canvas.addEventListener("click", (e) => {
      if (!this.onJump) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const world = this.screenToWorld(x, y);
      this.onJump(world);
    });
  }

  setSystems(systems) {
    this._systems = systems;
  }

  /**
   * Auto-fit range to encompass most stars (percentile); also sets a soft floor.
   */
  fitToCatalog(systems) {
    const dists = systems
      .map((s) => Math.max(Math.abs(s.x), Math.abs(s.y)))
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (!dists.length) return;
    const idx = Math.floor(dists.length * 0.85);
    const fitted = Math.max(20, Math.min(800, dists[idx] * 1.15));
    this.rangePc = fitted;
    this.minRangePc = Math.min(12, fitted * 0.15);
  }

  /**
   * Adjust range so the camera lies within the middle 75% of the square plan view.
   */
  updateZoom(camera) {
    if (!camera) return;
    const camSpan = Math.max(Math.abs(camera.position.x), Math.abs(camera.position.y));
    // Half-extent needed so camSpan sits on the 75% boundary
    const needed = Math.max(this.minRangePc, camSpan / this.cameraFrame);
    const target = Math.min(this.maxRangePc, needed);

    // Zoom out immediately when outside the frame; ease in when zooming in
    if (target > this.rangePc) {
      this.rangePc = target;
    } else {
      const follow = 0.08;
      this.rangePc += (target - this.rangePc) * follow;
      if (this.rangePc < this.minRangePc) this.rangePc = this.minRangePc;
    }
  }

  screenToWorld(sx, sy) {
    const { width, height } = this.canvas;
    const size = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const x = ((sx - cx) / (size / 2)) * this.rangePc;
    const y = -((sy - cy) / (size / 2)) * this.rangePc;
    return { x, y, z: this._camera?.position?.z ?? 0 };
  }

  draw(camera) {
    this._camera = camera;
    this.updateZoom(camera);

    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const cx = width / 2;
    const cy = height / 2;
    const size = Math.min(width, height);
    const scale = size / 2 / this.rangePc;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(4, 8, 16, 0.2)";
    ctx.fillRect(0, 0, width, height);

    // Middle 75% guide
    const framePx = size * 0.5 * this.cameraFrame;
    ctx.strokeStyle = "rgba(110, 182, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - framePx, cy - framePx, framePx * 2, framePx * 2);

    // Grid
    ctx.strokeStyle = "rgba(100, 130, 180, 0.15)";
    ctx.lineWidth = 1;
    const step = niceStep(this.rangePc);
    for (let v = -this.rangePc; v <= this.rangePc; v += step) {
      const px = cx + v * scale;
      const py = cy - v * scale;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }

    // Stars
    for (const s of this._systems) {
      const px = cx + s.x * scale;
      const py = cy - s.y * scale;
      if (px < -2 || py < -2 || px > width + 2 || py > height + 2) continue;
      const [r, g, b] = s.color;
      ctx.fillStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},0.85)`;
      ctx.beginPath();
      ctx.arc(px, py, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sol
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Camera
    if (camera) {
      const px = cx + camera.position.x * scale;
      const py = cy - camera.position.y * scale;
      const f = camera.forward();
      ctx.strokeStyle = "rgba(110, 182, 255, 0.95)";
      ctx.fillStyle = "rgba(110, 182, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + f.x * 14, py - f.y * 14);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(138, 155, 181, 0.9)";
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.fillText(`±${Math.round(this.rangePc)} pc`, 8, 14);
  }
}

function niceStep(range) {
  const raw = range / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const n = raw / pow;
  if (n < 2) return 2 * pow;
  if (n < 5) return 5 * pow;
  return 10 * pow;
}
