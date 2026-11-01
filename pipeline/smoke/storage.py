"""Tiny storage abstraction: the same code writes to a local folder or S3."""
import gzip
import os
from pathlib import Path

# Served pre-compressed so CloudFront and browsers handle binary + JSON alike.
COMPRESS_TYPES = {"application/json", "application/octet-stream", "application/geo+json"}


class Store:
    def __init__(self, root: str):
        self.root = root
        self.s3 = None
        if root.startswith("s3://"):
            import boto3

            self.bucket, _, self.prefix = root[5:].partition("/")
            self.s3 = boto3.client("s3")

    def _key(self, key: str) -> str:
        return f"{self.prefix.rstrip('/')}/{key}" if self.prefix else key

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream",
            cache: str = "public, max-age=300") -> None:
        if self.s3 is None:
            path = Path(self.root) / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return
        extra = {"ContentType": content_type, "CacheControl": cache}
        if content_type in COMPRESS_TYPES:
            data = gzip.compress(data, mtime=0)
            extra["ContentEncoding"] = "gzip"
        self.s3.put_object(Bucket=self.bucket, Key=self._key(key), Body=data, **extra)

    def get(self, key: str):
        if self.s3 is None:
            path = Path(self.root) / key
            return path.read_bytes() if path.exists() else None
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=self._key(key))
        except self.s3.exceptions.NoSuchKey:
            return None
        body = obj["Body"].read()
        return gzip.decompress(body) if obj.get("ContentEncoding") == "gzip" else body


def default_stores():
    """Raw cache + public site data locations, from env or local defaults."""
    root = Path(__file__).resolve().parents[2]
    raw = os.environ.get("RAW_STORE", str(root / "cache"))
    site = os.environ.get("SITE_STORE", str(root / "web" / "public" / "data"))
    return Store(raw), Store(site)
