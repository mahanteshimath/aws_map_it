"""Exercise the live map like a visitor: click a fire, use search, flip to forward, run the tour.

    python video/interact.py https://d1wlimk0cn6w6a.cloudfront.net
"""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path(".impeccable/review/interact")


async def main(url: str):
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, bypass_csp=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text[:200]}") if m.type == "error" else None)
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_function("document.body.classList.contains('ready')", timeout=60000)
        await page.wait_for_timeout(2500)

        # 1. click the strongest lit fire
        pt = await page.evaluate("""() => {
          const a = window.smoke, r = a.last; let best = -1, s = 0;
          r.weights.forEach((w, i) => { const v = w * r.fires.frp[i]; if (v > s) { s = v; best = i; } });
          const p = a.map.project([r.fires.lon[best], r.fires.lat[best]]);
          return {x: p.x, y: p.y};
        }""")
        await page.mouse.click(pt["x"], pt["y"])
        await page.wait_for_timeout(3500)
        report["fire_popup"] = await page.inner_text(".maplibregl-popup-content") if await page.query_selector(".maplibregl-popup-content") else None
        await page.screenshot(path=str(OUT / "1-fire-popup.png"))

        # 2. forward from that fire
        btn = await page.query_selector(".maplibregl-popup-content [data-fwd]")
        if btn:
            await btn.click()
            await page.wait_for_timeout(3500)
            report["forward_finding"] = await page.inner_text("#finding")
            await page.screenshot(path=str(OUT / "2-forward.png"))

        # 3. search
        await page.click("#q")
        await page.fill("#q", "Sangrur")
        await page.wait_for_timeout(1800)
        report["search_options"] = await page.eval_on_selector_all("#q-list li", "els => els.map(e => e.innerText.replace(/\\n/g, ' | '))")
        if report["search_options"]:
            await page.keyboard.press("ArrowDown")
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(3500)
            report["search_place"] = await page.inner_text("#place")
            report["search_finding"] = await page.inner_text("#finding")
            await page.screenshot(path=str(OUT / "3-search.png"))

        # 4. click empty map (pin) and reverse geocode
        await page.click('#mode [data-mode="back"]')
        await page.mouse.click(980, 600)
        await page.wait_for_timeout(4000)
        report["pin_place"] = await page.inner_text("#place")
        report["url"] = page.url

        # 5. method drawer
        await page.click("#method-open")
        await page.wait_for_timeout(600)
        report["stats_rows"] = await page.eval_on_selector_all("#stats-body tr", "els => els.map(e => e.innerText.replace(/\\t/g, ' '))")
        await page.screenshot(path=str(OUT / "4-method.png"))
        await page.keyboard.press("Escape")

        # 6. tour, first three chapters
        await page.click("#play")
        caps = []
        for k in range(3):
            await page.wait_for_timeout(7000 if k == 0 else 9500)
            caps.append(await page.inner_text("#caption-text"))
            await page.screenshot(path=str(OUT / f"5-tour-{k + 1}.png"))
        report["tour_captions"] = caps
        report["errors"] = errors
        await browser.close()
    print(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
