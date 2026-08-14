import { createGPU, resizeGPU } from "./render/gpu.js";
import { Scene } from "./render/Scene.js";
import { FlyCamera } from "./camera/FlyCamera.js";
import { Catalog } from "./catalog/Catalog.js";
import { buildFieldStars, FIELD_STAR_RADIUS_PC } from "./catalog/FieldStars.js";
import { loadExoplanetCatalog, loadNearbyStars } from "./data/loader.js";
import { InfoPanel } from "./ui/InfoPanel.js";
import { Minimap } from "./ui/Minimap.js";
import { Hud } from "./ui/Hud.js";
import { SystemSearch } from "./ui/SystemSearch.js";
import { AppChrome } from "./ui/AppChrome.js";
import { CanvasSizeSettings } from "./ui/CanvasSizeSettings.js";
import { FOCUS_ORBIT_RADIUS_PC } from "./render/PlanetPass.js";
import { length3, projectToNdc, ndcToScreen } from "./astro/coords.js";

function appVersionLabel() {
  const build = globalThis.__PLANETVIEWER_ASSET_VERSION__;
  if (build != null) return `Version ${build}`;
  const meta = document.querySelector('meta[name="app-version"]');
  return meta?.content ? `Version ${meta.content}` : "Version dev";
}

async function main() {
  const appRoot = document.getElementById("app");
  const canvas = document.getElementById("gl-canvas");
  const loading = document.getElementById("loading");
  const hoverLabel = document.getElementById("star-hover-label");
  const versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = appVersionLabel();

  let gpu;
  try {
    loading.textContent = "Initialising WebGPU…";
    gpu = await createGPU(canvas);
  } catch (err) {
    console.error(err);
    loading.textContent = `WebGPU unavailable: ${err.message}. Try Chrome/Edge 113+ over http://localhost.`;
    return;
  }

  const scene = new Scene(gpu);
  const camera = new FlyCamera();
  camera.attach(canvas);
  camera.resolveOrbitTarget = () => focused || scene.hoverTarget;

  const catalog = new Catalog();
  const panel = new InfoPanel(
    document.getElementById("info-panel"),
    document.getElementById("panel-content"),
    document.getElementById("panel-close")
  );
  const minimap = new Minimap(document.getElementById("minimap"));
  const hud = new Hud({
    selection: document.getElementById("hud-selection"),
    distance: document.getElementById("hud-distance"),
    note: document.getElementById("hud-note"),
    noteBlock: document.getElementById("hud-note-block"),
    noteNext: document.getElementById("hud-note-next"),
    timeSpeed: document.getElementById("time-speed"),
    simClock: document.getElementById("hud-sim-clock"),
    exposure: document.getElementById("exposure"),
    exposureValue: document.getElementById("exposure-value"),
  });
  hud.onExposureChange = (v) => scene.setExposure(v);
  scene.setExposure(hud.exposure);

  function goNextNotable() {
    const next = catalog.nextNotable(focused);
    if (next) selectSystem(next, { openInfo: !!chrome?.isWide });
  }
  hud.onNextNotable = goNextNotable;

  const canvasSize = new CanvasSizeSettings({
    canvas,
    widthInput: document.getElementById("canvas-width"),
    heightInput: document.getElementById("canvas-height"),
    applyBtn: document.getElementById("canvas-size-apply"),
    hintEl: document.getElementById("canvas-size-hint"),
  });
  canvasSize.init();

  let focused = null;
  /** @type {{ system: object, normName: string }[]} */
  let systemSearchIndex = [];
  let viewProj = new Float32Array(16);
  let pointerCss = null;
  const PICK_RADIUS_CSS = 22;

  /** @type {AppChrome | null} */
  let chrome = null;
  /** @type {SystemSearch | null} */
  let search = null;

  function pickAtCss(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return catalog.pickNearest(
      sx * scaleX,
      sy * scaleY,
      viewProj,
      canvas.width,
      canvas.height,
      PICK_RADIUS_CSS * Math.max(scaleX, scaleY)
    );
  }

  function updateHover() {
    if (!pointerCss || camera._dragging) {
      if (!camera._dragging) scene.setHoverTarget(null);
      canvas.style.cursor = camera._orbitDragging
        ? "grabbing"
        : camera._dragging
          ? "grabbing"
          : "crosshair";
      return;
    }
    const hit = pickAtCss(pointerCss.x, pointerCss.y);
    // Ignore the host you're already in — no cyan hover ring or name label.
    const hover =
      hit && focused && (hit === focused || hit.id === focused.id)
        ? null
        : hit;
    scene.setHoverTarget(hover);
    canvas.style.cursor = hover || focused ? "grab" : "crosshair";
  }

  /** Name tag beside the cyan hover ring (CSS px relative to #app / canvas). */
  function updateHoverLabel() {
    if (!hoverLabel) return;
    const hit = scene.hoverTarget;
    if (!hit || !pointerCss) {
      hoverLabel.classList.add("hidden");
      return;
    }
    const ndc = projectToNdc(hit, viewProj);
    if (!ndc || ndc.z < -1 || ndc.z > 1) {
      hoverLabel.classList.add("hidden");
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(rect.width, 1);
    const scaleY = canvas.height / Math.max(rect.height, 1);
    const scr = ndcToScreen(ndc, canvas.width, canvas.height);
    const clipW =
      viewProj[3] * hit.x +
      viewProj[7] * hit.y +
      viewProj[11] * hit.z +
      viewProj[15];
    const dist = Math.max(clipW, 0.05);
    const ringBuf = Math.min(
      96,
      Math.max(28, (48 * (canvas.width / 1280)) * (8 / dist))
    );
    const cssX = scr.x / scaleX;
    const cssY = scr.y / scaleY;
    const gap = ringBuf / scaleX * 0.55 + 10;
    const placeLeft = cssX + gap + 160 > rect.width;

    hoverLabel.textContent = hit.name;
    hoverLabel.classList.toggle("is-left", placeLeft);
    hoverLabel.style.left = `${placeLeft ? cssX - gap : cssX + gap}px`;
    hoverLabel.style.top = `${cssY}px`;
    hoverLabel.classList.remove("hidden");
  }

  function selectSystem(system, { openInfo = true } = {}) {
    const fromStar = focused;
    focused = system;
    const focusDist = system.isSol
      ? Math.max(FOCUS_ORBIT_RADIUS_PC * 2.6, 2.2)
      : Math.max(FOCUS_ORBIT_RADIUS_PC * 2.2, 1.5);
    camera.focusOn(system, focusDist, fromStar);
    scene.setFocusedSystem(system, camera.getOrbitBasis());
    hud.setSelection(system.name, system.distPc, true, system.note?.text);

    // On mobile, map taps focus only; Info opens via the nav tab (or when
    // already open, refresh contents for the newly focused system).
    const showInfo =
      openInfo || (chrome ? chrome.isInfoOpen() : panel.isOpen());
    if (showInfo) {
      if (chrome) chrome.openInfo(system);
      else panel.open(system);
    }
  }

  try {
    loading.textContent = "Loading catalog…";
    const raw = await loadExoplanetCatalog();
    catalog.load(raw);
    const starCount = catalog.systems.filter((s) => (s.planets?.length ?? 0) > 0).length;
    const planetCount = catalog.systems.reduce((n, s) => n + (s.planets?.length || 0), 0);
    document.getElementById("stat-stars").textContent = starCount.toLocaleString();
    document.getElementById("stat-planets").textContent = planetCount.toLocaleString();
    scene.uploadStars(catalog);
    minimap.setSystems(catalog.systems);
    minimap.fitToCatalog(catalog.systems);

    const normalizeName = (name) =>
      String(name).toUpperCase().replace(/\s+/g, "");
    systemSearchIndex = catalog.systems
      .filter((s) => s.isSol || (s.planets?.length ?? 0) > 0 || s.notable)
      .flatMap((s) => {
        const names = [s.name, ...(s.aliases || [])];
        return names.map((name) => ({ system: s, normName: normalizeName(name) }));
      });

    let fieldStars = [];
    try {
      loading.textContent = "Loading nearby stars…";
      const nearbyRaw = await loadNearbyStars();
      fieldStars = buildFieldStars(nearbyRaw, catalog, FIELD_STAR_RADIUS_PC);
      scene.uploadFieldStars(fieldStars);
      console.info(
        `Field stars within ${FIELD_STAR_RADIUS_PC} pc (no known planets): ${fieldStars.length}`
      );
    } catch (err) {
      console.warn("Nearby field stars unavailable:", err);
      document.getElementById("toggle-field-stars-wrap")?.classList.add("hidden");
    }

    const fieldToggle = document.getElementById("toggle-field-stars");
    const updateFieldStats = () => {
      const on = !!fieldToggle?.checked;
      scene.setShowFieldStars(on);
      if (on && fieldStars.length) {
        document.getElementById("stat-stars").textContent =
          `${starCount.toLocaleString()} hosts + ${fieldStars.length.toLocaleString()} nearby`;
      } else {
        document.getElementById("stat-stars").textContent = starCount.toLocaleString();
      }
    };
    fieldToggle?.addEventListener("change", updateFieldStats);
    updateFieldStats();

    search = new SystemSearch({
      input: document.getElementById("system-search-input"),
      results: document.getElementById("system-search-results"),
      index: systemSearchIndex,
      onSelect: (system) => {
        selectSystem(system, { openInfo: true });
        chrome?.onSystemSelected(true);
      },
      onEscape: () => chrome?.handleEscape(),
    });

    chrome = new AppChrome({
      appRoot,
      nav: document.getElementById("app-nav"),
      scrim: document.getElementById("chrome-scrim"),
      searchSheet: document.getElementById("search-sheet"),
      settingsSheet: document.getElementById("settings-sheet"),
      infoPanel: document.getElementById("info-panel"),
      infoPanelApi: panel,
      search,
      onHome: () => {
        if (catalog.sol) {
          selectSystem(catalog.sol, { openInfo: !!chrome?.isWide });
        }
      },
      getFocusedSystem: () => focused,
    });

    panel.onDismiss = () => chrome?.closeInfo();

    loading.classList.add("hidden");
    console.info(`Loaded ${starCount} host systems / ${planetCount} planets (WebGPU)`);
  } catch (err) {
    console.error(err);
    loading.textContent = `Failed to load catalog: ${err.message}`;
    return;
  }

  minimap.onJump = (world) => {
    camera.focusOn(world, 8, focused);
    if (camera.getOrbitBasis()) {
      scene.setFocusedSystem(focused, camera.getOrbitBasis());
    }
  };

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerCss = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  });
  canvas.addEventListener("pointerleave", () => {
    pointerCss = null;
    scene.setHoverTarget(null);
    hoverLabel?.classList.add("hidden");
  });

  canvas.addEventListener("click", (e) => {
    if (camera.didDrag()) {
      camera.consumeClickSuppress();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pickRadius =
      e.pointerType === "touch" || (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)
        ? PICK_RADIUS_CSS * 1.6
        : PICK_RADIUS_CSS;
    // Temporary override via scaled pick — pickAtCss uses fixed constant, so inline:
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pick = catalog.pickNearest(
      sx * scaleX,
      sy * scaleY,
      viewProj,
      canvas.width,
      canvas.height,
      pickRadius * Math.max(scaleX, scaleY)
    );
    if (pick) {
      // Desktop: open info with selection. Mobile: focus only (use Info tab).
      selectSystem(pick, { openInfo: !!chrome?.isWide });
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (chrome?.handleEscape()) return;
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (resizeGPU(canvas, gpu)) {
      scene.invalidateTrailHistory();
    }
    camera.update(dt);
    const tDays = hud.tick(dt);

    updateHover();

    viewProj = scene.drawFrame({
      viewMatrix: camera.viewMatrix(),
      width: canvas.width,
      height: canvas.height,
      tDays,
      dt,
      cameraPos: camera.position,
      orbitSettled: camera.shouldRevealOrbits(),
      revealOrbits: camera.shouldRevealOrbits(),
      focusHighlightOpacity: camera.focusHighlightOpacity(),
    });

    updateHoverLabel();

    minimap.draw(camera);

    if (!focused) {
      hud.setSelection("Free flight", length3(camera.position), false);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
