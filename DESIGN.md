---
name: Whose Smoke Is It?
description: The North Indian plain as a phulkari cloth; the wind is the thread that sews a city's air back across the fires it crossed.
colors:
  ground: "#5a1521"
  ground-deep: "#3e0c17"
  ground-night: "#2a0810"
  lift: "#6d1f2c"
  indigo: "#191632"
  indigo-soft: "#2a2448"
  gold: "#f2b632"
  gold-light: "#ffd977"
  gold-deep: "#a86c0c"
  white: "#f6eedb"
  cream: "#e9d7b8"
  cream-soft: "rgba(233, 215, 184, 0.78)"
  cream-faint: "rgba(233, 215, 184, 0.55)"
  stitch: "rgba(246, 238, 219, 0.55)"
  peacock: "#4fc3c9"
  pm-good: "#cfe8c4"
  pm-satisfactory: "#ece39b"
  pm-moderate: "#f3b562"
  pm-poor: "#ec7a5b"
  pm-very-poor: "#d6457a"
  pm-severe: "#a32a86"
typography:
  display:
    fontFamily: "Khand, Mukta, system-ui, sans-serif"
    fontSize: "clamp(60px, 7vw, 82px)"
    fontWeight: 600
    lineHeight: 0.9
    fontFeature: "'tnum' 1, 'lnum' 1"
  headline:
    fontFamily: "Khand, Mukta, system-ui, sans-serif"
    fontSize: "clamp(40px, 5.2vw, 56px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "0.02em"
  title:
    fontFamily: "Khand, Mukta, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.1
  body:
    fontFamily: "Mukta, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Khand, Mukta, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
rounded:
  band: "4px"
  sm: "6px"
  tag: "7px"
  hem: "9px"
  popup: "11px"
  panel: "14px"
spacing:
  hem: "6px"
  sm: "10px"
  md: "14px"
  edge: "16px"
  border: "122px"
  border-mobile: "100px"
components:
  tag:
    backgroundColor: "rgba(30, 6, 12, 0.35)"
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "7px 11px 6px"
  tag-hover:
    backgroundColor: "rgba(246, 238, 219, 0.1)"
  tag-pressed:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ground-night}"
  tag-satin:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ground-night}"
    padding: "9px 14px 8px"
  tag-mini:
    padding: "5px 9px 4px"
  search-input:
    backgroundColor: "rgba(30, 6, 12, 0.72)"
    textColor: "{colors.cream}"
    typography: "{typography.body}"
    rounded: "{rounded.tag}"
    padding: "7px 12px"
    width: "250px"
  plaque:
    backgroundColor: "{colors.ground-night}"
    textColor: "{colors.cream}"
    rounded: "{rounded.panel}"
    padding: "18px 20px"
    width: "392px"
  caption:
    backgroundColor: "{colors.ground-night}"
    textColor: "{colors.white}"
    rounded: "{rounded.panel}"
    padding: "18px 22px 14px"
    width: "780px"
  drawer:
    backgroundColor: "{colors.ground-night}"
    textColor: "{colors.cream}"
    padding: "26px 30px 40px"
    width: "480px"
  popup:
    backgroundColor: "{colors.ground-night}"
    textColor: "{colors.cream}"
    rounded: "{rounded.popup}"
    padding: "14px 16px 12px"
  band-chip:
    textColor: "{colors.ground-night}"
    rounded: "{rounded.band}"
    padding: "5px 8px 3px"
  embroidered-border:
    backgroundColor: "{colors.ground-night}"
    height: "{spacing.border}"
    padding: "8px 16px 6px"
---

# Design System: Whose Smoke Is It?

## Overview

**Creative North Star: "The Phulkari Cloth"**

The map is a length of madder-maroon handspun khaddar, and everything on it is needlework. Rivers and region lines are indigo thread sunk into the weave; farm fires are gold satin-stitch diamonds; the air a place breathed is a white running stitch sewn back along the real hourly wind, with nine faint sibling threads showing how sure the path is. Forward smoke is sewn in peacock thread. The season runs along the bottom as an embroidered border. Controls are cloth tags hemmed in running stitch.

The surface is full-bleed and map-led. Floating panels are pieces of the same cloth, a shade darker, with a stitched inner hem. Density stays low: one plaque, one tool row, one border, one bright thread. Motion follows the data: the thread is sewn at the pace of the wind trace, fires light as the needle passes, and counts tick over in fixed figures.

Confirmed rejection: the near-black dashboard map with glowing dots and a stats sidebar.

**Key Characteristics:**
- Maroon cloth ground with a 6px weave texture over everything, map included.
- Tags, fields and panel hems are edged in dashed running stitch; chosen things are satin-filled.
- One bright edge: only the traced centre thread is a full-strength line.
- Khand condensed caps for names and figures, Mukta for reading text, tabular figures that tick.
- Soft, deep maroon-black shadows; nothing glows.

## Colors

A dyed-textile palette: madder grounds, indigo-black water, gold and white silk, peacock for the forward direction, and India's AQI colours as the one data scale.

### Primary
- **Phulkari Gold Silk** (gold, with gold-light sheen and gold-deep shade): fire marks, the fire-activity columns in the border, the single primary action per panel, and the active city knot. Gold-light alone is the accent thread: figures inside findings and popups, drawer headings, links, the focus ring, the search caret.

### Secondary
- **Peacock Thread** (peacock): forward mode only. The forward thread, its sibling threads, its cross-stitch hour marks and needle, and the rings on towns beneath the smoke (fill at 18% alpha, town labels in a pale peacock tint).

### Tertiary
- **AQI Border Colours** (pm-good through pm-severe): measured PM2.5 on station dots, the PM strip in the border, the plaque's band chip and the legend. Thresholds are India's National AQI 24 h PM2.5 bands: 30, 60, 90, 120, 250 µg/m³.

### Neutral
- **Madder Khaddar** (ground): the map background and basemap land.
- **Deep Madder** (ground-deep): text halos on map labels, knot rims, greenspace, the brand mark's inner diamond, `theme-color`.
- **Night Madder** (ground-night): every floating panel (plaque 88%, caption 92% over the map; drawer, popup, search list and border solid). Also text on silk.
- **Madder Lift** (lift): scrollbar thumbs only.
- **Indigo Black** (indigo, indigo-soft): water fills, region and district lines (indigo); waterways (indigo-soft).
- **Unbleached Silk** (white): the traced thread, the timeline needle, place names, the PM numeral, caption text.
- **Raw Cotton** (cream, cream-soft, cream-faint): body text; secondary notes and dates; placeholders. Country borders are cream at 30%.
- **Running Stitch** (stitch): the dashed edge of every tag and the search field.

### Named Rules
**The One Bright Thread Rule.** Only the traced centre thread is a full-strength white line (peacock forward). Sibling threads sit at 32%, country borders at 30% cream, region lines at 70% indigo, unlit fires at 14–38%. If another line is as bright as the thread, dim it.

**The Silk Reserve Rule.** Gold satin fill marks fire and the one primary action in a panel. A chosen toggle gets white silk, never gold. Peacock appears only in forward mode.

## Typography

**Display Font:** Khand (with Mukta, system-ui), weights 500/600/700, bundled via Fontsource
**Body Font:** Mukta (with system-ui), weights 400/600, bundled via Fontsource

**Character:** Khand is a condensed Devanagari-family grotesque that reads as stencilled caps on a cloth label; Mukta is the plain, warm reading voice beneath it. Both carry Devanagari, so the pair fits the region.

### Hierarchy
- **Display** (Khand 600, clamp(60px, 7vw, 82px), 0.9): the plaque's PM2.5 numeral only, right-aligned at min 2.2ch with tabular lining figures. 46px on mobile.
- **Headline** (Khand 700, clamp(40px, 5.2vw, 56px), 0.95, 0.02em, uppercase): the place name. The drawer title uses the same voice at 30px; the wordmark at 23px with 0.03em.
- **Title** (Khand 600, 20px, 1.1): drawer section heads in gold-light; popup heads at 18px in white.
- **Body** (Mukta 400, 16px, 1.45): findings at 15.5px, max 40ch; caption at 19px (15.5px mobile); drawer text at 15px, max 62ch; notes at 13–13.5px in cream-soft.
- **Label** (Khand 600, 15px, 1, 0.01em): tags, band chip (14px), border label, search-result names. Mini tags at 13px.

### Named Rules
**The Fixed Figure Rule.** Every counted figure is Khand with `tabular-nums lining-nums`, and it ticks to its new value over 520ms (ease-out cubic) rather than swapping. Inline figures in prose are gold-light at 1.12em.

**The Model Thread Rule.** Modelled data looks unfinished. A modelled PM2.5 numeral drops to cream with a 2px dashed underline (offset 8px); modelled cells in the border's PM strip drop to 45% opacity and 60% height.

## Layout

Full-bleed map with a fixed `overflow: hidden` viewport. Panels sit 16px from the edges: the plaque top-left (max 392px), the tool row top-right (brand, 250px search, Method tag), the tour caption centred above the border (max 780px), and the Method drawer as a right-hand sheet (max 480px). The embroidered border spans the full width at the bottom (122px tall); the map's bottom-right controls sit above it.

Rhythm inside panels is 6px between tags, 10–14px between plaque blocks, 18–22px panel padding. Map framing pads the trace away from the plaque (`left: plaque.right + 40`, `bottom: 140`).

At ≤760px the border shrinks to 100px; the tool row spans the top with the search filling it (brand and zoom controls hidden); the plaque becomes a bottom sheet just above the border (max 47vh, 12px radius, tighter type) and hides during the tour.

## Elevation & Depth

Depth is cloth lying on cloth. Panels float on soft, wide, maroon-black shadows (rgba(12, 2, 6, …)). Stitches sit proud of the cloth with a tiny soft contact shadow offset down-right, about 0.8px by 1.4px. The weave texture repeats on every panel, so all depth stays inside the same material. No glows, no glass, no backdrop blur.

### Shadow Vocabulary
- **Panel float** (`box-shadow: 0 14px 34px rgba(12, 2, 6, 0.5), 0 2px 6px rgba(12, 2, 6, 0.4)`): the plaque; the caption uses `0 14px 34px rgba(12, 2, 6, 0.55)`.
- **Popover** (`box-shadow: 0 12px 28px rgba(12, 2, 6, 0.55)`): search list; map popup at `0 14px 30px`.
- **Sheet edge** (`box-shadow: -18px 0 40px rgba(12, 2, 6, 0.55)`): the drawer; the border casts `0 -10px 28px rgba(12, 2, 6, 0.45)` upward.
- **Thread proud** (map line `#14040a` at 50%, translate 0.9/1.6px, blur 1): under the traced thread; the same offset is painted under satin diamonds, cross-stitches and the needle.

### Named Rules
**The Proud Thread Rule.** Stitches cast only a soft ~1px contact shadow, as thread on cloth would. Nothing on the cloth emits light.

## Shapes

Soft, hand-cut corners: 4px band chip, 6px list rows, 7px tags and field, 9px stitched hems, 11px popups, 14px panels. Every tag and the search field is edged in a 1.5px dashed running stitch. Panels (plaque, caption, drawer) carry the stitch as an inner hem inset 6px with a 9px radius. Table rules are 1px dashed. Recurring silhouettes are the phulkari lozenge (fire marks, the brand mark, the timeline needle head, list bullets as gold diamonds rotated 45° and stretched 1.25×), the cross-stitch, and the round French-knot pin.

### Named Rules
**The Running Stitch Edge Rule.** Controls, panel hems and traced paths are dashed stitches, never solid strokes: tags and fields at 1.5px, panel hems at 32% white, the thread at 1.8/1.1 dash, siblings at 1.4/1.6, the border hems at 5/4. Only the basemap's sunk lines (indigo regions and districts, 30% cream borders) stay solid.

## Components

### Buttons (cloth tags)
Every control is a cloth tag: tactile and plain until chosen.
- **Shape:** gently rounded (7px), 1.5px dashed stitch edge.
- **Default:** translucent night-madder fill, cream Khand label, 7px 11px 6px.
- **Hover:** fill lifts to 10% white, stitch brightens to 80% white; 160ms `cubic-bezier(.2, .7, .2, 1)`.
- **Focus:** 2px gold-light outline, 2px offset (global).
- **Pressed / chosen** (`aria-pressed="true"`): white-silk satin fill (115° striped gradient), night-madder text, solid stitch edge.
- **Primary (satin):** gold satin fill, night-madder text with a faint light emboss, solid gold-deep edge, larger padding. One per panel: "Play the story" in the plaque; "Where did this smoke go?" in a fire popup. Silk hovers at `brightness(1.06)`.
- **Mini:** 13px label, 5px 9px 4px (the border's "Play season").
- **Disabled:** 50% opacity.

### Inputs / Fields
- **Style:** search field in the tag's stitch edge and radius, fill at 72% night madder, Mukta 15px, gold-light caret, cream-faint placeholder.
- **Results:** a night-madder list below with a 9px radius; rows have a 6px radius, a Khand white name and a 12.5px cream-soft region line; the selected or hovered row lifts to 10% white.

### Cards / Containers
- **Plaque:** night madder at 88% over the weave, 14px radius, inner stitched hem, panel-float shadow. Order: city tags, place name, date, PM numeral with band chip, primary satin tag, direction tags, finding, season line.
- **Band chip:** solid AQI band colour behind night-madder Khand 14px text with the band's name; faint cream when there is no reading.
- **Caption (tour):** 92% night madder, 19px white body, rises in over 520ms (6px lift and 2px blur clearing, `cubic-bezier(.16, 1, .3, 1)`); controls are plain tags, right-aligned.
- **Drawer (Method):** solid night madder, slides in 32px over 380ms on the same ease; dashed table rules; tabular Khand figures in cells; gold-diamond bullets.
- **Map popup:** night madder with weave, 11px radius, 18px Khand white head.

### Navigation
None beyond the tool row. Preset cities are a tag group; the active city is a pressed white-silk tag on the plaque and a gold-satin knot with an 18px gold-light name on the map.

### Embroidered Border (signature)
The season timeline, painted on canvas and operated as a keyboard slider (←/→ step 3 h, Shift for a day, Home/End). Running-stitch hems top and bottom (1.2px, 5/4 dash, 50% white). One column per 3-hourly trace: height scales with the square root of fire activity on the air's path, in gold-deep with a gold face on its left 55%. Above the columns is a 7px PM2.5 strip in AQI colours. Khand 600 day labels and 1px tick marks sit along the base. The needle is a 2px white line with a lozenge head. A tour highlight is an 8% white wash. Season playback advances one trace every 160ms.

### Map Stitches (signature)
- **Satin diamond:** a gold lozenge filled with diagonal silk floats, every third one in sheen, a pale gold rim and a proud shadow. Lit fires scale with radiative power and light at 260ms as the needle passes. Unlit fires are dull floss at 14–38%.
- **Running thread:** a white (or peacock) dashed line, 3.4–5.5px with zoom, butt caps. The nine siblings are 1.1px at 32%.
- **Cross-stitch:** marks every six hours along the thread, with an hour label in white over a deep-madder halo.
- **Needle:** a filled round head with a deep-madder eye, leading the thread while it is sewn.
- **French knot:** city pins are 13px white knots with a 3px deep-madder rim.
- **District tint:** districts the air crossed take a gold fill at up to 13% by share of fires.

## Do's and Don'ts

### Do:
- **Do** set every new surface on night madder (ground-night) with the weave texture and a 6px-inset dashed hem.
- **Do** make every panel control a cloth tag: 1.5px dashed stitch, 7px radius, Khand 600 label.
- **Do** keep the sew tied to the data: the thread draws over 2200ms (ease-out cubic) along the real trace, and fires light only as the needle reaches them.
- **Do** pair every AQI colour with its band name or a number; the colour never stands alone.
- **Do** honour reduced motion: CSS animation off, and the sew, ticks and camera moves resolve instantly.
- **Do** bundle Khand and Mukta locally; no font or library CDN.

### Don't:
- **Don't** build a near-black dashboard map with glowing dots and a stats sidebar.
- **Don't** draw the air path as a solid, glowing or gradient line; it is always running stitch with a proud shadow.
- **Don't** put gold satin on a toggle or a second action in the same panel; chosen toggles are white silk.
- **Don't** use peacock outside forward mode, or for anything but the forward thread, its marks and the towns beneath it.
- **Don't** let any other line on the map match the traced thread's brightness.
