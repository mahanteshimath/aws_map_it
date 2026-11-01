"""Link each city's air to the fires it crossed, and score that against measured PM2.5."""
import numpy as np
import pandas as pd

from . import trajectory as tj
from .config import CITIES, PASS_AFTER_FIRE_H, PASS_BEFORE_FIRE_H, REGION_NAMES, RUN_HOURS_UTC, TRAJ_HOURS

CELL_DEG = 0.02  # ~2 km: merge the same field seen by several satellites in one overpass


def dedupe_fires(fires: pd.DataFrame) -> pd.DataFrame:
    """One record per ~2 km cell per overpass (day/night), keeping the strongest detection."""
    if fires.empty:
        return fires.assign(nsat=pd.Series(dtype="int8"))
    f = fires.assign(
        ci=np.round(fires.lat / CELL_DEG).astype(int), cj=np.round(fires.lon / CELL_DEG).astype(int),
        date=fires.time.dt.date)
    f = f.sort_values("frp", ascending=False)
    g = f.groupby(["ci", "cj", "date", "day"], sort=False)
    out = g.first().reset_index()
    out["nsat"] = g.sat.nunique().values.astype("int8")
    out["time"] = g.time.min().values
    return out[["lat", "lon", "frp", "day", "time", "nsat"]].sort_values("time").reset_index(drop=True)


def run_times(field: tj.WindField, start, end):
    """Precomputed run times (unix s) that have a full 48 h of wind behind them."""
    t_first = field.t0 + TRAJ_HOURS * 3600
    t_last = field.t0 + (field.nt - 1) * 3600
    days = pd.date_range(start, end, freq="D")
    out = []
    for d in days:
        for h in RUN_HOURS_UTC:
            t = int((d + pd.Timedelta(hours=h)).timestamp())
            if t_first <= t <= t_last:
                out.append(t)
    return out


def _fires_window(fires: pd.DataFrame, t_unix: np.ndarray, t_end: int):
    lo = t_end - (TRAJ_HOURS + PASS_AFTER_FIRE_H) * 3600
    hi = t_end + PASS_BEFORE_FIRE_H * 3600
    a, b = np.searchsorted(t_unix, [lo, hi])
    return a, b


def city_runs(field: tj.WindField, fires: pd.DataFrame, n_districts: int, times: list, city: dict):
    t_unix = fires.time.values.astype("datetime64[s]").astype(np.int64)
    runs = []
    for t_end in times:
        paths, ptimes, _ = tj.integrate(field, city["lat"], city["lon"], t_end, TRAJ_HOURS, -1)
        a, b = _fires_window(fires, t_unix, t_end)
        win = fires.iloc[a:b]
        w = tj.fire_weights(paths, ptimes, win) if len(win) else np.zeros(0)
        hit = w > 0
        by_d = np.zeros(n_districts + 1)
        np.add.at(by_d, win.district.values[hit] + 1, w[hit] * win.frp.values[hit])
        runs.append({
            "t": t_end,
            "paths": paths,
            "fires": float(w.sum()),
            "frp": float((w * win.frp.values).sum()) if len(win) else 0.0,
            "district_frp": by_d[1:],
            "fire_idx": (np.arange(a, b)[hit]).astype(np.int32),
            "fire_w": w[hit].astype(np.float32),
        })
    return runs


def pm_at(series: pd.Series, t_end: int, half_window_h: int = 1):
    if series is None or series.empty:
        return None
    t = pd.Timestamp(t_end, unit="s")
    s = series[(series.index >= t - pd.Timedelta(hours=half_window_h))
               & (series.index <= t + pd.Timedelta(hours=half_window_h))]
    return float(s.mean()) if len(s) else None


def _spearman(a, b) -> float:
    return float(pd.Series(np.asarray(a, float)).rank().corr(pd.Series(np.asarray(b, float)).rank()))


def _detrend(k, y):
    y = np.asarray(y, float)
    return y - np.polyval(np.polyfit(k, y, 1), k)


def season_stats(runs: list, measured: pd.Series, modelled: pd.Series, districts: pd.DataFrame) -> dict:
    t = pd.to_datetime([r["t"] for r in runs], unit="s")
    df = pd.DataFrame({
        "t": t,
        "fires": [r["fires"] for r in runs],
        "frp": [r["frp"] for r in runs],
        "pm_obs": [pm_at(measured, r["t"]) for r in runs],
        "pm_model": [pm_at(modelled, r["t"]) for r in runs],
    })
    daily = df.set_index("t").resample("D").mean()
    obs = daily.dropna(subset=["pm_obs"])
    stats = {"days_measured": int(len(obs))}
    if len(obs) >= 5:
        stats["spearman_fires_vs_pm_obs"] = round(_spearman(obs.fires, obs.pm_obs), 2)
        # Fires and smog both rise through the season; remove a linear trend from
        # each before correlating so the season alone cannot produce the link.
        k = np.arange(len(obs))
        stats["spearman_detrended"] = round(_spearman(_detrend(k, obs.fires), _detrend(k, np.log(obs.pm_obs))), 2)
        q = obs.fires.quantile([0.25, 0.75])
        low, high = obs[obs.fires <= q.iloc[0]], obs[obs.fires >= q.iloc[1]]
        stats["pm_obs_low_fire_days"] = round(float(low.pm_obs.mean()), 1)
        stats["pm_obs_high_fire_days"] = round(float(high.pm_obs.mean()), 1)
        stats["n_low_days"], stats["n_high_days"] = int(len(low)), int(len(high))
    totals = np.sum([r["district_frp"] for r in runs], axis=0)
    share = totals / totals.sum() if totals.sum() > 0 else totals
    order = np.argsort(-totals)[:15]
    stats["leaderboard"] = [
        {"i": int(i), "name": districts.iloc[i]["name"], "region": districts.iloc[i]["region"],
         "share": round(float(share[i]), 4)}
        for i in order if totals[i] > 0]
    by_region = pd.Series(share, index=districts.region.values).groupby(level=0).sum().sort_values(ascending=False)
    stats["regions"] = [{"code": code, "name": REGION_NAMES.get(code, code), "share": round(float(v), 4)}
                        for code, v in by_region.items() if v >= 0.005]
    daily_out = daily.reset_index()
    daily_out["t"] = daily_out.t.dt.strftime("%Y-%m-%d")
    stats["daily"] = daily_out.round(1).replace({np.nan: None}).to_dict("list")
    return df, stats


def all_cities(field, fires, districts, times, measured, modelled):
    out = {}
    for c in CITIES:
        runs = city_runs(field, fires, len(districts), times, c)
        series, stats = season_stats(runs, measured.get(c["id"], {}).get("series"), modelled.get(c["id"]), districts)
        out[c["id"]] = {"runs": runs, "series": series, "stats": stats}
    return out
