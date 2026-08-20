# Guided tours (PlanetViewer)

This document is the brief for adding or editing a **guided tour**. Follow it exactly: tours are a thin playlist of catalog hostnames plus HUD copy. There is no separate tour data format, no engine registration step, and no per-tour shader or UI code.

Authoritative sources:

| What | File |
| --- | --- |
| Playlist, picker title/blurb, stop order | `js/content/tours.js` |
| HUD blurbs (default + per-tour overrides) | `js/content/starNotes.js` |
| Fiction-only hosts with no planets | `js/content/landmarkStars.js` |
| Catalog hostnames (`system.name`) | `data/exoplanets.json` |
| Runtime: bookmarks, Next, unmatched warnings | `js/catalog/Catalog.js` |
| Picker UI (reads `TOURS` automatically) | `js/ui/TourPicker.js` |
| Start/leave tour, HUD note with tour override | `js/main.js` |

Do **not** invent planets, coordinates, or new landmark stars unless that is explicitly in scope. A tour stop must already exist as a catalog system.

---

## 1. Mental model

A tour is an ordered list of **exact** `system.name` strings. On start:

1. Those systems get `notable = true`.
2. Amber **bookmarks** appear only on those stops, in playlist order.
3. The camera focuses the first stop.
4. **Next** walks the playlist and wraps.
5. The HUD shows `{title} · {n} / {total}` and a one-paragraph note for the focused stop.
6. Clicking a star that is **not** on the playlist leaves the tour (free exploration from that star).

**Free flight** (`id: "freeflight"`) is not a tour. It is a picker option defined as `FREE_FLIGHT` in `tours.js`. Never put it in `TOURS`. Never use `freeflight` as a tour id.

Search still reaches the full catalog during a tour. Leaving a stop via Search or a map click that is not on the playlist calls `leaveTour()`.

---

## 2. What you must change vs what you must not

### Required

1. **`js/content/tours.js`** — append one object to `TOURS`.
2. **`js/content/starNotes.js`** — a `STAR_NOTES` entry for **every** stop (and a `tours[yourId]` override when the default blurb is the wrong angle).

### Strongly recommended

3. **`ExoplanetViewer.md`** — the intro paragraph lists the tours by theme. Update the count and add a short clause for the new tour.
4. **`README.md`** — the Quick start line currently says “one of five guided tours”. Update the count if you add or remove a tour.

### Optional (only if the stop does not exist)

5. **`js/content/landmarkStars.js`** — inject a named star with **no planets** (fiction landmarks). Use this only when NASA has no confirmed planets and the story needs the star anyway. Today: `40 Eri A`, `zet 2 Ret`.
6. **`js/content/systemImages.js` / `data/system-images.json`** — stills in the info panel. Independent of tours; do not add a tour just to attach an image.

### Do not touch for a normal new tour

- `js/ui/TourPicker.js`, `js/ui/Hud.js`, `js/main.js`, `js/catalog/Catalog.js`
- Shaders, CSS, `index.html` (picker cards are generated from `TOURS`)
- `data/exoplanets.json` (do not hand-edit the archive snapshot to “create” a host)

The picker iterates `TOURS` in array order. Adding an object is enough for it to appear.

---

## 3. Tour object contract

```js
{
  id: "short-id",          // unique, lowercase, [a-z0-9-], not "freeflight"
  title: "Picker title",   // a few words, sentence case
  blurb: "One sentence.",  // why take this tour; shown on the picker card
  stops: ["Host Name", …], // ordered NASA / landmark system.name strings
}
```

| Field | Rules |
| --- | --- |
| `id` | Unique across `TOURS`. Used as `STAR_NOTES[name].tours[id]`. Existing ids: `scifi`, `imaged`, `standout`, `goldilocks`, `binaries`. |
| `title` | Human label on picker + HUD (`Science fiction · 3 / 11`). |
| `blurb` | One sentence. Mention the through-line, not a dump of stop names. |
| `stops` | 8–16 is typical. Order is the visit order. Duplicates in one tour are useless (bookmarks collapse to systems). The same host **may** appear on multiple tours. |

`getTour(id)` and `allTourStopNames()` derive from this array. `allTourStopNames()` also feeds search: tour stops stay searchable even if they have no planets and no note (landmarks).

---

## 4. Hostname contract (the usual failure)

Every `stops[]` entry and every `STAR_NOTES` key **must equal `system.name` or an alias exactly** — same spelling, spaces, punctuation, and letter case. Merged binaries (one map system, planets around A and B) keep the old NASA hostnames on `aliases` (`TOI-2267 A` still matches `TOI-2267`).

That is **not** the Bayer/Flamsteed English name, SIMBAD main id, or Wikipedia title.

| You might type | Catalog `name` (use this) |
| --- | --- |
| Gamma Cephei | `gam Cep` |
| Beta Pictoris | `bet Pic` |
| Epsilon Eridani | `eps Eri` |
| Tau Ceti | `tau Cet` |
| Kappa Andromedae | `kap And` |
| Proxima Centauri | `Proxima Cen` |
| Barnard's Star | `Barnard's star` |
| Kepler-90 | `KOI-351` |
| TOI-1338 | `TOI-1338 A` |
| TIC 172900988 | `TIC 172900988 Aa` |
| TOI-2267 A / B | `TOI-2267` (aliases keep `TOI-2267 A`, `TOI-2267 B`) |
| 40 Eridani / Vulcan | `40 Eri A` (landmark) |
| Zeta Reticuli | `zet 2 Ret` (landmark) |

### How to resolve a name

1. Open the app, Search for a common alias, select the system, and copy the hostname from the HUD / info panel (it is `system.name`).
2. Or grep `data/exoplanets.json` for the `"name"` field of that host.
3. Landmarks live only in `js/content/landmarkStars.js` (`name` property). They are merged into the catalog at load; they are **not** in `exoplanets.json`.

On load, unmatched strings log:

```text
[tours] {tourId}: no catalog system matched hostname "{name}"
[starNotes] No catalog system matched hostname "{name}"
```

An unmatched stop is **dropped** from the playlist (`filter((s) => s?.notable)`). The tour still starts if at least one stop matches. Treat any of these warnings as a failed tour edit.

`Sol` is a real catalog system (`isSol`). It is a valid stop (used on Record holders).

---

## 5. Star notes

`STAR_NOTES` is copy only. Keys = `system.name`.

```js
"TRAPPIST-1": {
  text: "Default blurb when no tour is active, or this tour has no override.",
  tours: {
    goldilocks:
      "Override shown only while the Goldilocks tour is active.",
  },
},
```

`getStarNote(name, tourId)` returns `{ text }` where `text` is `note.tours[tourId]` if present, else `note.text`.

### Copy rules

- One to three sentences. Observational, specific (radii, masses, discovery year, fiction work), not marketing.
- Default `text` must make sense **off-tour** (Search, free flight, other tours without an override).
- Add `tours[newId]` when the default angle is wrong for the new tour. Example: Proxima’s default is Three-Body / nearest neighbour; Goldilocks overrides with habitable-zone numbers.
- Do not mention “this tour” or “next stop”. The HUD already shows tour chrome.
- Landmarks: no invented planets. Talk about the star and the fiction, not a fake Vulcan in the orbit view.

Every tour stop should have a note. A stop without a note still bookmarks and focuses, but the HUD note is empty — that is a content bug.

If a host is already in `STAR_NOTES`, keep `text` and add a `tours` key (create `tours` if missing). Do not rewrite another tour’s override.

---

## 6. Runtime behaviour (so you do not “fix” the engine)

`Catalog.setActiveTour(id)`:

- Looks up `getTour(id)`; unknown id → `null` (tour does not start).
- Sets `notable` on systems whose `name` is in `stops`.
- Builds `notableSystems` by mapping names through `byName`, skipping misses.
- Sets `activeTourId`, `tourIndex = 0`.
- Returns the first matched stop.

`nextTourStop()` advances `tourIndex` with wrap.

`syncTourIndex(system)` — if the focused system is on the playlist, HUD index updates; if not, `main.js` leaves the tour.

Scene bookmarks = `catalog.notableSystems` (amber markers). Free flight clears them.

You do not register the tour anywhere else.

---

## 7. Procedure: add a new tour

1. **Pick a through-line** one sentence can state (e.g. “close binaries”, “Earth analogs”). Reject a grab-bag of famous names.
2. **Collect 8–16 hosts** that exist in the catalog and actually illustrate the through-line. Prefer systems that have planets (or intentional landmarks). For binaries, prefer **drawn** close pairs (`multiplicity.drawn`) so the user sees two suns in the orbit view; wide companions are info-panel-only.
3. **Resolve each `system.name`** (section 4). Put those strings in `stops` in visit order. Lead with the clearest example; put “also interesting” later.
4. **Choose `id`, `title`, `blurb`.** `id` is stable; do not reuse or rename existing ids without migrating `STAR_NOTES.tours` keys.
5. **Append** the object to `TOURS` in `js/content/tours.js` (picker order = array order).
6. **Write notes** in `js/content/starNotes.js` for every stop. Add `tours[id]` overrides where the default blurb is off-theme.
7. **Update** `ExoplanetViewer.md` (and README tour count).
8. **Verify** (section 8).

Do not add engine branches, CSS, or a new content file.

---

## 8. Verify

1. Reload the app. The picker must show the new card with the correct stop count (`{n} stops`).
2. Start the tour. Camera goes to stop 1. HUD: `{title} · 1 / {n}`. Amber bookmarks only on the playlist.
3. Open the browser console. There must be **no** `[tours]` or `[starNotes]` unmatched warnings for your strings.
4. Click **Next** through a full wrap; order must match `stops` (minus any unmatched names you failed to catch).
5. Focus a star **not** on the tour → tour chrome goes away (free exploration).
6. Re-open the picker (HUD tour control) and switch tours; the previous playlist bookmarks must be replaced.
7. For a stop with a `tours[id]` override, confirm that blurb while the tour is active, then leave the tour or switch tours and confirm the default `text` returns.

---

## 9. Existing tours (do not duplicate blindly)

| `id` | Title | Through-line | Notes |
| --- | --- | --- | --- |
| `scifi` | Science fiction | Real stars used in stories | Includes landmarks `40 Eri A`, `zet 2 Ret` (no planets). |
| `imaged` | Directly imaged | Worlds / disks photographed | Hosts like `HR 8799`, `PDS 70`, `bet Pic`. |
| `standout` | Record holders | Firsts and extremes | Starts at `Sol`. `KOI-351` = Kepler-90. |
| `goldilocks` | Goldilocks | Earth-like size/mass/insolation | Heavy use of `tours.goldilocks` overrides. |
| `binaries` | Two suns | Close binaries: P-type mixed with S-type | Circumbinary Kepler/TESS hosts interleaved with S-type (`gam Cep`, `HD 110067`, `LHS 1678`, …). |

Read those `stops` arrays and a few `STAR_NOTES` entries before writing copy so tone matches.

---

## 10. Catalog facts useful when choosing stops

- Hosts live in `data/exoplanets.json`. Multiplicity is inlined: `stars[]`, `multiplicity.{drawn, circumbinary, a, …}`.
- **P-type (circumbinary):** planet around both stars (`circumbinary`). **S-type:** planet around one component (`around: "A"` / `"B"`). Co-located NASA A/B host rows (same sky position, e.g. TOI-2267) are merged into **one** system; original hostnames stay on `aliases` and still match tour stops.
- Companions are **drawn** in the orbit view only if close (`a` ≲ 5 AU, or ≲ 20× the outer planet, or a very tight CBP). Wide binaries (55 Cnc, Kepler-444, GJ 667 C, …) show in the info panel only — a poor “two suns” stop if the goal is two stars on screen.
- Landmarks have `planets: []` by design. Do not add fake planets in `landmarkStars.js`.
- Archive names are messy (`TOI-1338 A`, `TIC 172900988 Aa`). Always copy from the catalog.

---

## 11. Checklist for an LLM implementing a tour

- [ ] New `{ id, title, blurb, stops }` appended to `TOURS` (unique `id`, not `freeflight`).
- [ ] Every stop is an exact `system.name` (or landmark `name`).
- [ ] Every stop has `STAR_NOTES[name].text`.
- [ ] Theme-specific blurbs use `STAR_NOTES[name].tours[id]`, leaving other tours’ overrides intact.
- [ ] `ExoplanetViewer.md` / README tour count and theme list updated.
- [ ] No edits to picker, HUD, Catalog, shaders, or `exoplanets.json`.
- [ ] Console clean of unmatched `[tours]` / `[starNotes]` warnings after reload.
