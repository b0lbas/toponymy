import * as d3 from "d3";
import { feature } from "topojson-client";

export type CountryFeature = GeoJSON.Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { name: string; area?: number }
> & {
  id: string;
};

const WORLD_ATLAS_TOPOJSON =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";

const EUROPE_BBOX = { lonMin: -25, lonMax: 45, latMin: 34, latMax: 72 };

function inEuropeBbox([lon, lat]: [number, number]) {
  return (
    lon >= EUROPE_BBOX.lonMin &&
    lon <= EUROPE_BBOX.lonMax &&
    lat >= EUROPE_BBOX.latMin &&
    lat <= EUROPE_BBOX.latMax
  );
}

function filterToEuropeGeom(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (geom.type === "Polygon") {
    // (оставляю как было по смыслу — для Европы у тебя фильтрация по ISO, так что ок)
    return geom;
  }

  const polys = geom.coordinates
    .map((coords) => ({ type: "Polygon", coordinates: coords } as GeoJSON.Polygon))
    .filter((poly) => {
      const c = d3.geoCentroid(
        { type: "Feature", geometry: poly, properties: {} } as any
      ) as [number, number];
      return inEuropeBbox(c);
    });

  if (polys.length === 0) return geom;

  return {
    type: "MultiPolygon",
    coordinates: polys.map((p) => p.coordinates),
  } as GeoJSON.MultiPolygon;
}

const EUROPE_NUM_IDS = new Set<number>([
  8, 929, 40, 56, 70, 100, 112, 191, 196, 203, 208, 233, 246, 250, 276, 300,
  348, 352, 372, 380, 428, 438, 440, 442, 470, 492, 498, 499, 528, 578, 616,
  620, 642, 643, 688, 703, 705, 724, 752, 756, 792, 804, 807, 826,

  417, 398, 496, 764, 704, 116, 608, 458, 360
]);

// Дополнительно включаем вне Европы: Россия уже была, добавим Канаду (124), Гренландию (304), Мексику (484), США (840)
// Эти страны будут отображаться целиком (без обрезки по bbox Европы).
const EXTRA_INCLUDED_IDS = new Set<number>([643, 398, 496, 124, 304, 484, 840]);

function normIsoId(idLike: unknown): number | null {
  if (idLike === null || idLike === undefined) return null;
  const s = idLike.toString().trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** ===== FIX: unwrap антимеридиан для колец ===== */

type Position = number[];

// поворачиваем кольцо так, чтобы старт был ближе к lon=0 (стабильнее unwrap)
function rotateRingStartNearZero(ring: Position[]): Position[] {
  if (ring.length < 4) return ring;

  const isClosed =
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];

  const open = isClosed ? ring.slice(0, -1) : ring.slice();
  if (open.length === 0) return ring;

  let bestIdx = 0;
  let bestScore = Math.abs(open[0][0] ?? 0);

  for (let i = 1; i < open.length; i++) {
    const lon = open[i][0] ?? 0;
    const score = Math.abs(lon);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const rotated = open.slice(bestIdx).concat(open.slice(0, bestIdx));
  if (isClosed) rotated.push(rotated[0].slice());
  return rotated;
}

function unwrapRingAntimeridian(ring: Position[]): Position[] {
  if (ring.length < 2) return ring;

  const out: Position[] = [];
  let offset = 0;

  let prev = ring[0].slice();
  out.push(prev);

  let prevLon = prev[0] ?? 0;

  for (let i = 1; i < ring.length; i++) {
    const p = ring[i].slice();
    let lon = (p[0] ?? 0) + offset;

    const delta = lon - prevLon;
    if (delta > 180) {
      offset -= 360;
      lon -= 360;
    } else if (delta < -180) {
      offset += 360;
      lon += 360;
    }

    p[0] = lon;
    out.push(p);
    prevLon = lon;
  }

  return out;
}

function fixAntimeridianGeom<T extends GeoJSON.Polygon | GeoJSON.MultiPolygon>(geom: T): T {
  if (geom.type === "Polygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((ring) =>
        unwrapRingAntimeridian(rotateRingStartNearZero(ring as any)) as any
      ),
    } as T;
  }

  return {
    ...geom,
    coordinates: geom.coordinates.map((poly) =>
      poly.map((ring) =>
        unwrapRingAntimeridian(rotateRingStartNearZero(ring as any)) as any
      )
    ),
  } as T;
}

/** ===== конец FIX ===== */

export async function loadEuropeCountries(): Promise<CountryFeature[]> {
  const topo = await d3.json(WORLD_ATLAS_TOPOJSON);
  if (!topo || typeof topo !== "object")
    throw new Error("Failed to load world-atlas TopoJSON");

  const geo = feature(topo as any, (topo as any).objects.countries) as GeoJSON.FeatureCollection<
    GeoJSON.MultiPolygon | GeoJSON.Polygon,
    any
  >;

  const filtered: CountryFeature[] = [];
  for (const f of geo.features) {
    const name = (f.properties?.name ?? "Unknown").toString();
    const idNum = normIsoId(f.id);

    const include =
      idNum !== null && (EUROPE_NUM_IDS.has(idNum) || EXTRA_INCLUDED_IDS.has(idNum));
    if (!include) continue;

    const stableId = idNum !== null ? String(idNum) : name;

    const keepFull = idNum !== null && EXTRA_INCLUDED_IDS.has(idNum);
    let geom = keepFull
      ? (f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)
      : filterToEuropeGeom(f.geometry as any);

    // ✅ фикс именно для России (ISO numeric 643)
    if (idNum === 643) {
      geom = fixAntimeridianGeom(geom);
    }

    const cleaned = { ...(f as any), geometry: geom };

    filtered.push({
      ...cleaned,
      id: stableId,
      properties: { name, area: d3.geoArea(cleaned as any) },
    } as CountryFeature);
  }

  filtered.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  return filtered;
}
