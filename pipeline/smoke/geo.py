"""Districts and towns from Overture Maps (Registry of Open Data on AWS).

Districts (Overture 'county' areas; Pakistan publishes divisions at that
level) are used to name where smoke came from. Towns with a population are
used to count people downwind in forward mode. Both are extracted once per
Overture release and cached.
"""
import io
import json
import os

import duckdb
import pandas as pd

from .config import OVERTURE_RELEASE, REGION

BASE = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=divisions"
COUNTRIES = ("IN", "PK")
MIN_TOWN_POP = 20_000


def _con():
    con = duckdb.connect()
    if os.environ.get("DUCKDB_EXT_DIR"):
        con.execute(f"SET extension_directory='{os.environ['DUCKDB_EXT_DIR']}'")
    else:
        con.execute("INSTALL httpfs; INSTALL spatial;")
    con.execute("LOAD httpfs; LOAD spatial; SET s3_region='us-west-2';")
    return con


def _bbox_filter():
    r = REGION
    return (f"bbox.xmin < {r['lon_max']} AND bbox.xmax > {r['lon_min']} "
            f"AND bbox.ymin < {r['lat_max']} AND bbox.ymax > {r['lat_min']}")


def extract(con=None):
    con = con or _con()
    countries = ",".join(f"'{c}'" for c in COUNTRIES)
    districts = con.execute(f"""
        SELECT division_id AS id, country, region,
               coalesce(names.common['en'], names.primary) AS name,
               ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, 0.01)) AS geom
        FROM read_parquet('{BASE}/type=division_area/*', hive_partitioning=1)
        WHERE subtype = 'county' AND is_land AND country IN ({countries}) AND {_bbox_filter()}
        QUALIFY row_number() OVER (PARTITION BY division_id ORDER BY ST_Area(geometry) DESC) = 1
        ORDER BY country, region, name
    """).df()
    towns = con.execute(f"""
        SELECT coalesce(names.common['en'], names.primary) AS name, country, region,
               round(ST_Y(geometry), 4) AS lat, round(ST_X(geometry), 4) AS lon,
               CAST(population AS BIGINT) AS pop
        FROM read_parquet('{BASE}/type=division/*', hive_partitioning=1)
        WHERE subtype = 'locality' AND population >= {MIN_TOWN_POP}
          AND country IN ({countries}) AND {_bbox_filter()}
        QUALIFY row_number() OVER (PARTITION BY round(ST_Y(geometry), 2), round(ST_X(geometry), 2)
                                   ORDER BY population DESC) = 1
        ORDER BY pop DESC
    """).df()
    return districts, towns


def districts_geojson(districts: pd.DataFrame) -> dict:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": i, "geometry": json.loads(row.geom),
         "properties": {"i": i, "name": row["name"], "region": row.region, "country": row.country}}
        for i, row in districts.reset_index(drop=True).iterrows()]}


def assign_districts(fires: pd.DataFrame, districts: pd.DataFrame, con=None) -> pd.Series:
    """Index into `districts` for each fire, -1 when outside every district."""
    if fires.empty:
        return pd.Series([], dtype="int32")
    con = con or _con()
    con.register("d_raw", districts.reset_index(drop=True).assign(i=range(len(districts)))[["i", "geom"]])
    con.execute("CREATE OR REPLACE TEMP TABLE d AS SELECT i, ST_GeomFromGeoJSON(geom) g FROM d_raw")
    con.register("f", fires[["lat", "lon"]].reset_index(drop=True).assign(k=range(len(fires))))
    hit = con.execute("""
        SELECT f.k, min(d.i) AS i FROM f JOIN d ON ST_Contains(d.g, ST_Point(f.lon, f.lat))
        GROUP BY f.k
    """).df()
    out = pd.Series(-1, index=range(len(fires)), dtype="int32")
    out.loc[hit.k.values] = hit.i.values.astype("int32")
    return out


def cached_geo(raw_store, refresh: bool = False):
    dkey, tkey = f"geo/districts-{OVERTURE_RELEASE}.parquet", f"geo/towns-{OVERTURE_RELEASE}.parquet"
    if not refresh and raw_store.get(dkey) is not None:
        return pd.read_parquet(io.BytesIO(raw_store.get(dkey))), pd.read_parquet(io.BytesIO(raw_store.get(tkey)))
    districts, towns = extract()
    for key, df in ((dkey, districts), (tkey, towns)):
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        raw_store.put(key, buf.getvalue())
    return districts, towns
