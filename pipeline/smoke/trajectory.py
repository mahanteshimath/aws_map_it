"""Kinematic air-parcel trajectories through the hourly wind grid.

Midpoint (RK2) integration, bilinear in space and linear in time, run as a
small ensemble (start offsets x wind levels) so the map can show a corridor
rather than a falsely precise line. web/src/traj.ts implements the same maths
so a click anywhere on the map gives the same answer as the pipeline.
"""
import numpy as np

from .config import ENSEMBLE_OFFSETS, GRID, NEAR_KM, PASS_AFTER_FIRE_H, PASS_BEFORE_FIRE_H, STEP_SECONDS

M_PER_DEG = 111_195.0


class WindField:
    def __init__(self, times, U, V):
        """times: datetime64 hourly [T]; U, V: [T, level, lat, lon] m/s."""
        self.t0 = times[0].astype("datetime64[s]").astype(np.int64)
        self.nt = len(times)
        self.U = U
        self.V = V

    def sample(self, level, t, lat, lon):
        """Wind (u, v) in m/s; NaN when outside the grid or time range."""
        fi = (lat - GRID["lat0"]) / GRID["dlat"]
        fj = (lon - GRID["lon0"]) / GRID["dlon"]
        ft = (t - self.t0) / 3600.0
        ok = ((fi >= 0) & (fi <= GRID["nlat"] - 1) & (fj >= 0) & (fj <= GRID["nlon"] - 1)
              & (ft >= 0) & (ft <= self.nt - 1) & np.isfinite(fi) & np.isfinite(fj))
        fi = np.where(ok, fi, 0.0)
        fj = np.where(ok, fj, 0.0)
        ft = np.where(ok, ft, 0.0)
        i0 = np.minimum(fi.astype(int), GRID["nlat"] - 2)
        j0 = np.minimum(fj.astype(int), GRID["nlon"] - 2)
        k0 = np.minimum(ft.astype(int), self.nt - 2)
        di, dj, dk = fi - i0, fj - j0, ft - k0
        out = []
        for F in (self.U, self.V):
            def at(k):
                return (F[k, level, i0, j0] * (1 - di) * (1 - dj) + F[k, level, i0 + 1, j0] * di * (1 - dj)
                        + F[k, level, i0, j0 + 1] * (1 - di) * dj + F[k, level, i0 + 1, j0 + 1] * di * dj)
            val = at(k0) * (1 - dk) + at(k0 + 1) * dk
            out.append(np.where(ok, val, np.nan))
        return out[0], out[1]

    def velocity_deg(self, level, t, lat, lon):
        u, v = self.sample(level, t, lat, lon)
        return v / M_PER_DEG, u / (M_PER_DEG * np.cos(np.deg2rad(lat)))


def members(lat, lon, n_levels):
    """Ensemble start points: every offset at every level."""
    mlat, mlon, mlev = [], [], []
    for lev in range(n_levels):
        for dla, dlo in ENSEMBLE_OFFSETS:
            mlat.append(lat + dla)
            mlon.append(lon + dlo)
            mlev.append(lev)
    return np.array(mlat), np.array(mlon), np.array(mlev)


def integrate(field: WindField, lat, lon, t_start, hours, direction=-1, n_levels=2):
    """Trace parcels from (lat, lon) at unix time t_start.

    direction=-1 traces where the air came from, +1 where it goes.
    Returns (paths [members, hours+1, 2] lat/lon with NaN after leaving the
    grid, times [hours+1] unix seconds, levels [members]).
    """
    plat, plon, lev = members(lat, lon, n_levels)
    dt = direction * STEP_SECONDS
    steps_per_hour = int(3600 / STEP_SECONDS)
    paths = np.full((len(plat), hours + 1, 2), np.nan)
    paths[:, 0, 0], paths[:, 0, 1] = plat, plon
    t = float(t_start)
    for h in range(1, hours + 1):
        for _ in range(steps_per_hour):
            dla1, dlo1 = field.velocity_deg(lev, t, plat, plon)
            mla, mlo = plat + dla1 * dt / 2, plon + dlo1 * dt / 2
            dla2, dlo2 = field.velocity_deg(lev, t + dt / 2, mla, mlo)
            plat, plon = plat + dla2 * dt, plon + dlo2 * dt
            t += dt
        paths[:, h, 0], paths[:, h, 1] = plat, plon
    times = t_start + direction * 3600 * np.arange(hours + 1)
    return paths, times, lev


def near_path_weights(paths, times, lat, lon, t_obj, radius_km, t_window=None):
    """Fraction of ensemble members passing within radius_km of each object.

    t_window=(before_h, after_h) additionally requires the air to pass from
    before_h hours before until after_h hours after the object's time t_obj.
    """
    n = len(lat)
    if n == 0:
        return np.zeros(0)
    hits = np.zeros(n)
    coslat = np.cos(np.deg2rad(np.nanmean(paths[..., 0])))
    for m in range(paths.shape[0]):
        p = paths[m]
        valid = np.isfinite(p[:, 0])
        if not valid.any():
            continue
        p, tp = p[valid], times[valid]
        dy = (lat[:, None] - p[None, :, 0]) * 111.195
        dx = (lon[:, None] - p[None, :, 1]) * 111.195 * coslat
        close = (dx * dx + dy * dy) <= radius_km ** 2
        if t_window is not None:
            dh = (tp[None, :] - t_obj[:, None]) / 3600.0
            close &= (dh >= -t_window[0]) & (dh <= t_window[1])
        hits += close.any(axis=1)
    return hits / paths.shape[0]


def fire_weights(paths, times, fires):
    """Weights for fires the air crossed while they were burning or smouldering."""
    t_fire = fires["time"].values.astype("datetime64[s]").astype(np.int64)
    return near_path_weights(paths, times, fires["lat"].values, fires["lon"].values, t_fire,
                             NEAR_KM, (PASS_BEFORE_FIRE_H, PASS_AFTER_FIRE_H))
