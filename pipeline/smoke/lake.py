"""Write the season tables to Amazon S3 Tables (Apache Iceberg) through the S3 Tables
Iceberg REST endpoint. Each pipeline run overwrites the tables, so every daily
refresh becomes an Iceberg snapshot you can time-travel to from Athena."""
import logging
import os

import pandas as pd
import pyarrow as pa

log = logging.getLogger("smoke")
NAMESPACE = "air"


def _catalog():
    from pyiceberg.catalog import load_catalog

    region = os.environ.get("AWS_REGION", "ap-south-1")
    return load_catalog("s3tables", **{
        "type": "rest",
        "warehouse": os.environ["TABLE_BUCKET_ARN"],
        "uri": f"https://s3tables.{region}.amazonaws.com/iceberg",
        "rest.sigv4-enabled": "true",
        "rest.signing-name": "s3tables",
        "rest.signing-region": region,
    })


def _overwrite(catalog, name: str, df: pd.DataFrame):
    table_arrow = pa.Table.from_pandas(df, preserve_index=False)
    ident = (NAMESPACE, name)
    if not catalog.table_exists(ident):
        catalog.create_table(ident, schema=table_arrow.schema)
    table = catalog.load_table(ident)
    table.overwrite(table_arrow)
    log.info("iceberg %s.%s <- %d rows (snapshot %s)", NAMESPACE, name, len(df),
             table.current_snapshot().snapshot_id if table.current_snapshot() else None)


def write_tables(all_fires, hourly, stations, results, districts):
    catalog = _catalog()
    catalog.create_namespace_if_not_exists(NAMESPACE)
    d = districts.reset_index(drop=True)
    fires = all_fires.assign(
        district=[d.name.iloc[i] if i >= 0 else None for i in all_fires.district],
        region=[d.region.iloc[i] if i >= 0 else None for i in all_fires.district],
        time=all_fires.time.astype("datetime64[us]"),
    )[["time", "lat", "lon", "frp", "day", "nsat", "district", "region"]].astype({"day": "int32", "nsat": "int32"})
    _overwrite(catalog, "fires", fires)
    _overwrite(catalog, "stations", pd.DataFrame(stations)[["id", "name", "lat", "lon"]].astype({"id": "int64"}))
    _overwrite(catalog, "aq_hourly", hourly.assign(time=hourly.time.astype("datetime64[us]"),
                                                   station=hourly.station.astype("int64")))
    exposure = pd.concat([r["series"].assign(city=cid) for cid, r in results.items()], ignore_index=True)
    exposure["t"] = exposure.t.astype("datetime64[us]")
    _overwrite(catalog, "exposure", exposure[["city", "t", "fires", "frp", "pm_obs", "pm_model"]])
    leader = pd.DataFrame([{"city": cid, **row} for cid, r in results.items()
                           for row in r["stats"]["leaderboard"]])
    _overwrite(catalog, "district_share", leader[["city", "name", "region", "share"]])
