// Check the "What happened" run against the public record, then show the valve runs.
// Usage: node scripts/calibrate.js ['{"leakGpm":30}']
const fs = require("fs");
const Sim = require("../src/sim.js");
const d = JSON.parse(fs.readFileSync("data/build/landing-data.json"));
const dec = (s, T) => { const b = Buffer.from(s, "base64"); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const houses = { n: d.houses.n, elev: dec(d.houses.elev, Uint16Array), zone: dec(d.houses.zone, Uint8Array), dmg: dec(d.houses.dmg, Uint8Array), arr: dec(d.houses.arr, Uint16Array) };
const hyd = { n: d.hydrants.n, elev: dec(d.hydrants.elev, Uint16Array), zone: dec(d.hydrants.zone, Uint8Array) };
const prep = Sim.prepare({ zones: d.zones, houses });
const over = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const Z = d.zones.length, clock = k => { const m = 630 + (k + 1) * 5; const hh = Math.floor(m / 60) % 24, mm = m % 60; return `${(hh % 12) || 12}:${String(mm).padStart(2, "0")}${hh < 12 ? "am" : "pm"}`; };

function report(ad) {
  const t0 = Date.now(); const r = Sim.run(prep, ad, over); const ms = Date.now() - t0;
  const N = r.open.length, rep = d.rep.index;
  const repPsi = k => Sim.psiAt(r, k, hyd.zone[rep], hyd.elev[rep], Z);
  const below = [...Array(N).keys()].find(k => repPsi(k) < 20);
  const usable = [...Array(N).keys()].filter(k => repPsi(k) >= 20).length * 5;
  const empty = [2, 3, 4].map(z => { const k = [...Array(N).keys()].find(k => r.tank[k * Z + z] < 0.01); return `${d.zones[z]}:${k === undefined ? "never" : clock(k)}`; });
  const frac = (k, lim) => { let c = 0; for (let i = 0; i < hyd.n; i++) if (Sim.psiAt(r, k, hyd.zone[i], hyd.elev[i], Z) < lim) c++; return (100 * c / hyd.n).toFixed(0) + "%"; };
  console.log(`adoption ${ad * 100}% (${ms} ms): rep<20psi at ${below === undefined ? "never" : clock(below)}, usable ${usable} min; tanks empty ${empty.join(" ")}; ` +
    `hydrants <20psi @6:30pm ${frac(95, 20)} @midnight ${frac(161, 20)} @end ${frac(N - 1, 20)}, dry(<5) @end ${frac(N - 1, 5)}; open@6:30pm ${r.open[95]}; lost ${(r.lostGal[N - 1] / 1e6).toFixed(1)} MG; ` +
    `heads@6:30pm ${[...Array(Z).keys()].map(z => r.head[95 * Z + z].toFixed(0)).join("/")}`);
}
[0, 0.25, 0.5, 1].forEach(report);
