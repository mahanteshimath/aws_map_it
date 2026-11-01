"""AWS Lambda entry point: daily refresh of the season, then a CloudFront invalidation."""
import datetime as dt
import logging
import os
import time

import boto3

from smoke import run
from smoke.config import SEASON_START
from smoke.lake import write_tables

logging.getLogger().setLevel(logging.INFO)


def handler(event, context):
    end = dt.datetime.now(dt.timezone.utc).date()
    start = dt.date.fromisoformat(event.get("start", SEASON_START.isoformat()))
    sink = write_tables if os.environ.get("TABLE_BUCKET_ARN") and event.get("iceberg", True) else None
    stats = run.run(start, end, refresh_days=int(event.get("refresh_days", 3)), iceberg=sink)
    dist = os.environ.get("DISTRIBUTION_ID")
    if dist:
        boto3.client("cloudfront").create_invalidation(DistributionId=dist, InvalidationBatch={
            "Paths": {"Quantity": 1, "Items": ["/data/*"]}, "CallerReference": str(time.time())})
    return {cid: {k: v for k, v in s.items() if k in ("days_measured", "spearman_detrended")}
            for cid, s in stats.items()}
