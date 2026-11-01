"""Screenshot the map at desktop and mobile sizes and collect console errors.

    python video/shoot.py http://localhost:5173 .impeccable/review
"""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


async def main(url: str, out: str, query: str = ""):
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    async with async_playwright() as p:
        # The system Edge build is used because bundled headless Chromium is blocked on some managed laptops.
        browser = await p.chromium.launch(channel="msedge", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        for name, vp, mobile in (("desktop", {"width": 1440, "height": 900}, False),
                                 ("mobile", {"width": 390, "height": 844}, True)):
            # bypass_csp only lets Playwright's own polling script run; the page keeps its policy otherwise
            ctx = await browser.new_context(viewport=vp, device_scale_factor=2 if mobile else 1,
                                            is_mobile=mobile, has_touch=mobile, bypass_csp=True)
            page = await ctx.new_page()
            errors = []
            page.on("console", lambda m, e=errors: e.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda exc, e=errors: e.append(f"pageerror: {exc}"))
            await page.goto(url + query, wait_until="networkidle")
            try:
                await page.wait_for_function("document.body.classList.contains('ready')", timeout=45000)
            except Exception:  # noqa: BLE001 - still capture what rendered
                errors.append("not ready after 45s")
            await page.wait_for_timeout(3500)
            await page.screenshot(path=str(out_dir / f"{name}.png"))
            report[name] = {"errors": errors, "finding": await page.inner_text("#finding")}
            await ctx.close()
        await browser.close()
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""))
