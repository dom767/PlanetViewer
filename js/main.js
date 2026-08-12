import { createGPU, resizeGPU } from "./render/gpu.js";
import { Scene } from "./render/Scene.js";
import { FlyCamera } from "./camera/FlyCamera.js";
import { Catalog } from "./catalog/Catalog.js";
import { buildFieldStars, FIELD_STAR_RADIUS_PC } from "./catalog/FieldStars.js";
import { loadExoplanetCatalog, loadNearbyStars } from "./data/loader.js";
import { InfoPanel } from "./ui/InfoPanel.js";
import { Minimap } from "./ui/Minimap.js";
import { Hud } from "./ui/Hud.js";
import { FOCUS_ORBIT_RADIUS_PC } from "./render/PlanetPass.js";
import { length3 } from "./astro/coords.js";

async function main() {
  const canvas = document.getElementById("gl-canvas");
  const loading = document.getElementById("loading");

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
    scaleNote: document.getElementById("hud-scale-note"),
    timeSpeed: document.getElementById("time-speed"),
    simClock: document.getElementById("hud-sim-clock"),
    exposure: document.getElementById("exposure"),
    exposureValue: document.getElementById("exposure-value"),
  });
  hud.onExposureChange = (v) => scene.setExposure(v);
  scene.setExposure(hud.exposure);

  let focused = null;
  /** @type {{ system: any, normName: string }[]} */
  let systemSearchIndex = [];
  let viewProj = new Float32Array(16);
  let pointerCss = null;
  const PICK_RADIUS_CSS = 22;

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
    scene.setHoverTarget(hit);
    canvas.style.cursor = hit || focused ? "grab" : "crosshair";
  }

  panel.onClose = () => {
    focused = null;
    camera.clearOrbit();
    scene.setFocusedSystem(null, null);
    hud.setSelection("Free flight", length3(camera.position), false);
  };

  try {
    loading.textContent = "Loading catalog…";
    const raw = await loadExoplanetCatalog();
    catalog.load(raw);
    const starCount = catalog.systems.length;
    const planetCount = catalog.systems.reduce((n, s) => n + (s.planets?.length || 0), 0);
    document.getElementById("stat-stars").textContent = starCount.toLocaleString();
    document.getElementById("stat-planets").textContent = planetCount.toLocaleString();
    scene.uploadStars(catalog);
    minimap.setSystems(catalog.systems);
    minimap.fitToCatalog(catalog.systems);

    // Index only host systems that actually have exoplanet data (Sol included).
    const normalizeName = (name) =>
      String(name).toUpperCase().replace(/\s+/g, "");
    systemSearchIndex = catalog.systems
      .filter((s) => s.isSol || (s.planets?.length ?? 0) > 0)
      .map((s) => ({ system: s, normName: normalizeName(s.name) }));

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
  });

  canvas.addEventListener("click", (e) => {
    if (camera.didDrag()) return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pick = pickAtCss(sx, sy);
    if (pick) selectSystem(pick);
  });

  let closeSystemSearch = null;

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    const searchWrap = document.getElementById("system-search");
    if (
      closeSystemSearch &&
      searchWrap &&
      !searchWrap.classList.contains("hidden")
    ) {
      closeSystemSearch();
      return;
    }
    panel.close();
  });

  function selectSystem(system) {
    const fromStar = focused;
    focused = system;
    const focusDist = system.isSol
      ? Math.max(FOCUS_ORBIT_RADIUS_PC * 2.6, 2.2)
      : Math.max(FOCUS_ORBIT_RADIUS_PC * 2.2, 1.5);
    camera.focusOn(system, focusDist, fromStar);
    // Planets + camera share the same locked system-plane basis
    scene.setFocusedSystem(system, camera.getOrbitBasis());
    panel.open(system);
    hud.setSelection(system.name, system.distPc, true);
  }

  // System name search: prefix-only, case-insensitive (and ignores spaces).
  const searchInput = document.getElementById("system-search-input");
  const searchResults = document.getElementById("system-search-results");
  const searchWrap = document.getElementById("system-search");
  const searchTrigger = document.getElementById("hud-selection-trigger");
  if (
    searchInput &&
    searchResults &&
    searchWrap &&
    searchTrigger &&
    systemSearchIndex.length
  ) {
    const normalizeQuery = (q) =>
      String(q).toUpperCase().trim().replace(/\s+/g, "");

    let activeIndex = -1;
    let currentMatches = [];

    function hideResults() {
      searchResults.classList.add("hidden");
      searchResults.innerHTML = "";
      activeIndex = -1;
      currentMatches = [];
    }

    function closeSearch() {
      hideResults();
      searchWrap.classList.add("hidden");
      searchInput.value = "";
      searchInput.blur();
    }
    closeSystemSearch = closeSearch;

    function openSearch() {
      searchWrap.classList.remove("hidden");
      searchInput.value = "";
      hideResults();
      requestAnimationFrame(() => searchInput.focus());
    }

    searchTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (searchWrap.classList.contains("hidden")) openSearch();
      else closeSearch();
    });

    function renderResults(matches) {
      searchResults.innerHTML = "";
      currentMatches = matches;
      activeIndex = matches.length ? 0 : -1;

      if (!matches.length) {
        searchResults.classList.add("hidden");
        return;
      }
      searchResults.classList.remove("hidden");

      for (let i = 0; i < matches.length; i++) {
        const { system } = matches[i];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "system-search-item";
        if (i === 0) btn.classList.add("active");
        btn.textContent = system.name;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeSearch();
          selectSystem(system);
        });
        searchResults.appendChild(btn);
      }
    }

    function updateMatches() {
      const q = normalizeQuery(searchInput.value);
      if (q.length < 2) {
        hideResults();
        return;
      }

      const matches = systemSearchIndex
        .filter((it) => it.normName.startsWith(q))
        .sort(
          (a, b) =>
            (a.system.distPc ?? Infinity) - (b.system.distPc ?? Infinity) ||
            a.system.name.localeCompare(b.system.name)
        )
        .slice(0, 12);

      renderResults(matches);
    }

    searchInput.addEventListener("input", (e) => {
      e.stopPropagation();
      updateMatches();
    });

    searchInput.addEventListener("pointerdown", (e) => e.stopPropagation());
    searchResults.addEventListener("pointerdown", (e) => e.stopPropagation());
    searchTrigger.addEventListener("pointerdown", (e) => e.stopPropagation());

    window.addEventListener("pointerdown", (e) => {
      if (
        searchWrap.contains(e.target) ||
        searchTrigger.contains(e.target)
      ) {
        return;
      }
      if (!searchWrap.classList.contains("hidden")) closeSearch();
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        e.preventDefault();
        closeSearch();
        return;
      }

      if (searchResults.classList.contains("hidden")) return;

      const items = [...searchResults.querySelectorAll(".system-search-item")];
      if (!items.length) return;

      if (e.code === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(items.length - 1, activeIndex + 1);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(0, activeIndex - 1);
      } else if (e.code === "Enter") {
        e.preventDefault();
        const chosen = currentMatches[activeIndex];
        if (chosen) {
          closeSearch();
          selectSystem(chosen.system);
        }
        return;
      } else {
        return;
      }

      // Update active styling
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle("active", i === activeIndex);
      }
      items[activeIndex]?.scrollIntoView({ block: "nearest" });
    });
  }

  document.getElementById("btn-sol").addEventListener("click", (e) => {
    e.stopPropagation();
    if (catalog.sol) selectSystem(catalog.sol);
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
    });

    minimap.draw(camera);

    if (!focused) {
      hud.setSelection("Free flight", length3(camera.position), false);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
