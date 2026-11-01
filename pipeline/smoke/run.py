"""Pipeline entry point, used locally (backfill) and by the daily Lambda.

    python -m smoke.run --start 2026-10-01 --end 2026-11-01
    python -m smoke.run --daily            # last few days refreshed, everything re-exported
"""
import argparse
import datetime as dt
import io
import json
import logging
import time

import numpy as np
import pandas as pd

from . import airquality, attribution, export, fires, geo, trajectory, winds
from .config import SEASON_START, TRAJ_HOURS
from .storage import default_stores

log = logging.getLogger("smoke")

JSON = "application/json"


def _aq_hourly(stations, start, end, raw, refresh_days):
    """Station hourly PM2.5, cached as one parquet; the most recent days are always re-read
    because the archive publishes with a lag of a few days."""
    key = "aq/hourly.parquet"
    blob = raw.get(key)
    cached = pd.read_parquet(io.BytesIO(blob)) if blob else pd.DataFrame(columns=["station", "time", "pm25"])
    if cached.empty or cached.time.min() > pd.Timestamp(start) + pd.Timedelta(days=1):
        fetch_from = start
    else:
        fetch_from = max(start, end - dt.timedelta(refresh_days))
    fresh = airquality.station_hourly(stations, fetch_from, end)
    out = pd.concat([cached[cached.time < pd.Timestamp(fetch_from)], fresh], ignore_index=True)
    out = out.drop_duplicates(["station", "time"]).sort_values(["station", "time"]).reset_index(drop=True)
    buf = io.BytesIO()
    out.to_parquet(buf, index=False)
    raw.put(key, buf.getvalue())
    return out


def run(start: dt.date, end: dt.date, refresh_days: int = 0, iceberg=None):
    raw, site = default_stores()
    t0 = time.time()

    districts, towns = geo.cached_geo(raw)
    site.put("districts.geojson", export._json(geo.districts_geojson(districts)), "application/geo+json",
             cache="public, max-age=86400")
    site.put("towns.json", export._json(towns.to_dict("list")), JSON, cache="public, max-age=86400")
    log.info("geo %d districts %d towns", len(districts), len(towns))

    wind_start = start - dt.timedelta(days=TRAJ_HOURS // 24 + 1)
    refresh_from = end - dt.timedelta(refresh_days) if refresh_days else None
    T, U, V = winds.cached_range(wind_start, end, raw, refresh_from=refresh_from)
    log.info("wind %s .. %s", T[0], T[-1])

    fire_days = [wind_start + dt.timedelta(d) for d in range((end - wind_start).days + 1)]
    parts = [fires.cached_fires(d, raw, refresh=bool(refresh_days) and d >= refresh_from) for d in fire_days]
    all_fires = attribution.dedupe_fires(pd.concat([p for p in parts if len(p)], ignore_index=True))
    all_fires["district"] = geo.assign_districts(all_fires, districts).values
    log.info("fires %d after dedupe", len(all_fires))

    stations = airquality.cached_stations((end - dt.timedelta(days=5)).replace(day=1), raw)
    hourly = _aq_hourly(stations, start, end, raw, max(refresh_days, 5))
    measured = airquality.city_measured(stations, hourly)
    modelled = airquality.city_modelled(start, end)
    latest_measured = hourly.time.max().strftime("%Y-%m-%dT%H:00Z") if len(hourly) else None
    log.info("aq %d stations, %d hourly rows, latest %s", len(stations), len(hourly), latest_measured)

    field = trajectory.WindField(T, U, V)
    times = attribution.run_times(field, start, end)
    results = attribution.all_cities(field, all_fires, districts, times, measured, modelled)
    log.info("trajectories %d runs x %d cities", len(times), len(results))

    wind_days = []
    for d in sorted({pd.Timestamp(t).date() for t in T}):
        try:
            site.put(f"wind/{d:%Y-%m-%d}.bin", export.wind_day(T, U, V, d), "application/octet-stream",
                     cache="public, max-age=3600")
            wind_days.append(f"{d:%Y-%m-%d}")
        except ValueError as err:
            log.warning("skip wind %s", err)
    out_fire_days = []
    for d in fire_days:
        site.put(f"fires/{d:%Y-%m-%d}.json", export.fires_day(all_fires, d), JSON, cache="public, max-age=3600")
        out_fire_days.append(f"{d:%Y-%m-%d}")
    for cid, r in results.items():
        site.put(f"exposure/{cid}.json", export.exposure_city(r["series"], r["stats"]), JSON)
    site.put("stations.json", export.stations_file(stations, hourly, start, end), JSON)

    if iceberg is not None:
        iceberg(all_fires=all_fires, hourly=hourly, stations=stations, results=results, districts=districts)

    site.put("manifest.json", export.manifest(
        wind_days, out_fire_days, {k: v["stats"] for k, v in results.items()}, measured, latest_measured),
        JSON, cache="public, max-age=60")
    log.info("done in %.0fs", time.time() - t0)
    return {cid: r["stats"] for cid, r in results.items()}


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=dt.date.fromisoformat, default=SEASON_START)
    ap.add_argument("--end", type=dt.date.fromisoformat, default=dt.datetime.now(dt.timezone.utc).date())
    ap.add_argument("--daily", action="store_true", help="refresh the most recent days from source")
    ap.add_argument("--iceberg", action="store_true", help="also append to the S3 Tables (Iceberg) tables")
    a = ap.parse_args()
    sink = None
    if a.iceberg:
        from .lake import write_tables
        sink = write_tables
    stats = run(a.start, a.end, refresh_days=3 if a.daily else 0, iceberg=sink)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("daily",)} for k, v in stats.items()},
                     indent=1, default=str))


if __name__ == "__main__":
    np.seterr(invalid="ignore")
    main()
