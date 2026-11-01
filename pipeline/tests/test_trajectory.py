import datetime as dt

import numpy as np
import pandas as pd
import pytest

from smoke import trajectory as tj
from smoke.config import GRID

T0 = np.datetime64("2026-10-27T00:00", "s")


def uniform_field(u, v, hours=96):
    times = T0 + np.arange(hours).astype("timedelta64[h]")
    shape = (hours, 2, GRID["nlat"], GRID["nlon"])
    return tj.WindField(times, np.full(shape, u, np.float32), np.full(shape, v, np.float32))


def t_unix(hours_after_t0):
    return float(T0.astype(np.int64) + 3600 * hours_after_t0)


def test_zero_wind_stays_put():
    f = uniform_field(0.0, 0.0)
    paths, _, _ = tj.integrate(f, 28.6, 77.2, t_unix(60), 24, direction=-1)
    assert np.allclose(paths[0, -1], [28.6, 77.2])


def test_uniform_northward_wind_matches_analytic_displacement():
    f = uniform_field(0.0, 2.0)  # 2 m/s from the south
    paths, times, _ = tj.integrate(f, 28.0, 77.0, t_unix(60), 24, direction=-1)
    expected_dlat = 2.0 * 24 * 3600 / tj.M_PER_DEG
    # Tracing backwards, the air came from the south.
    assert paths[0, -1, 0] == pytest.approx(28.0 - expected_dlat, abs=1e-6)
    assert paths[0, -1, 1] == pytest.approx(77.0, abs=1e-9)
    assert times[-1] == t_unix(36)


def test_backward_then_forward_returns_to_start():
    rng = np.random.default_rng(1)
    hours = 96
    times = T0 + np.arange(hours).astype("timedelta64[h]")
    shape = (hours, 2, GRID["nlat"], GRID["nlon"])
    # Smooth, spatially varying field.
    lat = GRID["lat0"] + GRID["dlat"] * np.arange(GRID["nlat"])
    base_u = 3 * np.sin(np.deg2rad(lat * 8))[None, None, :, None]
    U = np.broadcast_to(base_u, shape).astype(np.float32) + rng.normal(0, 0.05, shape).astype(np.float32)
    V = np.full(shape, -2.0, np.float32)
    f = tj.WindField(times, U, V)
    back, bt, _ = tj.integrate(f, 28.6, 77.2, t_unix(80), 48, direction=-1, n_levels=1)
    origin = back[0, -1]
    fwd, _, _ = tj.integrate(f, origin[0], origin[1], bt[-1], 48, direction=1, n_levels=1)
    err_km = np.hypot(fwd[0, -1, 0] - 28.6, (fwd[0, -1, 1] - 77.2) * np.cos(np.deg2rad(28.6))) * 111.195
    assert err_km < 2.0


def test_leaving_grid_gives_nan_not_garbage():
    f = uniform_field(40.0, 0.0)  # strong westerly pushes parcels off the western edge going back
    paths, _, _ = tj.integrate(f, 28.6, 70.0, t_unix(60), 48, direction=-1)
    assert np.isnan(paths[0, -1]).all()


def test_fire_weights_respect_distance_and_time_window():
    f = uniform_field(0.0, 0.0)
    paths, times, _ = tj.integrate(f, 30.0, 75.0, t_unix(60), 12, direction=-1)
    t_pass = pd.Timestamp(T0.astype("datetime64[s]").astype(object)) + pd.Timedelta(hours=55)
    fires = pd.DataFrame({
        "lat": [30.0, 30.0, 31.0, 30.0],
        "lon": [75.1, 75.1, 75.0, 75.1],
        "time": [t_pass, t_pass - pd.Timedelta(hours=40), t_pass, t_pass + pd.Timedelta(hours=30)],
    })
    w = tj.fire_weights(paths, times, fires)
    # Close and in time: crossed by every member. Too old, too far, or after the air passed: not counted.
    assert w[0] == pytest.approx(1.0)
    assert list(w[1:]) == [0.0, 0.0, 0.0]
