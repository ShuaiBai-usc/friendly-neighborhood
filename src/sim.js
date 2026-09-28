/* Friendly Neighborhood — water system model for the Palisades Fire landing page.
 *
 * A deliberately small, explainable model. Every parameter is listed in PARAMS and
 * shown on the page. The "What happened" run (adoption 0) is calibrated to the
 * public record; runs with valves reuse the same parameters (counterfactual).
 *
 * Network (after LADWP preliminary report, Jul 2025):
 *   trunk ──> zone 529 (via pressure-reducing valve)
 *         └─> zone 720 ──pump──> zone 1137 [tank] ──pump──> zone 1345 [tank] ──pump──> zone 1645 [tank]
 * A pump stops when suction pressure on its intake side falls too low.
 * A tank drains when its zone uses more than the pump brings in; its water level sets the zone's head.
 * Leaks from destroyed homes depend on local pressure (orifice flow ~ sqrt(pressure)).
 */
(function (root) {
  const PSI_PER_FT = 0.433;

  const PARAMS = {
    dtMin: 5,                // simulation step, minutes
    steps: 288,              // 24 hours: Jan 7 10:30 AM to Jan 8 10:30 AM
    openDelayMin: 20,        // minutes from fire arrival until a destroyed home's plumbing fails open
    leakGpm: 4,              // ASSUMPTION, calibrated: flow from one open service line at 60 psi (no public figure)
    baseGpmPerHome: 0.4,     // background use by homes still standing
    firePerBurningGpm: 60,   // engine draw per structure burning nearby
    fireCapGpm: [13500, 4500, 4000, 3000, 3000], // max hydrant draw per zone (engines on scene)
    burnMin: 90,             // minutes a structure counts as "burning" for firefighting demand
    defenseGpm: [0, 0, 3250, 2250, 1500], // engines defending a zone while the fire is in it
    defenseMin: 360,         // engines defend a zone at full draw this long after the fire first reaches it
    defenseTaperMin: 480,    // then their draw tapers off linearly over this long (no sudden stop)
    trunkK: 1.2e-7,          // Westgate trunk head loss, ft per gpm^2
    zoneK: [5e-8, 1e-7, 2.2e-6, 4e-6, 6e-6],  // local head loss inside each zone, ft per gpm^2
    pumpGpm: [0, 0, 1800, 1760, 1200],        // pump capacity into zone (1137, 1345, 1645)
    pumpMinSuctionPsi: 10,   // pump delivers nothing below this intake pressure
    pumpRestartPsi: 25,      // and full flow above this one
    tankGal: [0, 0, 1018502, 972118, 972118], // Marquez Knolls, Trailer, Temescal (LADWP report Fig. 2)
    tankDepthFt: [0, 0, 32, 32, 32],
    usablePsi: 20,           // minimum fire engines need
    iterations: 40,          // solver iterations per step
    relax: 0.9,              // solver damping
  };

  function hash01(i) { // deterministic per-home random number in [0,1)
    let x = (i + 1) * 2654435761 >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b) >>> 0; x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  function prepare(data) {
    // data: {zones, houses:{n, elev:Uint16Array, zone:Uint8Array, dmg:Uint8Array, arr:Uint16Array}}
    const G = data.zones, h = data.houses, n = h.n;
    const perZoneElevs = G.map(() => []);
    for (let i = 0; i < n; i++) perZoneElevs[h.zone[i]].push(h.elev[i]);
    const typElev = perZoneElevs.map(a => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.6)] : 0; });
    const homes = G.map(() => 0), firstFire = G.map(() => 65535);
    for (let i = 0; i < n; i++) {
      homes[h.zone[i]]++;
      if (h.dmg[i] >= 1 && h.arr[i] < firstFire[h.zone[i]]) firstFire[h.zone[i]] = h.arr[i];
    }
    return { G, h, n, typElev, homes, firstFire };
  }

  function run(prep, adoption, P) {
    P = Object.assign({}, PARAMS, P || {});
    const { G, h, n, typElev, homes, firstFire } = prep;
    const Z = G.length, dt = P.dtMin, N = P.steps;
    const openAt = new Int32Array(n).fill(-1), valved = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (h.dmg[i] === 4 && h.arr[i] !== 65535) {
        openAt[i] = h.arr[i] + P.openDelayMin;
        if (hash01(i) < adoption) valved[i] = 1;
      }
    }
    // optional crew shut-offs: Int32Array of minutes after ignition when a crew closes home i's line (-1 = never)
    const man = P.manual || null;
    const V = P.tankGal.slice();
    const pumpOn = G.map(() => true);
    let head = G.slice();
    const out = {
      adoption, head: new Float32Array(N * Z), tank: new Float32Array(N * Z),
      open: new Uint16Array(N), closed: new Uint16Array(N), leakGpm: new Float32Array(N),
      lostGal: new Float64Array(N), fireGpm: new Float32Array(N), pumps: new Uint8Array(N), trunkGpm: new Float32Array(N), crew: new Uint16Array(N),
    };
    let lost = 0;
    const openList = G.map(() => []);
    const burning = new Float32Array(Z), standing = new Float32Array(Z);

    for (let k = 0; k < N; k++) {
      const t = (k + 1) * dt;
      for (let z = 0; z < Z; z++) { openList[z].length = 0; burning[z] = 0; standing[z] = homes[z]; }
      let nOpen = 0, nClosed = 0, nCrew = 0;
      for (let i = 0; i < n; i++) {
        const a = h.arr[i];
        if (a === 65535 || a > t) continue;
        const z = h.zone[i];
        if (h.dmg[i] >= 1 && t - a < P.burnMin) burning[z]++;
        if (h.dmg[i] === 4) {
          standing[z]--;
          if (openAt[i] >= 0 && openAt[i] <= t) {
            if (valved[i]) nClosed++;
            else if (man && man[i] >= 0 && man[i] <= t) nCrew++;
            else { openList[z].push(i); nOpen++; }
          }
        }
      }
      // fixed-point solve for heads and flows
      let trunkQ = 0;
      let D = new Array(Z).fill(0), inflow = new Array(Z).fill(0), leak = new Array(Z).fill(0), fire = new Array(Z).fill(0);
      for (let it = 0; it < P.iterations; it++) {
        for (let z = 0; z < Z; z++) {
          let s = 0; const L = openList[z], hz = head[z];
          for (let j = 0; j < L.length; j++) {
            const psi = PSI_PER_FT * (hz - h.elev[L[j]]);
            if (psi > 0) s += Math.sqrt(Math.min(psi / 60, 1.6));
          }
          leak[z] = P.leakGpm * s;
          const pz = PSI_PER_FT * (hz - typElev[z]);
          const since = t - firstFire[z];
          const defending = since < 0 ? 0 : since < P.defenseMin ? P.defenseGpm[z] : P.defenseGpm[z] * Math.max(0, 1 - (since - P.defenseMin) / P.defenseTaperMin);
          fire[z] = Math.min(P.fireCapGpm[z], P.firePerBurningGpm * burning[z] + defending) * Math.max(0, Math.min(1, pz / 40));
          D[z] = leak[z] + fire[z] + P.baseGpmPerHome * standing[z];
        }
        // pumps, top-down: each pump's draw is demand on the zone below
        const Dtot = D.slice();
        for (let z = Z - 1; z >= 2; z--) {
          // pumps throttle smoothly between the trip and full-flow intake pressures
          const s = z - 1, suction = PSI_PER_FT * (head[s] - (G[s] - 150));
          const avail = Math.max(0, Math.min(1, (suction - P.pumpMinSuctionPsi) / (P.pumpRestartPsi - P.pumpMinSuctionPsi)));
          pumpOn[z] = avail > 0;
          const room = (P.tankGal[z] - V[z]) / dt;
          inflow[z] = Math.min(P.pumpGpm[z] * avail, Dtot[z] + room);
          Dtot[s] += inflow[z];
        }
        // everything rides on the Westgate trunk; the coastal 529 zone is fed through a pressure-reducing valve
        const Qt = Dtot[0] + Dtot[1];
        trunkQ = Qt;
        const nh = head.slice();
        const hTrunk = G[1] - P.trunkK * Qt * Qt;
        nh[1] = hTrunk - P.zoneK[1] * Dtot[1] * Dtot[1];
        nh[0] = Math.min(G[0], hTrunk) - P.zoneK[0] * Dtot[0] * Dtot[0];
        for (let z = 2; z < Z; z++) {
          // water available this step = what the pump brings + what is left in the tank
          const levelLoss = P.tankDepthFt[z] * (1 - V[z] / P.tankGal[z]);
          const top = G[z] - levelLoss - P.zoneK[z] * Dtot[z] * Dtot[z];
          const ratio = Dtot[z] > 0 ? (inflow[z] + V[z] / dt) / Dtot[z] : 1;
          const floor = G[z - 1] - 100;
          nh[z] = ratio >= 1 ? top : floor + (top - floor) * ratio * ratio;
        }
        for (let z = 0; z < Z; z++) head[z] = P.relax * head[z] + (1 - P.relax) * nh[z];
        D = Dtot;
      }
      for (let z = 2; z < Z; z++) V[z] = Math.max(0, Math.min(P.tankGal[z], V[z] + (inflow[z] - D[z]) * dt));
      let lk = 0, fg = 0;
      for (let z = 0; z < Z; z++) { lk += leak[z]; fg += fire[z]; }
      lost += lk * dt;
      for (let z = 0; z < Z; z++) { out.head[k * Z + z] = head[z]; out.tank[k * Z + z] = P.tankGal[z] ? V[z] / P.tankGal[z] : 1; }
      out.open[k] = nOpen; out.closed[k] = nClosed; out.leakGpm[k] = lk; out.lostGal[k] = lost; out.fireGpm[k] = fg; out.trunkGpm[k] = trunkQ; out.crew[k] = nCrew;
      out.pumps[k] = (pumpOn[2] ? 1 : 0) | (pumpOn[3] ? 2 : 0) | (pumpOn[4] ? 4 : 0);
    }
    return out;
  }

  // pressure (psi) at a point of given elevation in zone z at step k
  function psiAt(res, k, z, elev, Z) { return Math.max(0, PSI_PER_FT * (res.head[k * Z + z] - elev)); }

  const api = { PARAMS, prepare, run, psiAt, hash01, PSI_PER_FT };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FNSim = api;
})(this);
