import * as d3 from "d3";
import { feature } from "topojson-client";

export type CountryFeature = GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon, { name: string; area?: number }> & {
  id: string; // ISO numeric as string (normalized without leading zeros); fallback to name for non-ISO (e.g., Kosovo)
};

const WORLD_ATLAS_TOPOJSON =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";

const EUROPE_BBOX = { lonMin: -25, lonMax: 45, latMin: 34, latMax: 72 };

function inEuropeBbox([lon, lat]: [number, number]) {
  return lon >= EUROPE_BBOX.lonMin && lon <= EUROPE_BBOX.lonMax && lat >= EUROPE_BBOX.latMin && lat <= EUROPE_BBOX.latMax;
}

function filterToEuropeGeom(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (geom.type === "Polygon") {
    const c = d3.geoCentroid({ type: "Feature", geometry: geom, properties: {} } as any) as [number, number];
    return inEuropeBbox(c) ? geom : geom; // keep if somehow outside (safety)
  }

  // MultiPolygon: keep only polygon parts whose centroid is in the Europe bbox.
  const polys = geom.coordinates
    .map((coords) => ({ type: "Polygon", coordinates: coords } as GeoJSON.Polygon))
    .filter((poly) => {
      const c = d3.geoCentroid({ type: "Feature", geometry: poly, properties: {} } as any) as [number, number];
      return inEuropeBbox(c);
    });

  if (polys.length === 0) return geom;

  return { type: "MultiPolygon", coordinates: polys.map((p) => p.coordinates) } as GeoJSON.MultiPolygon;
}


/**
 * We filter primarily by ISO numeric id (normalized as int), and fall back to name
 * for entities without ISO numeric id in this dataset (e.g., Kosovo).
 */
const EUROPE_NUM_IDS = new Set<number>([
  8, 20, 40, 56, 70, 100, 112, 191, 196, 203, 208, 233, 246, 250, 276, 300, 348, 352, 372, 380,
  428, 438, 440, 442, 470, 492, 498, 499, 528, 578, 616, 620, 642, 674, 688, 703, 705, 724, 752, 756, 792,
  804, 807, 826, 336, 991,
  // Add other purely-European microstates if present in the dataset:
  674, 438, 470, 492
]);

function normIsoId(idLike: unknown): number | null {
  if (idLike === null || idLike === undefined) return null;
  const s = idLike.toString().trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function loadEuropeCountries(): Promise<CountryFeature[]> {
  const topo = await d3.json(WORLD_ATLAS_TOPOJSON);
  if (!topo || typeof topo !== "object") throw new Error("Failed to load world-atlas TopoJSON");

  const geo = feature(topo as any, (topo as any).objects.countries) as GeoJSON.FeatureCollection<
    GeoJSON.MultiPolygon | GeoJSON.Polygon,
    any
  >;

  const filtered: CountryFeature[] = [];
  for (const f of geo.features) {
    const name = (f.properties?.name ?? "Unknown").toString();
    const idNum = normIsoId(f.id);
    const include = (idNum !== null && EUROPE_NUM_IDS.has(idNum));
    if (!include) continue;

    const stableId = idNum !== null ? String(idNum) : name;
    const cleanedGeom = filterToEuropeGeom(f.geometry as any);
    const cleaned = { ...(f as any), geometry: cleanedGeom };
    filtered.push({
      ...cleaned,
      id: stableId,
      properties: { name, area: d3.geoArea(cleaned as any) },
    } as CountryFeature);
  }

  filtered.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  return filtered;
}
