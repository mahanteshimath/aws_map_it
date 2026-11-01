"""Inspect the live map's state (sources, layers, last trace) to debug rendering differences."""
import asyncio
import json
import sys

from playwright.async_api import async_playwright


async def main(url: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text[:300]}"))
        page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: logs.append(f"requestfailed: {r.url[:160]} {r.failure}"))
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(9000)
        state = await page.evaluate("""() => {
          const a = window.smoke; const m = a && a.map;
          if (!m) return {noapp: true, ready: document.body.className};
          const src = (id) => { const s = m.getSource(id); const d = s && s._data; 
            return d ? (d.features ? d.features.length : (d.geometry ? d.geometry.coordinates.length : 'x')) : null; };
          return {
            ready: document.body.className,
            last: a.last ? {fires: a.last.fires.lat.length, onPath: a.last.firesOnPath, members: a.last.traj.members.length} : null,
            fires: src('fires'), thread: src('thread'), siblings: src('siblings'), ticks: src('ticks'),
            images: ['fire-lit','fire-dim','cross-white','needle-white'].map(i => m.hasImage(i)),
            layers: ['fires-lit','fires-dim','thread','ticks','head'].map(l => !!m.getLayer(l)),
            rendered: m.queryRenderedFeatures({layers: ['fires-lit','fires-dim','thread']}).length,
          };
        }""")
        print(json.dumps(state, indent=1))
        print("\n".join(l for l in logs if "symbol-sort-key" not in l and "place_label_locality" not in l)[:4000])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
