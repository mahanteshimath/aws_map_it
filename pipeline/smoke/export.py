"""Write the compact, browser-ready data files described in the README's data contract."""
import datetime as dt
import json

import numpy as np
import pandas as pd

from .config import (CITIES, ENSEMBLE_OFFSETS, GRID, LEVELS, NEAR_KM, PASS_AFTER_FIRE_H, PASS_BEFORE_FIRE_H,
                     STEP_SECONDS, TRAJ_HOURS)

WIND_SCALE = 100  # int16 cm/s
NODATA = -32768

SOURCES = [
    {"name": "NOAA JPSS VIIRS Active Fires (EFIRE EDR)", "via": "Registry of Open Data on AWS",
     "url": "https://registry.opendata.aws/noaa-jpss/"},
    {"name": "OpenAQ air quality archive", "via": "Registry of Open Data on AWS",
     "url": "https://registry.opendata.aws/openaq/"},
    {"name": "Overture Maps divisions", "via": "Registry of Open Data on AWS",
     "url": "https://registry.opendata.aws/overture/", "license": "ODbL"},
    {"name": "Open-Meteo wind (100 m, 850 hPa) and CAMS PM2.5", "via": "open-meteo.com",
     "url": "https://open-meteo.com/", "license": "CC BY 4.0"},
]


def _json(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":"), allow_nan=False).encode()


def _clean(values, nd=1):
    return [None if v is None or not np.isfinite(v) else round(float(v), nd) for v in values]


def wind_day(times, U, V, day: dt.date) -> bytes:
    sel = (times >= np.datetime64(day)) & (times < np.datetime64(day + dt.timedelta(1)))
    if sel.sum() != 24:
        raise ValueError(f"{day}: expected 24 wind hours, got {sel.sum()}")
    arr = np.stack([U[sel], V[sel]], axis=2)  # [24, level, comp, lat, lon]
    q = np.where(np.isfinite(arr), np.round(arr * WIND_SCALE), NODATA)
    return np.clip(q, NODATA, 32767).astype("<i2").tobytes()


def fires_day(fires: pd.DataFrame, day: dt.date) -> bytes:
    f = fires[fires.time.dt.date == day]
    minutes = ((f.time - pd.Timestamp(day)).dt.total_seconds() // 60).astype(int)
    return _json({
        "lat": f.lat.round(3).tolist(), "lon": f.lon.round(3).tolist(), "frp": f.frp.round(1).tolist(),
        "m": minutes.tolist(), "n": f.nsat.astype(int).tolist(), "d": f.district.astype(int).tolist(),
    })


def exposure_city(series: pd.DataFrame, stats: dict) -> bytes:
    return _json({
        "t": (series.t.astype("int64") // 10**9).tolist(),
        "fires": _clean(series.fires), "frp": _clean(series.frp, 0),
        "pm_obs": _clean(series.pm_obs, 0), "pm_model": _clean(series.pm_model, 0),
        "stats": stats,
    })


def stations_file(stations: list, hourly: pd.DataFrame, start: dt.date, end: dt.date) -> bytes:
    hours = pd.date_range(pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(hours=23), freq="h")
    keep = [s for s in stations if s["id"] in set(hourly.station)]
    values = []
    for s in keep:
        h = hourly[hourly.station == s["id"]].set_index("time").pm25.reindex(hours)
        values.append([None if not np.isfinite(v) else int(round(v)) for v in h.values])
    return _json({
        "t0": int(hours[0].timestamp()), "hours": len(hours),
        "stations": [{"id": s["id"], "name": s["name"], "lat": round(s["lat"], 4), "lon": round(s["lon"], 4)}
                     for s in keep],
        "pm25": values,
    })


def manifest(wind_days, fire_days, city_stats, measured, latest_measured, extra=None) -> bytes:
    cities = []
    for c in CITIES:
        s = city_stats[c["id"]]
        cities.append({**c, "stations": measured.get(c["id"], {}).get("stations", []),
                       "summary": {k: v for k, v in s.items() if k not in ("daily", "leaderboard")}})
    body = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "wind": {"days": wind_days, "grid": GRID, "levels": LEVELS, "scale": WIND_SCALE, "nodata": NODATA,
                 "layout": "[hour][level][u,v][lat][lon] int16 little-endian"},
        "fire_days": fire_days,
        "latest_measured": latest_measured,
        "trajectory": {"hours": TRAJ_HOURS, "step_seconds": STEP_SECONDS, "offsets": ENSEMBLE_OFFSETS,
                       "near_km": NEAR_KM, "pass_before_fire_h": PASS_BEFORE_FIRE_H,
                       "pass_after_fire_h": PASS_AFTER_FIRE_H},
        "cities": cities,
        "sources": SOURCES,
    }
    if extra:
        body.update(extra)
    return _json(body)
