"""Hourly wind grid (100 m and 850 hPa) from the Open-Meteo API.

Open-Meteo's model archive is also mirrored on the Registry of Open Data on
AWS (s3://openmeteo); the HTTP API is used here because it returns a clean
lat/lon grid without a binary decoder. Responses are cached per day.
"""
import datetime as dt
import io
import time

import numpy as np
import requests

from .config import GRID, LEVELS

API = "https://api.open-meteo.com/v1/forecast"
BATCH = 60


def grid_points():
    lats = GRID["lat0"] + GRID["dlat"] * np.arange(GRID["nlat"])
    lons = GRID["lon0"] + GRID["dlon"] * np.arange(GRID["nlon"])
    return lats, lons


def _variables():
    return [f"wind_{kind}_{lvl}" for lvl in LEVELS for kind in ("speed", "direction")]


def _get(params):
    for attempt in range(6):
        r = requests.get(API, params=params, timeout=120)
        if r.status_code == 429:
            time.sleep(30 * (attempt + 1))
            continue
        r.raise_for_status()
        body = r.json()
        return body if isinstance(body, list) else [body]
    raise RuntimeError("Open-Meteo rate limit not clearing")


def fetch(start: dt.date, end: dt.date):
    """Return (times[T] datetime64[h], U, V) with U/V shaped [T, level, lat, lon] in m/s."""
    lats, lons = grid_points()
    pts = [(i, j) for i in range(len(lats)) for j in range(len(lons))]
    variables = _variables()
    U = V = times = None
    for b in range(0, len(pts), BATCH):
        chunk = pts[b:b + BATCH]
        body = _get({
            "latitude": ",".join(f"{lats[i]:.2f}" for i, _ in chunk),
            "longitude": ",".join(f"{lons[j]:.2f}" for _, j in chunk),
            "hourly": ",".join(variables), "start_date": start.isoformat(),
            "end_date": end.isoformat(), "timezone": "GMT", "wind_speed_unit": "ms",
        })
        for (i, j), loc in zip(chunk, body):
            h = loc["hourly"]
            if times is None:
                times = np.array(h["time"], dtype="datetime64[h]")
                U = np.full((len(times), len(LEVELS), len(lats), len(lons)), np.nan, np.float32)
                V = U.copy()
            for k, lvl in enumerate(LEVELS):
                spd = np.array(h[f"wind_speed_{lvl}"], dtype=float)
                rad = np.deg2rad(np.array(h[f"wind_direction_{lvl}"], dtype=float))
                # Meteorological direction is where the wind blows FROM.
                U[:, k, i, j] = -spd * np.sin(rad)
                V[:, k, i, j] = -spd * np.cos(rad)
        # Open-Meteo weights multi-week, multi-location calls; stay under 600/min.
        time.sleep(16 if (end - start).days > 7 else 3)
    return times, U, V


def cached_day(day: dt.date, raw_store, refresh: bool = False):
    key = f"wind/{day:%Y-%m-%d}.npz"
    blob = None if refresh else raw_store.get(key)
    if blob is None:
        times, U, V = fetch(day, day)
        buf = io.BytesIO()
        np.savez_compressed(buf, times=times.astype("datetime64[s]").astype(np.int64), U=U, V=V)
        blob = buf.getvalue()
        raw_store.put(key, blob)
    z = np.load(io.BytesIO(blob))
    return z["times"].astype("datetime64[s]"), z["U"], z["V"]


def cached_range(start: dt.date, end: dt.date, raw_store, refresh_from: dt.date = None):
    """Fetch missing days in one multi-day request per gap, then load all days."""
    days = [start + dt.timedelta(d) for d in range((end - start).days + 1)]
    missing = [d for d in days if raw_store.get(f"wind/{d:%Y-%m-%d}.npz") is None
               or (refresh_from is not None and d >= refresh_from)]
    if missing:
        times, U, V = fetch(min(missing), max(missing))
        for d in missing:
            sel = (times >= np.datetime64(d)) & (times < np.datetime64(d + dt.timedelta(1)))
            buf = io.BytesIO()
            np.savez_compressed(buf, times=times[sel].astype("datetime64[s]").astype(np.int64),
                                U=U[sel], V=V[sel])
            raw_store.put(f"wind/{d:%Y-%m-%d}.npz", buf.getvalue())
    parts = [cached_day(d, raw_store) for d in days]
    return (np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts]),
            np.concatenate([p[2] for p in parts]))
