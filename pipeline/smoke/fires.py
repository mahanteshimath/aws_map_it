"""Active fires from NOAA JPSS VIIRS (EFIRE EDR) on the Registry of Open Data on AWS.

Each satellite writes ~1,000 global granules a day. Only granules inside the
afternoon/night overpass windows of North India are downloaded, then fire
pixels are cropped to REGION. Persistent anomalies (industry, gas flares) are
dropped so what remains is open burning.
"""
import datetime as dt
import io
import threading
from concurrent.futures import ThreadPoolExecutor

import boto3
import h5py
import numpy as np
import pandas as pd
import requests
from botocore import UNSIGNED
from botocore.config import Config

from .config import FIRE_PREFIX, PASS_WINDOWS_UTC, REGION, SATELLITES

_local = threading.local()
_s3 = boto3.client("s3", region_name="us-east-1", config=Config(signature_version=UNSIGNED))

COLUMNS = ["lat", "lon", "frp", "day", "time", "sat"]


def _session():
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
    return _local.s


def granule_hour(key: str) -> float:
    """Start time (UTC hours) from a name like ..._s202610280845123_e..."""
    s = key.split("_s", 1)[1]
    return int(s[8:10]) + int(s[10:12]) / 60


def list_granules(bucket: str, day: dt.date) -> list:
    prefix = f"{FIRE_PREFIX}/{day:%Y/%m/%d}/"
    keys = []
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys += [o["Key"] for o in page.get("Contents", [])]
    return [k for k in keys if any(a <= granule_hour(k) < b for a, b in PASS_WINDOWS_UTC)]


def read_granule(blob: bytes) -> pd.DataFrame:
    with h5py.File(io.BytesIO(blob), "r") as g:
        lat = g["FP_Latitude"][:]
        lon = g["FP_Longitude"][:]
        keep = ((lat >= REGION["lat_min"]) & (lat <= REGION["lat_max"])
                & (lon >= REGION["lon_min"]) & (lon <= REGION["lon_max"]))
        if not keep.any():
            return pd.DataFrame()
        start = g.attrs["time_coverage_start"]
        start = start.decode() if isinstance(start, bytes) else str(np.ravel(start)[0])
        return pd.DataFrame({
            "lat": lat[keep].astype("float64"),
            "lon": lon[keep].astype("float64"),
            "frp": g["FP_FireRadiativePower"][:][keep].astype("float64"),
            "day": g["FP_Day"][:][keep].astype("int8"),
            "persistent": g["FP_PersistentAnomalyCategory"][:][keep].astype("int8"),
            "time": pd.Timestamp(start.replace("Z", "")),
        })


def _fetch(bucket_key):
    bucket, key = bucket_key
    for _ in range(3):
        try:
            r = _session().get(f"https://{bucket}.s3.amazonaws.com/{key}", timeout=60)
            if r.ok:
                return read_granule(r.content)
        except Exception:  # noqa: BLE001 - retry transient network / truncated files
            pass
    return None


def fires_for_day(day: dt.date, workers: int = 48) -> pd.DataFrame:
    jobs = [(bucket, k) for bucket in SATELLITES.values() for k in list_granules(bucket, day)]
    sat_of = {bucket: sat for sat, bucket in SATELLITES.items()}
    parts = []
    with ThreadPoolExecutor(workers) as ex:
        for (bucket, _), df in zip(jobs, ex.map(_fetch, jobs)):
            if df is not None and len(df):
                parts.append(df.assign(sat=sat_of[bucket]))
    if not parts:
        return pd.DataFrame(columns=COLUMNS)
    fires = pd.concat(parts, ignore_index=True)
    fires = fires[(fires.persistent == 0) & (fires.frp > 0)]
    # Overpasses straddling midnight belong to the granule's own UTC date.
    return fires[fires.time.dt.date == day][COLUMNS].reset_index(drop=True)


def cached_fires(day: dt.date, raw_store, refresh: bool = False) -> pd.DataFrame:
    key = f"fires/{day:%Y-%m-%d}.parquet"
    blob = None if refresh else raw_store.get(key)
    if blob is not None:
        return pd.read_parquet(io.BytesIO(blob))
    fires = fires_for_day(day)
    buf = io.BytesIO()
    fires.to_parquet(buf, index=False)
    raw_store.put(key, buf.getvalue())
    return fires
