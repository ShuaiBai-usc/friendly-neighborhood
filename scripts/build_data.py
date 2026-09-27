"""Build the landing-page map data from data/raw/.

Outputs data/build/landing-data.json:
  - basemap: dark hillshade + 100 ft contours + ocean, JPEG data URI
  - zones:   PNG data URI, red channel = zone index (1..5) where homes are served, 0 elsewhere
  - houses / hydrants: packed typed arrays (base64) in map pixel space
All derived values stay labelled as estimates in the page.

Run: python3 scripts/build_data.py
"""
import base64, io, json, math
import numpy as np
import rasterio
from rasterio.transform import rowcol
from scipy import ndimage
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

RAW = "data/raw/"
OUT = "data/build/landing-data.json"

# Map window (WGS84). Covers Pacific Palisades core, Marquez Knolls, Palisades Highlands.
LON0, LON1, LAT0, LAT1 = -118.580, -118.505, 34.030, 34.083
WIDTH = 1200
LATC = (LAT0 + LAT1) / 2
KX = math.cos(math.radians(LATC))
HEIGHT = round(WIDTH * (LAT1 - LAT0) / ((LON1 - LON0) * KX))
M_PER_PX = (LON1 - LON0) * KX * 111320 / WIDTH

ZONES = [529, 720, 1137, 1345, 1645]  # hydraulic grade, ft (LADWP prelim. report Fig. 1)


def px(lon, lat):
    return (lon - LON0) / (LON1 - LON0) * WIDTH, (LAT1 - lat) / (LAT1 - LAT0) * HEIGHT


def zone_idx(elev_ft):
    for i, z in enumerate(ZONES):
        if z - elev_ft >= 100:
            return i
    return len(ZONES) - 1


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()


def data_uri(img, fmt, **kw):
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()


# ---------- DEM resampled to the map grid ----------
src = rasterio.open(RAW + "palisades_dem_3dep_13as.tif")
dem = src.read(1).astype("float64")
dem[dem < -1000] = 0
gx = LON0 + (np.arange(WIDTH) + 0.5) / WIDTH * (LON1 - LON0)
gy = LAT1 - (np.arange(HEIGHT) + 0.5) / HEIGHT * (LAT1 - LAT0)
t = src.transform
cols = (gx - t.c) / t.a - 0.5
rows = (gy - t.f) / t.e - 0.5
C, R = np.meshgrid(cols, rows)
elev_m = ndimage.map_coordinates(dem, [R, C], order=1, mode="nearest")
elev_ft = elev_m / 0.3048
ocean = elev_m <= 0.0
ocean = ndimage.binary_opening(ocean, iterations=2)

# ---------- hillshade (sun from the north-west) ----------
dzdy, dzdx = np.gradient(elev_m, M_PER_PX)
slope = np.arctan(np.hypot(dzdx, dzdy) * 1.6)
aspect = np.arctan2(-dzdx, dzdy)
az, alt = math.radians(315), math.radians(40)
shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
shade = np.clip(shade, 0, 1)

land = np.array([0x0C, 0x0C, 0x0B], float) / 255
light = np.array([0x3A, 0x3A, 0x37], float) / 255
sea = np.array([0x00, 0x00, 0x00], float) / 255
k = (shade ** 1.4)[..., None]
rgb = land * (1 - k) + light * k
rgb[ocean] = sea

dpi = 100
fig = plt.figure(figsize=(WIDTH / dpi, HEIGHT / dpi), dpi=dpi)
ax = fig.add_axes([0, 0, 1, 1])
ax.imshow(rgb, extent=(0, WIDTH, HEIGHT, 0), interpolation="bilinear")
land_elev = np.where(ocean, np.nan, elev_ft)
ax.contour(np.arange(WIDTH) + 0.5, np.arange(HEIGHT) + 0.5, land_elev,
           levels=[l for l in range(100, 2000, 100) if l % 500], colors=["#55554F"],
           linewidths=0.35, alpha=0.5)
ax.contour(np.arange(WIDTH) + 0.5, np.arange(HEIGHT) + 0.5, land_elev,
           levels=[500, 1000, 1500], colors=["#8A8A82"], linewidths=0.7, alpha=0.65)
ax.set_xlim(0, WIDTH); ax.set_ylim(HEIGHT, 0); ax.axis("off")
buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=dpi); plt.close(fig)
base = Image.open(buf).convert("RGB").resize((WIDTH, HEIGHT))

# ---------- structures ----------
S = json.load(open(RAW + "palisades_structures_dins.geojson"))["features"]
houses = []
for f in S:
    lon, lat = f["geometry"]["coordinates"]
    if not (LON0 <= lon <= LON1 and LAT0 <= lat <= LAT1):
        continue
    p = f["properties"]
    x, y = px(lon, lat)
    arr = p.get("fire_arrival_hours")
    houses.append((x, y, p["elev_ft"], zone_idx(p["elev_ft"]), p["damage_level"],
                   65535 if arr is None else int(round(arr * 60))))
houses.sort(key=lambda h: h[5])
H = np.array(houses, dtype="float64")
hx = np.round(H[:, 0] * 4).astype("<u2")
hy = np.round(H[:, 1] * 4).astype("<u2")
helev = np.round(H[:, 2]).astype("<u2")
hzone = H[:, 3].astype("u1")
hdmg = H[:, 4].astype("u1")
harr = H[:, 5].astype("<u2")

# ---------- served-area zone raster ----------
occ = np.zeros((HEIGHT, WIDTH), bool)
occ[np.clip(H[:, 1].astype(int), 0, HEIGHT - 1), np.clip(H[:, 0].astype(int), 0, WIDTH - 1)] = True
served = ndimage.distance_transform_edt(~occ) * M_PER_PX <= 75
served = ndimage.binary_closing(served, iterations=3) & ~ocean
zgrid = np.zeros((HEIGHT, WIDTH), np.uint8)
for i, z in reversed(list(enumerate(ZONES))):
    zgrid[(z - elev_ft >= 100)] = i + 1
zgrid[zgrid == 0] = len(ZONES)
zgrid[~served] = 0
zone_labels = []
for i in range(len(ZONES)):
    lab, n = ndimage.label(zgrid == i + 1)
    if n == 0:
        zone_labels.append(None); continue
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    ys, xs = np.where(lab == int(np.argmax(sizes)) + 1)
    # label point: the pixel of the largest blob closest to its centroid
    cx, cy = xs.mean(), ys.mean(); j = int(np.argmin((xs - cx) ** 2 + (ys - cy) ** 2))
    zone_labels.append([int(xs[j]), int(ys[j])])
zimg = Image.fromarray(np.dstack([zgrid, zgrid, zgrid, np.full_like(zgrid, 255)]), "RGBA")

# ---------- hydrants ----------
HY = json.load(open(RAW + "palisades_hydrants.geojson"))["features"]
hyd = []
for f in HY:
    lon, lat = f["geometry"]["coordinates"]
    if not (LON0 <= lon <= LON1 and LAT0 <= lat <= LAT1):
        continue
    p = f["properties"]
    x, y = px(lon, lat)
    label = None
    if p.get("street"):
        label = p["street"].title().replace(" Pvt", "").replace(" Pl ", " Place ").strip()
    hyd.append(dict(x=x, y=y, elev=p["elev_ft"], zone=zone_idx(p["elev_ft"]), label=label,
                    id=p.get("hydrant_id")))

# Representative hydrant: Marquez Knolls zone (1137), normal static pressure about 80 psi,
# street-labelled, closest to the homes that burned first.
early = H[(H[:, 5] < 8 * 60) & (H[:, 4] == 4)]
z2 = [0.433 * (ZONES[2] - h["elev"]) for h in hyd if h["zone"] == 2]
med = float(np.median(z2))
def score(h):
    st = 0.433 * (ZONES[h["zone"]] - h["elev"])
    if h["zone"] != 2 or not h["label"] or abs(st - 80) > 10:
        return 1e9
    return np.min(np.hypot(early[:, 0] - h["x"], early[:, 1] - h["y"])) if len(early) else 0
rep = min(range(len(hyd)), key=lambda i: score(hyd[i]))
print("zone 1137 median static psi", round(med, 1))

yx = np.round(np.array([h["x"] for h in hyd]) * 4).astype("<u2")
yy = np.round(np.array([h["y"] for h in hyd]) * 4).astype("<u2")
yelev = np.round(np.array([h["elev"] for h in hyd])).astype("<u2")
yzone = np.array([h["zone"] for h in hyd], "u1")

out = dict(
    window=dict(lon0=LON0, lon1=LON1, lat0=LAT0, lat1=LAT1, width=WIDTH, height=HEIGHT, m_per_px=M_PER_PX),
    zones=ZONES,
    basemap=data_uri(base, "JPEG", quality=82, optimize=True, progressive=True),
    zonemap=data_uri(zimg, "PNG", optimize=True),
    houses=dict(n=len(houses), x=b64(hx), y=b64(hy), elev=b64(helev), zone=b64(hzone), dmg=b64(hdmg), arr=b64(harr)),
    hydrants=dict(n=len(hyd), x=b64(yx), y=b64(yy), elev=b64(yelev), zone=b64(yzone)),
    rep=dict(index=rep, label=hyd[rep]["label"], id=hyd[rep]["id"], elev=hyd[rep]["elev"], zone=ZONES[hyd[rep]["zone"]]),
    ignition=px(-118.5452, 34.0762),
    zoneLabels=zone_labels,
)
json.dump(out, open(OUT, "w"))
print(f"map {WIDTH}x{HEIGHT}, {M_PER_PX:.1f} m/px; houses {len(houses)} (destroyed {int((hdmg==4).sum())}); hydrants {len(hyd)}")
print("representative hydrant:", out["rep"])
print("sizes KB: basemap", len(out["basemap"]) // 1024, "zonemap", len(out["zonemap"]) // 1024,
      "total", len(json.dumps(out)) // 1024)
