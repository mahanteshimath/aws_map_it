"""Build the < 3 minute demo video end to end from the live site.

    python video/build.py probe      # run the tour fast, save its data-driven captions
    python video/build.py voice      # narration per segment (edge-tts, en-IN voice)
    python video/build.py record     # record the tour with holds fitted to the narration
    python video/build.py cards      # render title / architecture / outro cards
    python video/build.py assemble   # mux everything into video/out/whose-smoke.mp4
    python video/build.py all

Narration for the tour is generated from the tour's own captions, so the voice
always says the numbers the map is showing.
"""
import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
OUT = ROOT / "out"
SITE = "https://d1wlimk0cn6w6a.cloudfront.net"
VOICE = "en-IN-NeerjaNeural"
RATE = "+12%"
VIEW = {"width": 1600, "height": 900}
LEAD_MS = 450      # pause after a caption appears before the voice starts
TAIL_MS = 400      # breathing room after each line
PRE_ROLL = 2.4     # seconds of camera move kept before each tour caption

INTRO = ("Every smog season, Delhi's air turns grey, and everyone blames someone else. "
         "So I built a map that follows the air itself. Whose smoke is it?")
ARCH = ("How it works. Four open datasets from the Registry of Open Data on AWS: NOAA satellite fires, "
        "OpenAQ stations, Overture districts, and hourly wind. A daily Lambda container traces the wind "
        "and writes the season to Apache Iceberg tables on Amazon S3 Tables, queried with Athena. "
        "The map runs on S3 and CloudFront, with Amazon Location Service for the India-view basemap, "
        "search, geocoding and road distance.")
OUTRO = ("Smoke has no border, and this map blames no one. It shows where the air has been. "
         "Search your own town. The code is open for any smoky city to reuse.")


def sh(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def spoken(caption: str) -> str:
    s = caption.replace("Punjab (Pakistan)", "Pakistan's Punjab").replace("Punjab (India)", "India's Punjab")
    s = re.sub(r"\b(\d{1,2}) Oct\b", r"\1 October", s)
    s = s.replace(" µg/m³ of PM2.5", " micrograms of P M 2.5", 1).replace(" µg/m³", "").replace("PM2.5", "P M 2.5")
    s = re.sub(r" \(([^();]+), (\d+)%; ([^();]+), (\d+)%\)", r", \2 percent in \1 and \4 percent in \3", s)
    s = re.sub(r" — ([^,.]+?) (\d+)%, ([^,.]+?) (\d+)%", r", \2 percent in \1 and \4 percent in \3", s)
    s = s.replace("%", " percent").replace(" am.", " a.m.").replace(" pm.", " p.m.")
    if s.startswith("Your turn."):
        s = "Your turn. Search your town, click anywhere on the map, or drag the border to any hour since the first of October."
    return re.sub(r"\s+", " ", s).strip()


async def run_tour(holds=None, record=False):
    from playwright.async_api import async_playwright

    captions, marks = {}, {}
    q = "?tour=1&autoplay=1" + (f"&holds={','.join(str(int(h)) for h in holds)}" if holds else "&holds=" + ",".join(["300"] * 7))
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        kw = {"viewport": VIEW, "bypass_csp": True}
        if record:
            kw.update(record_video_dir=str(BUILD / "rec"), record_video_size=VIEW)
        ctx = await browser.new_context(**kw)
        t0 = time.monotonic()
        page = await ctx.new_page()
        done = asyncio.Event()

        def on_console(m):
            txt = m.text
            if txt.startswith("TOUR_CAPTION"):
                _, i, rest = txt.split(" ", 2)
                captions[int(i)] = rest
                marks[int(i)] = time.monotonic() - t0
            elif txt == "TOUR_END":
                marks["end"] = time.monotonic() - t0
                done.set()
        page.on("console", on_console)
        await page.goto(SITE + "/" + q, wait_until="networkidle")
        marks["loaded"] = time.monotonic() - t0
        await asyncio.wait_for(done.wait(), timeout=420)
        await page.wait_for_timeout(1200)
        video = page.video
        await ctx.close()
        if record:
            src = Path(await video.path())
            dst = BUILD / "tour.webm"
            if dst.exists():
                dst.unlink()
            src.rename(dst)
        await browser.close()
    return captions, marks


def probe():
    BUILD.mkdir(parents=True, exist_ok=True)
    caps, _ = asyncio.run(run_tour())
    (BUILD / "captions.json").write_text(json.dumps(caps, indent=1, ensure_ascii=False), encoding="utf-8")
    for i in sorted(caps):
        print(i, caps[i])


def voice():
    caps = json.loads((BUILD / "captions.json").read_text(encoding="utf-8"))
    lines = {"intro": INTRO, "arch": ARCH, "outro": OUTRO}
    lines.update({f"ch{int(i)}": spoken(t) for i, t in caps.items()})
    (BUILD / "narration.json").write_text(json.dumps(lines, indent=1, ensure_ascii=False), encoding="utf-8")
    total = 0.0
    for key, text in lines.items():
        mp3 = BUILD / f"vo-{key}.mp3"
        sh(sys.executable, "-m", "edge_tts", "--voice", VOICE, f"--rate={RATE}", "--text", text, "--write-media", str(mp3))
        d = duration(mp3)
        total += d
        print(f"{key:6s} {d:5.1f}s  {text[:90]}")
    print(f"narration total {total:.1f}s")


def record():
    caps = json.loads((BUILD / "captions.json").read_text(encoding="utf-8"))
    holds = [duration(BUILD / f"vo-ch{i}.mp3") * 1000 + LEAD_MS + TAIL_MS for i in range(len(caps))]
    _, marks = asyncio.run(run_tour(holds, record=True))
    (BUILD / "marks.json").write_text(json.dumps(marks, indent=1), encoding="utf-8")
    print(json.dumps(marks, indent=1))


async def _cards():
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        for card in ("intro", "arch", "outro"):
            await page.goto((ROOT / "cards.html").as_uri() + f"?card={card}")
            await page.wait_for_timeout(700)
            await page.screenshot(path=str(BUILD / f"card-{card}.png"))
        await browser.close()


def cards():
    asyncio.run(_cards())
    print("cards rendered")


def card_clip(name: str, seconds: float) -> Path:
    out = BUILD / f"clip-{name}.mp4"
    frames = int(seconds * 30)
    # slow push-in so the card breathes; the voice sits over it
    sh("ffmpeg", "-y", "-loop", "1", "-i", str(BUILD / f"card-{name}.png"),
       "-i", str(BUILD / f"vo-{name}.mp3"),
       "-filter_complex",
       f"[0:v]scale=2304:1296,zoompan=z='1+0.035*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps=30,"
       f"fade=t=in:st=0:d=0.5,fade=t=out:st={seconds - 0.5:.2f}:d=0.5[v];"
       f"[1:a]adelay=500|500,apad,atrim=0:{seconds:.2f},afade=t=out:st={seconds - 0.4:.2f}:d=0.4[a]",
       "-map", "[v]", "-map", "[a]", "-t", f"{seconds:.2f}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
       "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", str(out))
    return out


def tour_clip() -> Path:
    """One window per chapter: the camera move into it, then its narrated caption.

    Software rendering stretches the page's timers, so the raw recording has dead
    air between chapters; cutting per chapter keeps the edit tight and in sync.
    """
    marks = json.loads((BUILD / "marks.json").read_text())
    n = len([k for k in marks if k.isdigit()])
    segs, prev_end = [], marks["loaded"] + 1.5
    for i in range(n):
        m = marks[str(i)]
        vo = duration(BUILD / f"vo-ch{i}.mp3")
        s = max(prev_end, m - PRE_ROLL)
        e = m + LEAD_MS / 1000 + vo + TAIL_MS / 1000
        if i + 1 < n:
            e = min(e, marks[str(i + 1)])
        seg = BUILD / f"seg-{i}.mp4"
        delay = int((m - s) * 1000 + LEAD_MS)
        sh("ffmpeg", "-y", "-ss", f"{s:.2f}", "-to", f"{e:.2f}", "-i", str(BUILD / "tour.webm"),
           "-i", str(BUILD / f"vo-ch{i}.mp3"),
           "-filter_complex",
           f"[0:v]scale=1920:1080:flags=lanczos,fps=30,setpts=PTS-STARTPTS[v];"
           f"[1:a]adelay={delay}|{delay},apad,atrim=0:{e - s:.2f}[a]",
           "-map", "[v]", "-map", "[a]", "-t", f"{e - s:.2f}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", str(seg))
        segs.append(seg)
        prev_end = e
    lst = BUILD / "tour-concat.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in segs), encoding="utf-8")
    out = BUILD / "clip-tour.mp4"
    sh("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out))
    return out


def assemble():
    OUT.mkdir(parents=True, exist_ok=True)
    parts = [
        card_clip("intro", duration(BUILD / "vo-intro.mp3") + 1.3),
        tour_clip(),
        card_clip("arch", duration(BUILD / "vo-arch.mp3") + 1.2),
        card_clip("outro", duration(BUILD / "vo-outro.mp3") + 1.8),
    ]
    lst = BUILD / "concat.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    final = OUT / "whose-smoke.mp4"
    sh("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "libx264", "-pix_fmt", "yuv420p",
       "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(final))
    d = duration(final)
    print(f"{final}  {d:.1f}s  ({'OK' if d < 178 else 'TOO LONG'})")
    for p in parts:
        print(f"  {p.name}: {duration(p):.1f}s")


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    steps = {"probe": probe, "voice": voice, "record": record, "cards": cards, "assemble": assemble}
    for name in (steps if step == "all" else [step]):
        steps[name]()
