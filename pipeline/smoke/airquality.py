"""Measured air quality from the OpenAQ archive (Registry of Open Data on AWS).

The archive is laid out as records/csv.gz/locationid=<id>/year=YYYY/month=MM/
location-<id>-YYYYMMDD.csv.gz and has no station index, so discovery lists
every location's current month and reads one file to get its coordinates.
Model PM2.5 (CAMS via Open-Meteo) is fetched separately and is only used to
fill days the archive has not published yet; it already contains fire
emissions, so statistics are computed from measured data only.
"""
import datetime as dt
import gzip
import io
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import boto3
import numpy as np
import pandas as pd
import requests
from botocore import UNSIGNED
from botocore.config import Config

from .config import CITIES, REGION, STATION_RADIUS_KM

BUCKET = "openaq-data-archive"
_s3 = boto3.client("s3", region_name="us-east-1",
                   config=Config(signature_version=UNSIGNED, max_pool_connections=64))
_local = threading.local()


def _session():
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
    return _local.s


def _location_ids() -> list:
    ids = []
    pages = _s3.get_paginator("list_objects_v2").paginate(
        Bucket=BUCKET, Prefix="records/csv.gz/", Delimiter="/")
    for page in pages:
        for cp in page.get("CommonPrefixes", []):
            if "locationid=" in cp["Prefix"]:
                ids.append(int(cp["Prefix"].split("locationid=")[1].strip("/")))
    return ids


def _latest_file(loc_id: int, month: dt.date):
    prefix = f"records/csv.gz/locationid={loc_id}/year={month:%Y}/month={month:%m}/"
    r = _s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix)
    keys = [o["Key"] for o in r.get("Contents", [])]
    return max(keys) if keys else None


def _read_csv(key: str):
    r = _session().get(f"https://{BUCKET}.s3.amazonaws.com/{key}", timeout=60)
    if not r.ok:
        return None
    return pd.read_csv(io.BytesIO(gzip.decompress(r.content)))


def _probe(args):
    loc_id, month = args
    try:
        key = _latest_file(loc_id, month)
        if key is None:
            return None
        d = _read_csv(key)
        if d is None or d.empty:
            return None
        lat, lon = float(d.lat.iloc[0]), float(d.lon.iloc[0])
        if not (REGION["lat_min"] <= lat <= REGION["lat_max"] and REGION["lon_min"] <= lon <= REGION["lon_max"]):
            return None
        if "pm25" not in set(d.parameter):
            return None
        return {"id": loc_id, "name": str(d.location.iloc[0]), "lat": lat, "lon": lon}
    except Exception:  # noqa: BLE001 - one bad prefix should not stop discovery
        return None


def discover_stations(month: dt.date, workers: int = 64) -> list:
    ids = _location_ids()
    with ThreadPoolExecutor(workers) as ex:
        found = [s for s in ex.map(_probe, [(i, month) for i in ids]) if s]
    return sorted(found, key=lambda s: s["id"])


def _station_day(args):
    loc_id, day = args
    key = (f"records/csv.gz/locationid={loc_id}/year={day:%Y}/month={day:%m}/"
           f"location-{loc_id}-{day:%Y%m%d}.csv.gz")
    try:
        d = _read_csv(key)
    except Exception:  # noqa: BLE001
        return None
    if d is None or d.empty:
        return None
    d = d[(d.parameter == "pm25") & (d.value >= 0) & (d.value < 1500)]
    if d.empty:
        return None
    t = pd.to_datetime(d.datetime, utc=True).dt.tz_convert(None).dt.floor("h")
    return pd.DataFrame({"station": loc_id, "time": t, "pm25": d.value.astype(float)})


def station_hourly(stations: list, start: dt.date, end: dt.date, workers: int = 64) -> pd.DataFrame:
    days = pd.date_range(start, end).date
    jobs = [(s["id"], d) for s in stations for d in days]
    with ThreadPoolExecutor(workers) as ex:
        parts = [p for p in ex.map(_station_day, jobs) if p is not None]
    if not parts:
        return pd.DataFrame(columns=["station", "time", "pm25"])
    out = pd.concat(parts)
    return out.groupby(["station", "time"], as_index=False).pm25.mean()


def km_between(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


def city_measured(stations: list, hourly: pd.DataFrame) -> dict:
    """Median PM2.5 across a city's stations, per hour."""
    out = {}
    for c in CITIES:
        ids = [s["id"] for s in stations
               if km_between(c["lat"], c["lon"], s["lat"], s["lon"]) <= STATION_RADIUS_KM]
        h = hourly[hourly.station.isin(ids)]
        out[c["id"]] = {"stations": ids, "series": h.groupby("time").pm25.median()}
    return out


def city_modelled(start: dt.date, end: dt.date) -> dict:
    """CAMS PM2.5 per city from the Open-Meteo air-quality API (model, not measured)."""
    r = requests.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={
        "latitude": ",".join(str(c["lat"]) for c in CITIES),
        "longitude": ",".join(str(c["lon"]) for c in CITIES),
        "hourly": "pm2_5", "start_date": start.isoformat(), "end_date": end.isoformat(),
        "timezone": "GMT"}, timeout=60)
    r.raise_for_status()
    body = r.json()
    body = body if isinstance(body, list) else [body]
    out = {}
    for c, loc in zip(CITIES, body):
        s = pd.Series(loc["hourly"]["pm2_5"], index=pd.to_datetime(loc["hourly"]["time"]), dtype=float)
        out[c["id"]] = s
    return out


def cached_stations(month: dt.date, raw_store, refresh: bool = False) -> list:
    key = f"aq/stations-{month:%Y-%m}.json"
    blob = None if refresh else raw_store.get(key)
    if blob is not None:
        return json.loads(blob)
    stations = discover_stations(month)
    raw_store.put(key, json.dumps(stations).encode(), "application/json")
    return stations
