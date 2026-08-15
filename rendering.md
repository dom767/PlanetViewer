# Rendering methodology (PlanetViewer)

This document describes how **stars**, **motion trails**, and **planets** are drawn so another implementation (or LLM) can reproduce the look. Authoritative shaders and constants live in:

| Area | Primary files |
|------|----------------|
| GPU bootstrap, shaders, blends | `js/render/gpu.js` |
| Pass orchestration / HDR | `js/render/Scene.js` |
| Stars + trails | `js/render/StarPass.js` |
| Focused system planets/orbits | `js/render/PlanetPass.js` |
| Galactic-map planets | `js/render/MapPlanetsPass.js` |
| Catalog colour / size / brightness | `js/astro/spectrum.js` |
| Tonemap | `js/render/ToneMapPass.js` |

World units are **parsecs**. Camera uses a standard look-at view matrix and a perspective projection (60° FOV, near 0.05, far 5000).

---

## 1. Frame architecture

### 1.1 Targets

1. Clear an **HDR colour** target (`rgba16float`) and a **depth24plus** buffer.
2. Draw all scene passes into HDR (depth test on, **depth write off** for particles).
3. Fullscreen **ACES filmic** tonemap + exposure → swapchain (`linearToSrgb`).

### 1.2 Draw order (back → front)

1. Optional field stars (`StarPass`, additive)
2. Exoplanet-host stars (`StarPass`: trails, then cores)
3. Map planets (non-focused systems)
4. Focused-system orbits + planets
5. Notable bookmarks
6. Hover/focus highlight ring
7. Tonemap

### 1.3 Shared frame uniform

```text
struct Frame {
  viewProj        : mat4x4   // current view-projection
  trailHistory[16]: mat4x4   // oldest → newest *previous* viewProj samples
  resolution      : vec2     // framebuffer pixels
  time            : f32      // seconds (performance.now()*0.001)
  trailStrength   : f32      // 0 or 1 (trails disabled while warming / after teleports)
}
```

### 1.4 Billboard expansion

Screen-facing quads use NDC corner UVs in `[-1,1]²`. After projecting world position to clip:

```text
px = <size formula>
clip.xy += corner.xy * (px / resolution.xy) * clip.w
```

So `px` is the **full diameter in pixels** of the billboard.

### 1.5 Instance layouts

**Stars / soft particles** (8 floats, 32 bytes):

```text
pos.xyz, color.rgb, size, brightness
```

**Lit planets** (12 floats, 48 bytes):

```text
pos.xyz, color.rgb, size, brightness, lightDir.xyz, (pad)
```

### 1.6 Blend modes

- **Stars & trails:** additive (`src=one, dst=one`) — glow stacks.
- **Planets, orbits, UI markers:** premultiplied alpha (`src=one, dst=oneMinusSrcAlpha`); fragment outputs already multiply RGB by alpha.

---

## 2. Stars

### 2.1 Catalog attributes (CPU)

Per host system (`js/astro/spectrum.js`):

**Colour** — prefer effective temperature via approximate blackbody (`teffToRgb`); else first letter of spectral type (O→Y palette); default `[1, 0.95, 0.8]`.

**Point size** (feeds shader `sizeBright.x`):

```text
rad = radius_Rsun or 1
size = 4 + min(28, sqrt(rad) * 4)
if luminosity L > 0:
  size *= 0.85 + min(0.6, log10(L + 1) * 0.15)
else if vmag and distPc:
  absHint = vmag - 5*log10(max(distPc,0.1)/10)
  size *= clamp(1.2 - absHint*0.02, 0.7, 1.4)
```

Sol is special-cased to `pointSize = 18`.

**Brightness** (feeds `sizeBright.y`) — intrinsic luminosity, log-scaled, **Sun = 1.0**:

```text
L = luminosity_Lsun
  or from absolute mag: M = vmag - 5*log10(distPc/10), L = 10^(-0.4*(M - 4.83))
brightness = clamp(1.0 + 0.28 * log10(max(L, 1e-8)), 0.22, 2.0)
default if unknown: 0.75
```

Twinkling multiplies this value; it must stay centered on ~1× so intensity tracks catalog brightness.

### 2.2 Star core shader (`STAR_WGSL`)

**Vertex**

1. `clip = viewProj * worldPos`, `dist = max(clip.w, 0.05)`.
2. Per-star phase: `phase = hash31(worldPos) * 2π` (hash is a fractal hash of position).
3. Twinkle around unity:

```text
twinkle = 1.0
        + 0.14 * sin(t*2.3 + phase)
        + 0.07 * sin(t*5.1 + phase*1.7)
        + 0.04 * sin(t*11.0 + phase*2.3)
glint   = pow(max(0, sin(t*1.4 + phase*3.1)), 24) * 0.28
sparkle = clamp(twinkle + glint, 0.72, 1.4)
```

4. Pixel diameter:

```text
px = clamp(size * 195 / dist * (0.9 + 0.12*sparkle), 3.5, 126)
```

5. Outputs: `bright = brightness * sparkle`,  
   `spikeAmt = smoothstep(0.24, 0.9, brightness) * (0.65 + 0.5*sparkle)`.

**Fragment** (circular disc, UV = corner in `[-1,1]`):

```text
r2 = dot(uv,uv); discard if r2 > 1

core = exp(-r2 * 22)
halo = exp(-r2 * 3.4) * 0.16

# Axis-aligned diffraction spikes
armH = exp(-|uy|*36) * exp(-|ux|*1.55) * (1 - smoothstep(0.12, 1, |ux|))
armV = symmetric in x/y

# 45° diagonals (weaker)
u45,v45 = rotated |ux±uy|/√2
armD1, armD2 = similar with slightly tighter falloff
spikes = (armH + armV + 0.45*(armD1+armD2)) * spikeAmt * 1.4

a   = (core*1.15 + halo + spikes) * bright
rgb = color * (0.45 + 0.75*core + 0.55*spikes) * a
```

Return premultiplied-looking `vec4(rgb, a)` into additive HDR.

### 2.3 Field stars

Same `StarPass` / softer twin shader (`SOFT_PARTICLE_WGSL`): similar twinkle, smaller scale (`size * 120 / dist`, clamp 2–72), soft Gaussian disc without hard spikes. Sized/brightened from Gaia G mag on the CPU.

---

## 3. Star motion trails

Trails are **not** particle history. They reproject each star through the last **16** view-projection matrices and draw a screen-space ribbon of that path.

### 3.1 History bookkeeping (`Scene`)

- After each frame, push a copy of current `viewProj` into a ring of length 16.
- Upload as `trailHistory[0]=oldest … [15]=newest past`.
- `trailStrength = 1` only when the ring is full **and** camera did not jump > 120 pc since last frame; otherwise 0 and history is cleared (avoids teleport streaks).
- On resize / intentional teleports call `invalidateTrailHistory()`.

### 3.2 Trail shader (`STAR_TRAIL_WGSL`)

Draw call: `draw(6 * 16, starCount)` — no corner vertex buffer; corners and segment index come from `vertex_index`.

For each instance / segment `seg ∈ [0,15]`:

1. If `trailStrength < 0.02`, cull (place verts off-screen).
2. Build 17 screen offsets (pixels relative to **current** projection of the star):

```text
clipNow = viewProj * worldPos
offset(i) = ((histClip.xy/histClip.w) - (clipNow.xy/clipNow.w)) * resolution * 0.5
# i=0 → (0,0); i=1 → newest past (hist[15]); i=16 → oldest (hist[0])
# Reject |offset| > 2200 (set to 0)
```

3. `totalLen = sum of segment lengths`, require `totalLen ≥ 4`, clamp to 2400.
4. Segment endpoints `p0=pts[seg]`, `p1=pts[seg+1]`; require length ≥ 0.35.  
   Direction `dir`, perpendicular `perp = (-dir.y, dir.x)`.
5. Along segment: `along = corner.x*0.5+0.5` (0 = newer, 1 = older).  
   `age = (seg + along) / 16`.
6. Width tied to current star screen size:

```text
starPx   = clamp(size * 195 / dist, 2, 90)
motion   = smoothstep(8, 140, totalLen)
baseHalfW = clamp(starPx*0.28, 0.8, 4.5) * mix(1, 1.35, motion)
halfW     = baseHalfW * mix(1, 0.35, age)   # tapers toward older end
```

7. **Head gap** so the ribbon does not stack under the star core:

```text
headGap = min(starPx*0.35, totalLen*0.08)
offsetPx = mix(p0,p1,along) + perp * corner.y * halfW
offsetPx += normalize(offsetPx) * headGap * max(0, 1 - age*3)
```

8. **Energy budget** (keeps thin/distant trails from vanishing and long ones from blooming):

```text
area       = max(totalLen * baseHalfW * 2, 1)
dens       = 220 / area
sizeGate   = smoothstep(1.5, 6, starPx)
travelGain = mix(0.8, 4.5, motion)
peak       = brightness * travelGain * dens * sizeGate
peak       = min(peak, brightness * mix(1.2, 3.5, motion))
```

9. Expand from `clipNow` by `offsetPx` in the same way as billboards.

**Fragment**

```text
edge     = smoothstep(0, 0.4, 1 - |uv.y|)   # soft across width
headGate = smoothstep(0, 0.08, age)        # fade near star
tail     = (1 - age)^0.85
a        = edge * headGate * tail * 2.8 * peak
rgb      = color * a
```

Additive blend. Trails are drawn **before** star cores so cores sit on top.

---

## 4. Planets

Two scales, same lighting idea.

### 4.1 Dual-scale orbits

True AU separations are remapped into a fixed local radius so every system fills a similar view:

| Context | Constant | Meaning |
|---------|----------|---------|
| Focused system | `FOCUS_ORBIT_RADIUS_PC = 0.85` | Outer planet orbit radius in pc |
| Galactic map | `MAP_ORBIT_RADIUS_PC = 0.45` | Same idea, smaller on the sky map |

```text
maxA   = max(semi-major axes of planets in AU, floor 0.05)
auToPc = ORBIT_RADIUS_PC / maxA
world  = starPos + applyKeplerFrame(orbitFrame, offsetAu * auToPc)
```

Kepler positions come from catalog elements (`planetOffsetAu`, `keplerReferenceFrame` in `js/astro/orbits.js`). Orbit polylines (~160 samples, closed) use the same transform.

### 4.2 Focused-system planet size (CPU)

Absolute radius first (glanceable gas giant vs rocky), then a **compressed** boost for compact systems so stretched orbits do not leave Earth-sized worlds as dust:

```text
R⊕ = radiusEarth or radiusJupiter * 11.209 or 1
R⊕ = max(R⊕, 0.15)
base = 1.73 * (R⊕ ^ 1.1)

stretch = 30.07 / maxA          # Neptune's a as Sol reference
boost   = 1 if stretch≤1 else min(4.5, stretch^0.25)

size = max(0.9, base * boost)
```

Shader pixel diameter:

```text
px = clamp(size * 4.0 / dist, 1.8, 96)
```

### 4.3 Map planet size (CPU)

Smaller log cue (no orbit-stretch boost):

```text
r = radiusEarth or radiusJupiter*11 or 2
size = 2.2 + min(3.5, log10(r+1)*1.8)
px   = clamp(size * 48 / dist, 2, 14)
```

LOD: skip the focused system on the map; farther than ~120 pc omit; beyond 40/80 pc draw fewer planets per system (all / 4 / 2).

### 4.4 Host-star lighting (CPU + GPU)

Light direction = **toward the host star**, expressed in **billboard / camera axes** (from the view matrix columns of `lookAt`: right, up, toward-camera):

```text
L_world = normalize(starPos - planetPos)
lightDir.x = dot(L_world, camRight)
lightDir.y = dot(L_world, camUp)
lightDir.z = dot(L_world, camToward)   # +Z of reconstructed sphere faces camera
```

**Fragment** (hard disc with AA rim + sphere normal from UV):

```text
r = length(uv)
a = 1 - smoothstep(0.82, 0.98, r); discard if a < 0.01

nz = sqrt(max(1e-4, 1 - r²))
n  = normalize(vec3(uv.x, uv.y, nz))
ndotl = max(dot(n, normalize(lightDir)), 0)

# Focused (slightly darker night):
lit  = 0.1 + 0.9 * smoothstep(0, 0.12, ndotl) * ndotl
limb = 0.82 + 0.18 * nz

# Map (a bit more ambient):
lit  = 0.12 + 0.88 * smoothstep(0, 0.12, ndotl) * ndotl
limb = 0.85 + 0.15 * nz

rgb = color * lit * limb * a * brightness
return vec4(rgb, a * brightness)   # premultiplied blend
```

Focused planets also fade opacity during system switches (`ORBIT_FADE_SEC ≈ 0.18`).

### 4.5 Orbit lines

`line-strip` of world positions; fragment colour `(0.35, 0.55, 0.85) * (0.45 * opacity)`, premultiplied.

---

## 5. Tonemap

```text
exposed = max(hdr.rgb, 0) * exposure
mapped  = ACES_filmic(exposed)
  # (x*(2.51*x+0.03)) / (x*(2.43*x+0.59)+0.14), clamped 0..1
out     = linearToSrgb(mapped)
```

Default exposure = 1 (user-adjustable ~0.2–4).

---

## 6. Reproduction checklist

To match PlanetViewer’s look, an alternate renderer should preserve:

1. **Additive HDR stars** with core + halo + 4-arm diffraction spikes.
2. **Twinkle mean ≈ 1×** catalog brightness; brightness from **log₁₀(L/L☉)** centered on the Sun.
3. **Screen-space trail ribbons** from reprojected `viewProj` history (not CPU particle trails), with head gap, age taper, and area-normalized energy.
4. **Dual-scale orbits** (fixed local radius / max AU) for both map and focus views.
5. **Planet discs** as lit spheres (UV→sphere normal, light toward host in camera space), size from **R/R⊕** with optional compact-system boost on focus.
6. **ACES + sRGB** after additive accumulation.

Constants quoted above are the ones currently shipping; tweak carefully — trails and star diameters are especially sensitive to the `195/dist` scale and trail `dens = 220/area` budget.
