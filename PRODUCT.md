# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + TypeScript + MapLibre GL JS, all libraries bundled (no CDN). Static site on Amazon S3 behind Amazon CloudFront; data files produced by a Python pipeline (local backfill, daily AWS Lambda). Amazon Location Service supplies the basemap (Maps v2, `political-view=IND`), place search, reverse geocoding and routes, via a referrer-restricted API key.

## Users

Primary: residents of North India's Indo-Gangetic plain (Delhi, Chandigarh, Lucknow, Lahore and the towns between) who are asking, during the October–November smog season, "why is the air bad today, and where did it come from?". Secondary: journalists and researchers who need a quick, citable way to show where a city's air travelled before it arrived. Evaluators: AWS *Map It* challenge judges (AI scoring plus human panel) assessing originality, craft, usefulness and storytelling, mostly via a sub-3-minute video and the live URL.

## Product Purpose

Whose Smoke Is It? traces the air a place is breathing back along the wind for 48 hours and shows the satellite-detected farm fires it crossed, the districts those fires were in, and the measured PM2.5 when it arrived. In forward mode it shows where a fire's smoke went and how many people live in the towns beneath it. Success: a visitor can pick a day or their own town and, within a minute, see for themselves whether smoke from fires was on its way to them, and on which days the air came from clean places instead.

## Positioning

Pollution maps show readings; fire maps show fires. This links them through the wind, per hour, for any point the visitor clicks, and lets them check the link against measured station data across the whole season. Built entirely on open data from the Registry of Open Data on AWS (NOAA JPSS VIIRS active fires, OpenAQ, Overture Maps) plus Open-Meteo winds, so the pattern is reusable for any smoke-affected city worldwide.

## Operating Context

Visitors arrive from a shared link, social post or the hackathon page, often on a phone, often during a smog episode. They explore by scrubbing a season timeline, clicking anywhere on the map, searching their locality, and switching between "where did this air come from" and "where did this smoke go". A guided tour (`?tour=1`) plays the story automatically and also drives the demo video.

## Capabilities and Constraints

- Season coverage from 1 October 2026, refreshed daily; air-quality archive lags ~3 days, so the latest days show modelled (CAMS) PM2.5, always labelled as model.
- Trajectories are a simplified kinematic model (two wind levels, 0.5° grid, 10-member ensemble). They are indicative, not a dispersion model; the interface must say so.
- Correlation between fire exposure and PM2.5 is shown from measured data only. No causal claim, no percentage "blame" attribution.
- Satellites miss small fires and fires under cloud; counts are lower bounds.
- Map boundaries follow India's political view.
- Amazon Location place results are used live and never stored.

## Brand Commitments

- Name: "Whose Smoke Is It?".
- Stance: neutral, no blame. Farmers burn stubble because the window between rice harvest and wheat sowing is short; the product shows where smoke travels, it does not accuse districts, states or countries. Wording like "fire activity along the air's path" rather than "caused by".
- Smoke crosses borders; Lahore is a preset city alongside Indian cities.

## Evidence on Hand

- Prototype finding (26–31 Oct 2026, Delhi): fires on the 48 h path vs PM2.5 rank correlation 0.94 over 6 days; 435 fires on path → PM2.5 85 (modelled) / 104 measured at Punjabi Bagh; 10 fires → 29. Final numbers must be recomputed from the season pipeline and measured data before use.
- 725 PM2.5 stations in the region from the OpenAQ archive (93 within 35 km of Delhi).
- 407 districts and 787 towns (pop ≥ 20,000) from Overture Maps 2026-10-21.0.
- No testimonials, users, press or partner endorsements exist; none may be invented.

## Product Principles

1. Show the path, let people judge: every number is clickable back to the fires and the air path behind it.
2. Honest uncertainty: show the ensemble spread and label model data; never imply precision the method lacks.
3. Neutral language about people; precise language about data.
4. Any place, any hour: presets are shortcuts, not limits.
5. Reusable: one config file and one deploy re-points it at another smoke-affected region.

## Accessibility & Inclusion

Colour scales must stay legible for colour-vision deficiency (fires and PM2.5 categories distinguishable by lightness, not hue alone). Full keyboard path through timeline, search and tour. Works on mid-range Android phones on mobile data: small first load, data loaded lazily.
