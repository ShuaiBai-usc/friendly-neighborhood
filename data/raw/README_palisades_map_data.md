# Palisades Fire map data — Friendly Neighborhood landing page

Prepared 2026-09-26. Bounding box: lon -118.60 to -118.49, lat 34.02 to 34.10 (EPSG:4326). All vector files are GeoJSON in WGS84.

## Files

| File | Features | Notes |
|---|---|---|
| palisades_structures_dins.geojson | 10,078 points | CAL FIRE DINS 2025 Palisades (POSTFIRE layer), clipped to bbox |
| palisades_hydrants.geojson | 1,170 points | 1,004 LADWP + 166 LA County Fire layer (deduplicated) |
| palisades_fire_perimeter.geojson | 1 MultiPolygon | CAL FIRE final perimeter, clipped to bbox |
| palisades_contours_100ft.geojson | 311 lines | Derived from the DEM, 100 ft interval, `major` = every 500 ft |
| palisades_dem_3dep_13as.tif | 1188 x 864 px raster | USGS 3DEP 1/3 arc-second (~10 m), float32 meters, NAD83 |
| ladwp_prelim_report_fig1_system_map.png | image | LADWP report Figure 1 (pressure zones, pump stations, tanks) |
| ladwp_prelim_report_fig2_tank_storage.png | image | LADWP report Figure 2 (tank storage table) |

## Fields

**Structures**: OBJECTID, GLOBALID, DAMAGE (5 CAL FIRE classes), damage_level (0 = No Damage ... 4 = Destroyed), destroyed (bool), STRUCTURETYPE, in_perimeter (bool), elev_m, elev_ft, source. The public DINS view exposes only these four original attributes (no address, year built, etc.).

Damage in bbox: Destroyed 5,923 · No Damage 3,383 · Affected 574 · Minor 138 · Major 60. 8,802 of the points fall inside the final perimeter.

**Hydrants**: hydrant_id, operator, size_code, make, main_size_in, corner, street, cross_street, in_perimeter, elev_m, elev_ft, source. Street/corner fields are filled for the 829 hydrants that are also in the City BOE "Palisades Recovery Area" layer; county hydrants have only id and size_code. 654 hydrants are inside the perimeter.

**Perimeter**: FIRE_NAME, YEAR, AGENCY, UNIT_ID, INC_NUM, IRWINID, ALARM_DATE (2025-01-07), CONT_DATE (2025-01-31), official_gis_acres_full_fire (23,448.88), clipped_acres (~13,151), source.

## Caveats

- The bbox covers only ~55% of the fire area. The fire extends west to about -118.686 and north to about 34.129 (Topanga / Malibu side). DINS has 12,081 structures in total; 2,003 are outside the bbox.
- The official LA GeoHub hydrant service (maps.lacity.org) was not reachable from the sandbox. The LADWP hydrants come from an ArcGIS Online copy of the GeoHub layer (same schema). All 829 hydrant IDs in the official City BOE Palisades layer match this copy exactly (location difference ~1 cm). Swap in the GeoHub original before launch if possible.
- County hydrants within 30 m of an LADWP hydrant (97 points) were dropped as duplicates; LADWP hydrant nearest-neighbor spacing is ~40 m at the 5th percentile.
- Elevations are sampled from the DEM at each point (bare-earth ground elevation, not the building or hydrant top). No points had nodata.
- LADWP Figure 1 is a low-resolution (624 x 364) schematic image, not GIS data. Pressure zones, pump stations and tanks have NOT been digitized; doing so would require manual georeferencing. Key facts from the report text: pressure zones are named by hydraulic grade in feet (e.g. 720, 1137, 1345, 1645); pump stations Marquez Knolls (zone 720), Santa Ynez (1345), Trailer (1645); ~1 MG tanks Marquez Knolls, Trailer, Temescal; Santa Ynez Reservoir (offline, drained during the fire); Palisades Reservoir (out of service since 2013). Westgate Trunk Line runs east-west through the area.

## Sources

- CAL FIRE DINS: services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/DINS_2025_Palisades_Public_View/FeatureServer/0
- LADWP hydrants (copy): services.arcgis.com/tKsJAIiLjd90D5q2/arcgis/rest/services/Fire_Hydrants_(DWP)/FeatureServer/0
- City BOE Palisades hydrants: services5.arcgis.com/7nsPwEMP38bSkCjy/arcgis/rest/services/DWP_Fire_Hydrants_Import_Palisades_Recovery_Area/FeatureServer/0
- LA County Fire hydrants: arcgis.gis.lacounty.gov/arcgis/rest/services/Fire/Fire_Hydrants/MapServer/0
- Perimeter: services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/2025_California_Fire_Perimeters_View/FeatureServer/0 (OBJECTID 5); identical to NIFC WFIGS Interagency Perimeters OBJECTID 36398
- LADWP Palisades Fire Water System Preliminary Report (July 3, 2025): https://ladwpnews.com/ladwp-palisades-fire-water-system-preliminary-report-july-3-2025/
- USGS 3DEP 1/3 arc-second, tile n35w119 (current): prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n35w119/USGS_13_n35w119.tif

## Update: estimated fire arrival time (added 2026-09-26)

Structures now carry `fire_class`, `fire_arrival_est` (local time, ISO) and `fire_arrival_hours` (hours after the 10:30 AM Jan 7 ignition). These are ESTIMATES:

- Source: CAL FIRE IMT2 progression map, Palisades Incident, dated Jan 19 2025 (image in `palisades_fire_progression_map.png`).
- The map was georeferenced by fitting it to the official perimeter (intersection-over-union 0.92 inside the bbox).
- The second band is labelled "January 8 - 17:00" on the map but covers the area burned by 5 PM on Jan 7 (per the note in The Lookout's progression review, https://the-lookout.org/?p=6082); it is stored as Jan 7 17:00.
- Within a band, time is interpolated by distance between the previous and current band edges. The third band (Jan 8 23:00) is a mapping time, not a burn time: much of it burned overnight Jan 7-8, so arrival times in that band are the least certain.
- Ignition proxy: northern tip of the earliest band, about lon -118.5452, lat 34.0762 (near Skull Rock). Stored in the file's `metadata`.
- Structures outside the perimeter with no damage have null times.

## Update: estimated pressure zone and static pressure (added 2026-09-26)

Hydrants and structures now carry `pressure_zone_est` and `static_psi_est`. These are ESTIMATES from elevation only; LADWP zone boundaries were not digitized.

- Zones used: 529, 720, 1137, 1345, 1645 (named by hydraulic grade in feet, LADWP preliminary report Figure 1). The real system also has smaller low zones (310, 375, 440, 498, 610); they are folded into 529.
- Rule: each point goes to the lowest zone whose grade is at least 100 ft (about 43 psi) above ground. Points higher than 1,545 ft stay in 1645 (4 hydrants, 9 structures).
- `static_psi_est` = 0.433 x (zone grade - ground elevation). This is the no-flow pressure before the fire; low coastal points in zone 529 get high values because pressure-reducing valves are not modelled.
- Hydrants by zone: 529: 641, 720: 147, 1137: 263, 1345: 65, 1645: 54.
