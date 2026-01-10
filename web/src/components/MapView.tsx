"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import style from "../map/style.json";
import { CountryFeature, loadEuropeCountries } from "../lib/world";
import { geoArea } from "d3-geo";
import { mesh, feature as topoFeature } from "topojson-client";
import type { Topology } from "topojson-specification";

export type { CountryFeature };

type Props = {
  countries: CountryFeature[]; // fallback
  selectedId: string | null;
  onSelect: (country: CountryFeature) => void;
};

const ADMIN0_URL_CANDIDATES = [
  "/geo/ne_10m_admin0.json",  // Try 10m first (better Caribbean detail)
  "/geo/ne_50m_admin0.json",  // Then 50m
  "geo/ne_10m_admin0.json",
  "geo/ne_50m_admin0.json",
];

const ADMIN1_URL_CANDIDATES = [
  "/geo/ne_10m_admin1.json",
  "/geo/ne_10m_admin1.topojson",
  "/geo/ne_10m_admin_1_states_provinces_lakes.json",
  "/geo/ne_10m_admin_1_states_provinces_lakes.topojson",
  "/geo/ne_50m_admin1.json",
  "/geo/ne_50m_admin1.topojson",
  "/geo/ne_50m_admin_1_states_provinces_lakes.json",
  "/geo/ne_50m_admin_1_states_provinces_lakes.topojson",
  "geo/ne_10m_admin1.json",
  "geo/ne_10m_admin1.topojson",
  "geo/ne_10m_admin_1_states_provinces_lakes.json",
  "geo/ne_10m_admin_1_states_provinces_lakes.topojson",
  "geo/ne_50m_admin1.json",
  "geo/ne_50m_admin1.topojson",
  "geo/ne_50m_admin_1_states_provinces_lakes.json",
  "geo/ne_50m_admin_1_states_provinces_lakes.topojson",
];

function normalizeId(idLike: unknown): string {
  const s = (idLike ?? "").toString();
  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n) && /^\d+$/.test(s)) return String(n);
  return s;
}

function getName(f: any): string {
  const p = f?.properties ?? {};
  return (
    p.name ??
    p.NAME_EN ??
    p.NAME ??
    p.ADMIN ??
    p.NAME_LONG ??
    p.BRK_NAME ??
    "Unknown"
  ).toString();
}

function getISO3(f: any): string | null {
  return (
    f?.properties?.ADM0_A3 ??
    f?.properties?.ISO_A3 ??
    f?.properties?.adm0_a3 ??
    f?.properties?.iso_a3 ??
    null
  );
}

function getStableIdFromAdmin0(f: any): string {
  const p = f?.properties ?? {};
  const isoN3 = p.ISO_N3 ?? p.iso_n3;
  if (isoN3 != null && String(isoN3).trim() !== "" && String(isoN3) !== "-99") {
    return normalizeId(isoN3);
  }
  const iso3 = getISO3(f);
  if (iso3) return iso3;
  return normalizeId(f?.id ?? p.id ?? p.ID ?? getName(f));
}

function toFeatureCollection(countries: CountryFeature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: countries as any };
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function pickFirstObject(topo: Topology<any>): any | null {
  const keys = Object.keys((topo as any)?.objects ?? {});
  if (!keys.length) return null;
  return (topo as any).objects[keys[0]] ?? null;
}

function collectMultiPolygonCoords(g: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as any];
  if (g.type === "MultiPolygon") return g.coordinates as any;
  return [];
}

function mergeById(features: CountryFeature[]): CountryFeature[] {
  const byId = new Map<string, { proto: CountryFeature; coords: number[][][] }>();
  for (const f of features) {
    const id = normalizeId((f as any)?.id ?? (f as any)?.properties?.id ?? getStableIdFromAdmin0(f));
    const coords = collectMultiPolygonCoords(maybeTransformGeometry(f));
    const existing = byId.get(id);
    if (existing) {
      existing.coords.push(...coords);
      continue;
    }
    byId.set(id, { proto: f, coords: [...coords] });
  }

  return Array.from(byId.values()).map(({ proto, coords }) => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: coords,
    } as any;
    const area = Number(geoArea({ ...(proto as any), geometry } as any));
    const name = getName(proto as any);
    const id = normalizeId((proto as any)?.id ?? (proto as any)?.properties?.id ?? getStableIdFromAdmin0(proto));
    return {
      ...proto,
      geometry,
      id,
      properties: { ...(proto as any)?.properties, id, name, area },
    } as CountryFeature;
  });
}

// ---- Alaska transform: move down and shrink to reduce visual clutter ----
const AK_ANCHOR: [number, number] = [-152, 63];
const AK_SCALE = 0.5; // shrink width/height by 2x
const AK_SHIFT: [number, number] = [30, -25]; // move east a bit and lower vertically

function isAlaskaCoord(lon: number, lat: number): boolean {
  return lon < -124 && lat > 50;
}

function transformAkCoord([lon, lat]: [number, number]): [number, number] {
  const dLon = lon - AK_ANCHOR[0];
  const dLat = lat - AK_ANCHOR[1];
  const lon2 = AK_ANCHOR[0] + dLon * AK_SCALE + AK_SHIFT[0];
  const lat2 = AK_ANCHOR[1] + dLat * AK_SCALE + AK_SHIFT[1];
  return [lon2, lat2];
}

function transformAkPolygon(coords: number[][]): number[][] {
  const shouldTransform = coords.some(([lon, lat]) => isAlaskaCoord(lon, lat));
  if (!shouldTransform) return coords;
  return coords.map((pt) => transformAkCoord(pt as [number, number]));
}

function transformAkGeometry(g: GeoJSON.Geometry): GeoJSON.Geometry {
  if (!g) return g;
  if (g.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (g.coordinates as any).map((ring: number[][]) => transformAkPolygon(ring)),
    } as GeoJSON.Polygon;
  }
  if (g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: (g.coordinates as any).map((poly: number[][][]) =>
        poly.map((ring: number[][]) => transformAkPolygon(ring))
      ),
    } as GeoJSON.MultiPolygon;
  }
  if (g.type === "LineString") {
    const coords = g.coordinates as any;
    const shouldTransform = Array.isArray(coords) && coords.some(([lon, lat]: any) => isAlaskaCoord(lon, lat));
    if (!shouldTransform) return g;
    return {
      type: "LineString",
      coordinates: coords.map((pt: any) => transformAkCoord(pt as [number, number])),
    } as GeoJSON.LineString;
  }
  if (g.type === "MultiLineString") {
    const coords = g.coordinates as any;
    const shouldTransform =
      Array.isArray(coords) && coords.some((line: any) => Array.isArray(line) && line.some(([lon, lat]: any) => isAlaskaCoord(lon, lat)));
    if (!shouldTransform) return g;
    return {
      type: "MultiLineString",
      coordinates: coords.map((line: any) => line.map((pt: any) => transformAkCoord(pt as [number, number]))),
    } as GeoJSON.MultiLineString;
  }
  return g;
}

function maybeTransformGeometry(f: any): GeoJSON.Geometry {
  return f.geometry as GeoJSON.Geometry;
}

function withAreaAndIds(features: any[]): CountryFeature[] {
  return features.map((f) => {
    const id = getStableIdFromAdmin0(f);
    const name = getName(f);
    const geometry = maybeTransformGeometry(f);
    const a =
      Number(f?.properties?.area) ||
      (geometry ? Number(geoArea({ ...f, geometry } as any)) : 0);

    return {
      ...f,
      geometry,
      id,
      properties: {
        ...(f?.properties ?? {}),
        id,
        name,
        area: a,
      },
    } as CountryFeature;
  });
}

function transformFallbackCountries(features: CountryFeature[]): CountryFeature[] {
  return (features ?? []).map((f) => {
    const id = normalizeId((f as any)?.id ?? (f as any)?.properties?.id ?? "");
    const name = (f as any)?.properties?.name ?? getName(f as any);
    const geometry = maybeTransformGeometry(f as any);
    const area = Number((f as any)?.properties?.area) || (geometry ? Number(geoArea({ ...f, geometry } as any)) : 0);
    return {
      ...f,
      id,
      geometry,
      properties: { ...(f as any)?.properties, id, name, area },
    } as CountryFeature;
  });
}

function getAdm0A3FromAdmin1Props(p: any): string | null {
  return (
    p?.adm0_a3 ??
    p?.ADM0_A3 ??
    p?.iso_a3 ??
    p?.ISO_A3 ??
    p?.sr_adm0_a3 ??
    p?.SR_ADM0_A3 ??
    p?.sov_a3 ??
    p?.SOV_A3 ??
    null
  );
}

function pickTopoObjectRobust(topo: any, preferredNames: string[]) {
  const objects = topo?.objects ?? {};
  for (const name of preferredNames) {
    if (objects?.[name]) return objects[name];
  }
  // fallback: pick the only/most admin1-like object
  let bestKey: string | null = null;
  let bestScore = -Infinity;
  for (const [k, obj] of Object.entries<any>(objects)) {
    const geoms = obj?.geometries;
    const n = Array.isArray(geoms) ? geoms.length : 0;
    let score = 0;
    if (obj?.type === "GeometryCollection") score += 1000;
    if (/admin.?1|states|provinces|lakes/i.test(k)) score += 300;
    score += n;
    const hasPoly =
      Array.isArray(geoms) &&
      geoms.some((g) => g?.type === "Polygon" || g?.type === "MultiPolygon");
    if (hasPoly) score += 500;
    if (score > bestScore) {
      bestScore = score;
      bestKey = k;
    }
  }
  return bestKey ? objects[bestKey] : null;
}

function isEmptyLineGeom(g: any): boolean {
  if (!g) return true;
  if (g.type === "LineString") return !Array.isArray(g.coordinates) || g.coordinates.length === 0;
  if (g.type === "MultiLineString") return !Array.isArray(g.coordinates) || g.coordinates.length === 0;
  return true;
}

async function fetchJsonStrict(url: string): Promise<any> {
  const r = await fetch(url);
  const ct = (r.headers.get("content-type") ?? "").toLowerCase();

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} for ${url}. First bytes: ${txt.slice(0, 60)}`);
  }
  if (ct.includes("text/html")) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Got HTML instead of JSON for ${url}. First bytes: ${txt.slice(0, 60)}`);
  }

  const text = await r.text();
  if (text.trim().startsWith("<")) {
    throw new Error(`Got HTML-like response for ${url}. First bytes: ${text.slice(0, 60)}`);
  }
  return JSON.parse(text);
}

/** ✅ Скрываем границы из базового style.json (чтобы не было “старых” линий) */
function hideBasemapBoundaries(map: maplibregl.Map) {
  const st = map.getStyle();
  const layers = st?.layers ?? [];
  for (const layer of layers) {
    const id = layer.id ?? "";
    const srcLayer = (layer as any)["source-layer"] ?? "";
    const hay = `${id} ${srcLayer}`.toLowerCase();

    // типичные названия: boundary/admin/country/state/province
    if (layer.type === "line" && /(boundary|admin|country|state|province)/.test(hay)) {
      try {
        map.setLayoutProperty(id, "visibility", "none");
      } catch {
        // ignore
      }
    }
  }
}

/** ---- admin0 loader ---- */
const _admin0Cache = new Map<string, Promise<CountryFeature[]>>();

async function loadNaturalEarthAdmin0(): Promise<CountryFeature[]> {
  let lastErr: any = null;
  for (const url of ADMIN0_URL_CANDIDATES) {
    try {
      if (!_admin0Cache.has(url)) {
        _admin0Cache.set(
          url,
          (async () => {
            const raw = await fetchJsonStrict(url);

            // Accept both GeoJSON FeatureCollection and Topology
            let feats: any[] | null = null;
            if (raw && raw.type === "FeatureCollection") {
              feats = (raw.features ?? []) as any[];
            } else if (raw && raw.type === "Topology" && (raw as any).objects) {
              const obj = pickFirstObject(raw as Topology<any>);
              if (!obj) throw new Error(`No objects in topology ${url}`);
              feats = (topoFeature(raw as any, obj as any).features ?? []) as any[];
            } else {
              throw new Error(`Unsupported admin0 format at ${url}`);
            }

            const withIds = withAreaAndIds(feats);
            return mergeById(withIds);
          })()
        );
      }
      return await _admin0Cache.get(url)!;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Failed to load Natural Earth admin0");
}

/** ---- admin1 topo loader ---- */
type Admin1Loaded = { topo: Topology<any>; url: string };
const _admin1TopoCache = new Map<string, Promise<Admin1Loaded>>();

async function loadNaturalEarthAdmin1Topo(): Promise<Admin1Loaded> {
  let lastErr: any = null;
  for (const url of ADMIN1_URL_CANDIDATES) {
    try {
      if (!_admin1TopoCache.has(url)) {
        _admin1TopoCache.set(
          url,
          (async () => {
            const topo = (await fetchJsonStrict(url)) as Topology<any>;
            if ((topo as any)?.type !== "Topology" || !(topo as any)?.objects) {
              throw new Error(`File is not a Topology: ${url}`);
            }
            return { topo, url };
          })()
        );
      }
      return await _admin1TopoCache.get(url)!;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Failed to load admin1 topojson");
}

function buildAdmin1InternalBordersFC(topo: Topology<any>, iso3: string): GeoJSON.FeatureCollection {
  const obj =
    pickTopoObjectRobust(topo as any, [
      "admin1",
      "admin_1",
      "states_provinces",
      "ne_10m_admin_1_states_provinces_lakes",
      "ne_50m_admin_1_states_provinces_lakes",
      "ne_10m_admin_1_states_provinces",
      "ne_50m_admin_1_states_provinces",
    ]) ?? null;

  if (!obj) return emptyFC();

  // строгий mesh: только внутренние границы (общие ребра) внутри одной страны
  const m = mesh(
    topo as any,
    obj as any,
    (a: any, b: any) => {
      if (!a || !b) return false;
      const a0 = getAdm0A3FromAdmin1Props(a.properties);
      const b0 = getAdm0A3FromAdmin1Props(b.properties);
      return a0 && b0 && a0 === b0 && a0 === iso3;
    }
  ) as any;

  const geometry = m as any;

  if (!isEmptyLineGeom(geometry)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry }],
    };
  }

  // если нет внутренних границ — пусто
  return emptyFC();
}

export default function MapView({ countries, selectedId, onSelect }: Props) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const creatingRef = useRef(false);
  const containerIdRef = useRef(`map-${Math.random().toString(36).slice(2)}`);

  const [mapReady, setMapReady] = useState(false);
  const [neCountries, setNeCountries] = useState<CountryFeature[] | null>(null);
  const [admin1Loaded, setAdmin1Loaded] = useState<Admin1Loaded | null>(null);

  const countriesRef = useRef<CountryFeature[]>([]);
  const countriesFCRef = useRef<GeoJSON.FeatureCollection>(emptyFC());
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    
    async function loadCountriesWithFallback() {
      try {
        const arr = await loadNaturalEarthAdmin0();
        if (!cancelled) setNeCountries(arr);
      } catch (e) {
        console.warn("[MapView] Natural Earth admin0 not loaded, trying world-atlas fallback:", e);
        try {
          // Load world-atlas as complete fallback with proper geometries
          const atlasCountries = await loadEuropeCountries();
          if (!cancelled) {
            // Merge: use Natural Earth as base, augment with world-atlas for missing countries
            setNeCountries(atlasCountries);
          }
        } catch (e2) {
          console.warn("[MapView] world-atlas also failed, will use minimal fallback", e2);
          if (!cancelled) setNeCountries(null);
        }
      }
    }
    
    loadCountriesWithFallback();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadNaturalEarthAdmin1Topo()
      .then((res) => {
        if (!cancelled) setAdmin1Loaded(res);
      })
      .catch((e) => {
        console.warn("[MapView] admin1 topojson not loaded:", e);
        if (!cancelled) setAdmin1Loaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [atlasCountries, setAtlasCountries] = useState<CountryFeature[] | null>(null);

  // Load world-atlas geometries as supplement for missing Natural Earth data
  useEffect(() => {
    let cancelled = false;
    loadEuropeCountries()
      .then((atlas) => !cancelled && setAtlasCountries(atlas))
      .catch((e) => {
        console.warn("[MapView] Failed to load world-atlas for geometry supplement:", e);
        !cancelled && setAtlasCountries(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dataCountries = useMemo(() => {
    const source = neCountries?.length ? neCountries : transformFallbackCountries(countries ?? []);
    
    // If we have both Natural Earth and world-atlas, merge geometries for countries with missing data
    if (source?.length && atlasCountries?.length) {
      return source.map((country) => {
        const hasGeometry = country.geometry && 
                           JSON.stringify(country.geometry).length > 50;
        
        if (!hasGeometry) {
          // Try to find this country in world-atlas and use its geometry
          const atlasMatch = atlasCountries.find(
            (ac) => normalizeId(ac.id) === normalizeId(country.id)
          );
          
          if (atlasMatch?.geometry) {
            console.debug(`[MapView] Using world-atlas geometry for country ${normalizeId(country.id)} (was missing in Natural Earth)`);
            return {
              ...country,
              geometry: atlasMatch.geometry,
            };
          }
        }
        
        return country;
      });
    }
    
    return source;
  }, [neCountries, atlasCountries, countries]);

  const countriesFC = useMemo(() => toFeatureCollection(dataCountries), [dataCountries]);

  const selectedCountry = useMemo(() => {
    if (!selectedId) return null;
    const sid = normalizeId(selectedId);
    return dataCountries.find((c) => normalizeId(c.id) === sid) ?? null;
  }, [dataCountries, selectedId]);

  const selectedIso3 = useMemo(() => {
    const iso3 = selectedCountry ? getISO3(selectedCountry as any) : null;
    return iso3 && iso3 !== "-99" ? iso3 : null;
  }, [selectedCountry]);

  useEffect(() => {
    countriesRef.current = dataCountries;
  }, [dataCountries]);

  useEffect(() => {
    countriesFCRef.current = countriesFC;
  }, [countriesFC]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (mapRef.current || creatingRef.current) return;

    creatingRef.current = true;
    let cancelled = false;

    requestAnimationFrame(() => {
      if (cancelled) return;

      const el = document.getElementById(containerIdRef.current);
      if (!el) {
        creatingRef.current = false;
        return;
      }

      const map = new maplibregl.Map({
        container: containerIdRef.current,
        style: style as any,
        center: [10, 52],
        zoom: 3.6,
        minZoom: 2.8,
        maxZoom: 7.5,
        attributionControl: true,
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

      map.on("load", () => {
        setMapReady(true);

        // ✅ прячем старые границы из style.json
        hideBasemapBoundaries(map);

        map.addSource("countries", { type: "geojson", data: countriesFCRef.current as any });

        map.addLayer({
          id: "countries-fill",
          type: "fill",
          source: "countries",
          layout: { "fill-sort-key": ["*", -1, ["coalesce", ["get", "area"], 0]] },
          paint: {
            "fill-color": ["case", ["==", ["id"], selectedIdRef.current ?? ""], "#60a5fa", "#27272a"],
            "fill-opacity": 0.35,
          },
        });

        map.addLayer({
          id: "countries-line",
          type: "line",
          source: "countries",
          paint: { "line-color": "#52525b", "line-width": 1.2, "line-opacity": 0.9 },
        });

        map.on("mousemove", "countries-fill", (e) => {
          map.getCanvas().style.cursor = e.features?.length ? "pointer" : "";
        });
        map.on("mouseleave", "countries-fill", () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("click", "countries-fill", (e) => {
          const feats = map.queryRenderedFeatures(e.point, { layers: ["countries-fill"] }) as any[];
          const feat =
            feats
              .map((f) => ({ f, area: Number(f.properties?.area ?? Infinity) }))
              .sort((a, b) => a.area - b.area)[0]?.f ?? (e.features?.[0] as any);

          if (!feat) return;

          const idRaw = feat.id ?? feat.properties?.id ?? "";
          const id = normalizeId(idRaw);
          const name = (feat.properties?.name ?? getName(feat) ?? "Unknown").toString();

          const list = countriesRef.current ?? [];
          const found =
            list.find((c) => normalizeId(c.id) === id) ||
            list.find((c) => normalizeId(c.id) === normalizeId(idRaw?.toString()));

          if (found) onSelect(found);
          else onSelect({ ...(feat as any), id, properties: { ...(feat.properties ?? {}), id, name } } as CountryFeature);
        });

        // admin1 borders layer (empty until selection)
        map.addSource("admin1-borders", { type: "geojson", data: emptyFC() as any });
        map.addLayer({
          id: "admin1-borders-line",
          type: "line",
          source: "admin1-borders",
          paint: {
            "line-color": "#ffffff",
            "line-opacity": 0.55,
            "line-width": 1.2,
          },
        });
      });

      mapRef.current = map;
      creatingRef.current = false;
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      creatingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update countries source
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("countries") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(countriesFC as any);
  }, [countriesFC]);

  // Update selection paint
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer("countries-fill")) return;

    map.setPaintProperty("countries-fill", "fill-color", [
      "case",
      ["==", ["id"], selectedId ?? ""],
      "#60a5fa",
      "#27272a",
    ]);
  }, [selectedId]);

  // Update admin1 borders when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const src = map.getSource("admin1-borders") as GeoJSONSource | undefined;
    if (!src) return;

    if (!admin1Loaded?.topo || !selectedIso3) {
      src.setData(emptyFC() as any);
      return;
    }

    const fc = buildAdmin1InternalBordersFC(admin1Loaded.topo, selectedIso3);
    src.setData(fc as any);
  }, [mapReady, admin1Loaded, selectedIso3]);

  return <div id={containerIdRef.current} className="h-full w-full" />;
}
