"""Shared configuration for the Whose Smoke Is It? pipeline.

Anything the browser also needs (grid, levels, trajectory parameters) is
published in manifest.json so web/src/traj.ts stays in lock-step with
trajectory.py.
"""
import datetime as dt

SEASON_START = dt.date(2026, 10, 1)

# Region covered by the wind grid and fire extraction (degrees).
REGION = {"lat_min": 22.0, "lat_max": 35.0, "lon_min": 66.0, "lon_max": 86.0}

# Wind grid: 0.5 degree cells over REGION, two heights.
GRID = {"lat0": 22.0, "lon0": 66.0, "dlat": 0.5, "dlon": 0.5, "nlat": 27, "nlon": 41}
LEVELS = ["100m", "850hPa"]  # ~100 m (surface layer) and ~1.5 km (transport layer)

# Preset cities. Any point on the map can be traced; these get precomputed
# season series and district leaderboards.
CITIES = [
    {"id": "delhi", "name": "Delhi", "lat": 28.6139, "lon": 77.2090},
    {"id": "chandigarh", "name": "Chandigarh", "lat": 30.7333, "lon": 76.7794},
    {"id": "lucknow", "name": "Lucknow", "lat": 26.8467, "lon": 80.9462},
    {"id": "lahore", "name": "Lahore", "lat": 31.5204, "lon": 74.3587},
]

# NOAA JPSS VIIRS active-fire EDR on the Registry of Open Data on AWS.
SATELLITES = {
    "n20": "noaa-nesdis-n20-pds",
    "n21": "noaa-nesdis-n21-pds",
    "snpp": "noaa-nesdis-snpp-pds",
}
FIRE_PREFIX = "VIIRS_EFIRE_VIIRSI_EDR"
# Afternoon (~13:30 local) and night (~01:30 local) overpasses of the region, UTC hours.
PASS_WINDOWS_UTC = [(6.0, 10.5), (19.0, 23.0)]

# Trajectory model.
TRAJ_HOURS = 48
STEP_SECONDS = 900
# Ensemble start offsets (dlat, dlon) in degrees, run at every level.
ENSEMBLE_OFFSETS = [(0.0, 0.0), (0.1, 0.0), (-0.1, 0.0), (0.0, 0.1), (0.0, -0.1)]

# Fire-on-path rule: a fire counts if a path point is within NEAR_KM of it and
# the air passes over it from PASS_BEFORE_FIRE_H before the satellite saw it
# until PASS_AFTER_FIRE_H after (crop fires smoulder and smoke lingers).
NEAR_KM = 25.0
PASS_BEFORE_FIRE_H = 3.0
PASS_AFTER_FIRE_H = 18.0

# Precomputed runs for preset cities (UTC hours).
RUN_HOURS_UTC = [0, 3, 6, 9, 12, 15, 18, 21]

# Air quality stations within this radius count towards a city's measured PM2.5.
STATION_RADIUS_KM = 35.0

OVERTURE_RELEASE = "2026-10-21.0"

# Display names for Overture region codes. Districts in India and divisions in
# Pakistan differ hugely in size, so rankings are shown at this level.
REGION_NAMES = {
    "IN-PB": "Punjab (India)", "PK-PB": "Punjab (Pakistan)", "IN-HR": "Haryana", "IN-UP": "Uttar Pradesh",
    "IN-RJ": "Rajasthan", "IN-MP": "Madhya Pradesh", "IN-DL": "Delhi", "IN-UK": "Uttarakhand",
    "IN-HP": "Himachal Pradesh", "IN-JK": "Jammu and Kashmir", "IN-LA": "Ladakh", "IN-CH": "Chandigarh",
    "IN-GJ": "Gujarat", "IN-BR": "Bihar", "IN-CG": "Chhattisgarh", "IN-JH": "Jharkhand", "IN-MH": "Maharashtra",
    "IN-OD": "Odisha", "IN-WB": "West Bengal",
    "PK-SD": "Sindh", "PK-KP": "Khyber Pakhtunkhwa", "PK-BA": "Balochistan",
    "PK-GB": "Gilgit-Baltistan", "PK-JK": "Kashmir (Pakistan-administered)",
}
