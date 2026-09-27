# Friendly Neighborhood

USC Origin Weekend, Fall 2026. Prompt D: *How can we detect infrastructure damage and failures before they become expensive, and rapidly prioritize recovery when they occur?*

When a home burns, its water line stays open and keeps draining the system the hydrants depend on. Friendly Neighborhood is a device that shuts off a destroyed home's water service automatically. This repository holds the website: a landing page that replays the first 24 hours of the January 2025 Palisades Fire on real data, and (in progress) a utility dashboard.

## What's here

| Path | What it is |
|---|---|
| `index.html` | The landing page. Built, self-contained, opens offline. |
| `dashboard/` | Utility dashboard (placeholder). |
| `src/landing.html` | Page template. |
| `src/sim.js` | Water model, shared by the page and the calibration script. |
| `scripts/build_data.py` | Turns `data/raw/` into the map assets in `data/build/`. |
| `scripts/build_page.py` | Inlines the model and data into `index.html`. |
| `scripts/calibrate.js` | Runs the model against the public record. |
| `data/raw/` | Source data and its README (sources, fields, caveats). |

## Build

```bash
pip install numpy scipy pillow matplotlib rasterio
python3 scripts/build_data.py     # data/raw -> data/build/landing-data.json
python3 scripts/build_page.py     # -> index.html
node scripts/calibrate.js         # optional: compare with the record
```

Open `index.html` in a browser. To host it, enable GitHub Pages on the main branch (root folder).

## The model, briefly

Structures come from CAL FIRE's damage inspection (DINS). Fire arrival times are estimated from the georeferenced CAL FIRE progression map. Each structure and hydrant gets a pressure zone (529, 720, 1137, 1345, 1645 ft hydraulic grade) from its ground elevation.

Every 5 minutes the model computes demand in each zone: leaks from destroyed homes (proportional to the square root of local pressure), firefighting draw, and normal use. All water comes through the Westgate trunk; pumps lift it to the Marquez Knolls, Trailer and Temescal tanks and throttle down as their intake pressure falls. Tank levels set hillside pressure.

The "What happened" run is calibrated once to the public record (tank run-dry times 4:45 PM / 8:30 PM / 3:00 AM; about 20% of hydrants losing water, mostly at higher elevations; trunk flow under 37,000 gpm). Valve runs use the same settings. The leak rate per destroyed home has no public figure; it is a calibrated assumption. All model outputs are labelled as estimates on the page.

## Sources

See the Sources section on the page and `data/raw/README_palisades_map_data.md`.
