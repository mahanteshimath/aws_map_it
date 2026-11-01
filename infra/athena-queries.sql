-- Amazon Athena over the S3 Tables (Apache Iceberg) lake written by the daily Lambda.
-- Catalog: s3tablescatalog/whose-smoke-lake   Database: air   Workgroup: whose-smoke

-- 1. Season leaderboard: where was the fire activity that Delhi's air crossed?
SELECT region, name AS district, round(100 * share, 1) AS pct_of_delhi_fire_activity
FROM "s3tablescatalog/whose-smoke-lake"."air"."district_share"
WHERE city = 'delhi'
ORDER BY share DESC
LIMIT 10;

-- 2. Daily fire exposure vs measured PM2.5 for every preset city.
SELECT city, date(t) AS day,
       round(avg(fires), 1) AS fires_on_path,
       round(avg(pm_obs), 0) AS pm25_measured,
       round(avg(pm_model), 0) AS pm25_model
FROM "s3tablescatalog/whose-smoke-lake"."air"."exposure"
GROUP BY city, date(t)
ORDER BY city, day;

-- 3. Fires by state/province and day (NOAA VIIRS, de-duplicated across satellites).
SELECT date(time) AS day, region, count(*) AS fires, round(sum(frp)) AS total_frp_mw
FROM "s3tablescatalog/whose-smoke-lake"."air"."fires"
WHERE region IN ('IN-PB', 'PK-PB', 'IN-HR', 'IN-UP')
GROUP BY 1, 2
ORDER BY 1, 2;

-- 4. Iceberg time travel: what the fire table looked like after an earlier daily run.
SELECT snapshot_id, committed_at, summary['added-records'] AS added
FROM "s3tablescatalog/whose-smoke-lake"."air"."fires$snapshots"
ORDER BY committed_at DESC;
