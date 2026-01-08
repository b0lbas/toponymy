import { useEffect, useId, useMemo, useState } from "react";
import * as d3 from "d3";
import { mesh } from "topojson-client";
import type { Topology } from "topojson-specification";

import type { CountryFeature } from "./MapView";
import type { PatternPayload } from "../lib/data";

type Props = {
  country: CountryFeature;
  payload: PatternPayload;
  variant?: "mini" | "large";
  viewScale?: number;
  onPointClick?: (pt: { x: number; y: number; name: string } | null) => void;
  onPointHover?: (pt: { x: number; y: number; name: string } | null) => void;
};

type Position = number[];

function tileBoundsLonLat(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;

  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const lat2 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;

  return { west: lon1, east: lon2, south: lat2, north: lat1 };
}

function keepLargestPolygonOnly(feature: any) {
  const g = feature?.geometry;
  if (!g || g.type !== "MultiPolygon") return feature;

  const overallCentroid = d3.geoCentroid(feature as any);
  let bestIdx = 0;
  let bestScore = Infinity;

  g.coordinates.forEach((coords: any, i: number) => {
    const polyFeat: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: coords },
      properties: {},
    } as any;

    let c: any;
    try {
      c = d3.geoCentroid(polyFeat as any);
    } catch {
      c = null;
    }

    let score = Infinity;
    if (c && overallCentroid) {
      const dist = d3.geoDistance(overallCentroid as any, c as any);
      score = Number.isFinite(dist) ? dist : Infinity;
    }

    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });

  if (!Number.isFinite(bestScore)) {
    let bestArea = -Infinity;
    g.coordinates.forEach((coords: any, i: number) => {
      const poly: GeoJSON.Polygon = { type: "Polygon", coordinates: coords };
      const a = d3.geoArea(poly as any);
      if (a > bestArea) {
        bestArea = a;
        bestIdx = i;
      }
    });
  }

  return {
    ...feature,
    geometry: { type: "Polygon", coordinates: g.coordinates[bestIdx] },
  };
}

function geomCrossesAntimeridian(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let crosses = false;

  const visitRing = (ring: number[][]) => {
    let prevLon: number | null = null;
    for (const pos of ring) {
      const lon = Number(pos?.[0]);
      if (!Number.isFinite(lon)) continue;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      if (prevLon != null && Math.abs(lon - prevLon) > 180) crosses = true;
      prevLon = lon;
    }
  };

  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates as any) visitRing(ring);
  } else {
    for (const poly of geom.coordinates as any) for (const ring of poly) visitRing(ring);
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon)) return false;
  return crosses || maxLon - minLon > 180;
}

function wrap360(lon: number) {
  const x = lon % 360;
  return x < 0 ? x + 360 : x;
}

function wrap180(lon: number) {
  let x = lon % 360;
  if (x <= -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

function sampleLongitudes(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon, maxSamples = 8000): number[] {
  const out: number[] = [];

  const pushRing = (ring: Position[]) => {
    for (const p of ring) {
      const lon = Number(p?.[0]);
      if (Number.isFinite(lon)) out.push(lon);
      if (out.length >= maxSamples) return;
    }
  };

  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates as any) {
      pushRing(ring);
      if (out.length >= maxSamples) break;
    }
  } else {
    for (const poly of geom.coordinates as any) {
      for (const ring of poly) {
        pushRing(ring);
        if (out.length >= maxSamples) break;
      }
      if (out.length >= maxSamples) break;
    }
  }

  return out;
}

function computeSafeCentralMeridian(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number | null {
  if (!geomCrossesAntimeridian(geom)) return null;

  const lons = sampleLongitudes(geom, 8000);
  if (lons.length < 2) return null;

  const a = lons.map(wrap360).sort((x, y) => x - y);
  const n = a.length;
  if (n < 2) return null;

  let bestGap = -Infinity;
  let bestI = 0;

  for (let i = 0; i < n; i++) {
    const next = i === n - 1 ? a[0] + 360 : a[i + 1];
    const gap = next - a[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestI = i;
    }
  }

  const next = bestI === n - 1 ? a[0] + 360 : a[bestI + 1];
  const mid = (next + (a[bestI] + 360)) / 2;
  return wrap180(mid);
}

/** ----------------- topo loader ----------------- */
const _topoCache = new Map<string, Promise<any>>();
function loadTopo(url: string) {
  if (!_topoCache.has(url)) {
    _topoCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
        return r.json();
      })
    );
  }
  return _topoCache.get(url)!;
}

const ADMIN1_URL = "/geo/ne_10m_admin1.json";

/** ----------------- ISO3 resolving ----------------- */
function isValidA3(v: any): v is string {
  return typeof v === "string" && v.length === 3 && v !== "-99";
}

function getISO3FromCountryProps(country: any): string | null {
  const p = country?.properties ?? {};
  const v =
    p.ADM0_A3 ??
    p.ISO_A3 ??
    p.adm0_a3 ??
    p.iso_a3 ??
    p.SOV_A3 ??
    p.sov_a3 ??
    null;

  return isValidA3(v) ? v : null;
}

function getCountryName(country: any): string | null {
  const p = country?.properties ?? {};
  const v = p.name ?? p.NAME ?? p.admin ?? p.ADMIN ?? null;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function normName(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let _admin1NameToA3Promise: Promise<Map<string, string>> | null = null;

function loadAdmin1NameToA3(): Promise<Map<string, string>> {
  if (_admin1NameToA3Promise) return _admin1NameToA3Promise;

  _admin1NameToA3Promise = loadTopo(ADMIN1_URL).then((topo: Topology<any>) => {
    const obj = (topo as any).objects?.admin1;
    const geoms = obj?.geometries;
    const m = new Map<string, string>();

    if (!Array.isArray(geoms)) return m;

    for (const g of geoms) {
      const p = g?.properties ?? {};
      const a3 = p.adm0_a3 ?? p.ADM0_A3 ?? null;
      if (!isValidA3(a3)) continue;

      const admin = p.admin ?? p.ADMIN ?? null;
      const geonunit = p.geonunit ?? p.GEONUNIT ?? null;

      if (typeof admin === "string" && admin.trim()) m.set(normName(admin), a3);
      if (typeof geonunit === "string" && geonunit.trim()) m.set(normName(geonunit), a3);
    }

    return m;
  });

  return _admin1NameToA3Promise;
}

const _warnedNoIso = new Set<string>();

async function resolveISO3(country: any): Promise<string | null> {
  const direct = getISO3FromCountryProps(country);
  if (direct) return direct;

  const nm = getCountryName(country);
  if (!nm) return null;

  const map = await loadAdmin1NameToA3();
  const k = normName(nm);

  const v = map.get(k);
  if (v) return v;

  // маленькие эвристики (на всякий)
  if (k.startsWith("the ")) {
    const v2 = map.get(k.slice(4));
    if (v2) return v2;
  }

  return null;
}

/** ----------------- admin1 mesh cache ----------------- */
function getA3FromAdmin1Props(p: any): string | null {
  const v = p?.adm0_a3 ?? p?.ADM0_A3 ?? p?.sov_a3 ?? p?.SOV_A3 ?? p?.gu_a3 ?? p?.GU_A3 ?? null;
  return isValidA3(v) ? v : null;
}

const _admin1MeshCache = new Map<string, Promise<GeoJSON.MultiLineString | GeoJSON.LineString | null>>();

function loadAdmin1MeshForISO3(iso3: string) {
  const key = `${ADMIN1_URL}::${iso3}`;
  if (_admin1MeshCache.has(key)) return _admin1MeshCache.get(key)!;

  const p = loadTopo(ADMIN1_URL)
    .then((topo: Topology<any>) => {
      const obj = (topo as any).objects?.admin1;
      if (!obj) return null;

      // Включаем дуги:
      // - внутренние (оба региона в iso3)
      // - внешняя граница (b == null, но a в iso3)
      // - границы с соседями (одна сторона iso3)
      const m = mesh(
        topo as any,
        obj as any,
        (a: any, b: any) => {
          const a0 = getA3FromAdmin1Props(a?.properties);
          const b0 = b ? getA3FromAdmin1Props(b?.properties) : null;
          return a0 === iso3 || b0 === iso3;
        }
      ) as any;

      return m ?? null;
    })
    .catch(() => null);

  _admin1MeshCache.set(key, p);
  return p;
}

/** ----------------- component ----------------- */
export default function TileSVG({
  country,
  payload,
  variant = "mini",
  viewScale = 1,
  onPointClick,
  onPointHover,
}: Props) {
  const [hover, setHover] = useState<{ count: number; x: number; y: number } | null>(null);

  const width = variant === "large" ? 980 : 520;
  const height = variant === "large" ? 620 : 320;
  const pad = 10;

  const countryForView = useMemo(() => {
    if (String((country as any).id) === "710") return keepLargestPolygonOnly(country as any);
    return country;
  }, [country]);

  const { path, projection } = useMemo(() => {
    const proj = d3.geoMercator();

    try {
      const g = (countryForView as any)?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined;
      if (g) {
        const cm = computeSafeCentralMeridian(g);
        if (cm != null) proj.rotate([-cm, 0]);
      }
    } catch {}

    proj.fitExtent(
      [
        [pad, pad],
        [width - pad, height - pad],
      ],
      countryForView as any
    );

    return { path: d3.geoPath(proj), projection: proj };
  }, [countryForView, width, height]);

  const [iso3, setIso3] = useState<string | null>(() => getISO3FromCountryProps(countryForView as any));

  useEffect(() => {
    let cancelled = false;

    const direct = getISO3FromCountryProps(countryForView as any);
    if (direct) {
      setIso3(direct);
      return;
    }

    resolveISO3(countryForView as any)
      .then((v) => {
        if (cancelled) return;
        setIso3(v);

        if (!v) {
          const id = String((countryForView as any)?.id ?? "");
          if (!_warnedNoIso.has(id)) {
            _warnedNoIso.add(id);
            console.warn(
              "[TileSVG] cannot resolve iso3 for country.id=",
              (countryForView as any)?.id,
              "propsKeys=",
              Object.keys((countryForView as any)?.properties ?? {}),
              "name=",
              getCountryName(countryForView as any)
            );
          }
        }
      })
      .catch(() => {
        if (!cancelled) setIso3(null);
      });

    return () => {
      cancelled = true;
    };
  }, [countryForView]);

  const [admin1Mesh, setAdmin1Mesh] = useState<GeoJSON.MultiLineString | GeoJSON.LineString | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!iso3) {
      setAdmin1Mesh(null);
      return;
    }

    loadAdmin1MeshForISO3(iso3).then((m) => {
      if (!cancelled) setAdmin1Mesh(m);
    });

    return () => {
      cancelled = true;
    };
  }, [iso3]);

  const admin1PathD = useMemo(() => {
    if (!admin1Mesh) return "";
    return path({ type: "Feature", geometry: admin1Mesh, properties: {} } as any) ?? "";
  }, [admin1Mesh, path]);

  const cells = useMemo(() => {
    if (!("cells" in payload)) return [];
    const polys = (payload as any).cells.map(([x, y, c]: [number, number, number]) => {
      const b = tileBoundsLonLat(x, y, (payload as any).zoom);
      const poly: GeoJSON.Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [b.west, b.south],
            [b.east, b.south],
            [b.east, b.north],
            [b.west, b.north],
            [b.west, b.south],
          ],
        ],
      };
      return { x, y, c, poly };
    });
    return polys;
  }, [payload]);

  const cellsPath = useMemo(() => {
    if (variant === "large") return "";
    if ((import.meta as any).env?.MODE !== "production") console.time(`cellsPath:${payload.pattern ?? "pat"}:${variant}`);
    const s = cells
      .map((d: any) => path({ type: "Feature", geometry: d.poly, properties: {} } as any) ?? "")
      .filter(Boolean)
      .join(" ");
    if ((import.meta as any).env?.MODE !== "production") console.timeEnd(`cellsPath:${payload.pattern ?? "pat"}:${variant}`);
    return s;
  }, [cells, path, variant, payload.pattern]);

  // instrumentation: log counts in dev for diagnostics
  if ((import.meta as any).env?.MODE !== "production" && variant !== "large") {
    // a small timeout so logs are grouped after initial render
    setTimeout(() => {
      try {
        console.info(`[TileSVG] mini summary for pattern=${payload.pattern ?? "?"}: cells=${cells.length} pts=${("points_q" in (payload as any) ? (payload as any).points_q.length : 0)} named=${("points_named" in (payload as any) ? (payload as any).points_named.length : 0)}`);
      } catch {}
    }, 50);
  }

  const decodedPoints = useMemo(() => {
    if (!("points_q" in (payload as any))) return [];
    const scale = (payload as any).points_scale ?? 10000;
    const pts = (payload as any).points_q as [number, number][];
    // reduce mini rendering to keep DOM size manageable
    const maxRender = variant === "large" ? 20000 : 700;

    if (pts.length <= maxRender) {
      if ((import.meta as any).env?.MODE !== "production") console.info(`[TileSVG] decodedPoints: using full ${pts.length} points (limit ${maxRender})`);
      return pts.map(([lonq, latq]) => [lonq / scale, latq / scale] as [number, number]);
    }

    if ((import.meta as any).env?.MODE !== "production") console.info(`[TileSVG] decodedPoints: downsampling ${pts.length} → ${maxRender}`);

    const step = pts.length / maxRender;
    const out: [number, number][] = [];
    for (let i = 0; i < maxRender; i++) {
      const idx = Math.floor(i * step);
      const [lonq, latq] = pts[idx];
      out.push([lonq / scale, latq / scale]);
    }
    return out;
  }, [payload, variant]);

  const decodedNamedPoints = useMemo(() => {
    if (!("points_named" in (payload as any))) return [] as [number, number, string][];
    const scale = (payload as any).points_scale ?? 10000;
    const pts = (payload as any).points_named as [number, number, string][];
    // smaller cap for mini variant
    const maxRender = variant === "large" ? 20000 : 700;

    if (pts.length <= maxRender) {
      if ((import.meta as any).env?.MODE !== "production") console.info(`[TileSVG] decodedNamedPoints: using full ${pts.length} points (limit ${maxRender})`);
      return pts.map(([lonq, latq, name]) => [lonq / scale, latq / scale, name] as any);
    }

    if ((import.meta as any).env?.MODE !== "production") console.info(`[TileSVG] decodedNamedPoints: downsampling ${pts.length} → ${maxRender}`);

    const step = pts.length / maxRender;
    const out: [number, number, string][] = [];
    for (let i = 0; i < maxRender; i++) {
      const idx = Math.floor(i * step);
      const [lonq, latq, name] = pts[idx];
      out.push([lonq / scale, latq / scale, name]);
    }
    return out;
  }, [payload, variant]);

  const maxC = useMemo(() => d3.max(cells, (d: any) => d.c) ?? 1, [cells]);

  const color = useMemo(() => {
    const scale = d3.scaleSequential(d3.interpolateYlGnBu).domain([0, Math.sqrt(maxC)]);
    return (c: number) => scale(Math.sqrt(c));
  }, [maxC]);

  const uid = useId();
  const clipId = useMemo(() => {
    const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safePattern = (payload.pattern ?? "pat").toString().replace(/\W+/g, "_");
    return `clip-${safeUid}-${country.id}-${safePattern}-${variant}`;
  }, [uid, country.id, payload.pattern, variant]);

  const borderStrokeWidth = useMemo(() => {
    const base = variant === "large" ? 1.05 : 0.85;
    const s = Math.max(1e-6, viewScale ?? 1);
    return Math.max(0.35, base / s);
  }, [variant, viewScale]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full">
        <defs>
          <clipPath id={clipId}>
            <path d={path(countryForView as any) ?? ""} />
          </clipPath>
        </defs>

        {/* data (clipped) */}
        <g clipPath={`url(#${clipId})`} onClick={() => onPointClick?.(null)}>
          {"points_named" in (payload as any) ? (
            decodedNamedPoints.map((pt, i) => {
              const [lon, lat, name] = pt;
              const p = projection([lon, lat] as any);
              if (!p) return null;

              const visibleR = Math.max(0.35, (variant === "large" ? 2.6 : 1.4) / (viewScale ?? 1));
              const hitR = Math.max(visibleR, 12 / (viewScale ?? 1));

              if (variant !== "large") {
                // mini variant: simpler circles (fewer due to cap)
                return <circle key={i} cx={p[0]} cy={p[1]} r={visibleR} fill="#93c5fd" fillOpacity={0.38} />;
              }

              return (
                <g key={i} style={{ cursor: "pointer" }}>
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r={visibleR}
                    fill="#93c5fd"
                    fillOpacity={0.5}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      onPointHover?.({ x: p[0], y: p[1], name });
                    }}
                    onMouseLeave={(e) => {
                      e.stopPropagation();
                      onPointHover?.(null);
                    }}
                  />
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r={hitR}
                    fill="rgba(0,0,0,0.0001)"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerEnter={(e) => {
                      e.stopPropagation();
                      onPointHover?.({ x: p[0], y: p[1], name });
                    }}
                    onPointerLeave={(e) => {
                      e.stopPropagation();
                      onPointHover?.(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPointClick?.({ x: p[0], y: p[1], name });
                    }}
                  />
                </g>
              );
            })
          ) : "points_q" in (payload as any) ? (
            variant === "large" ? (
              decodedPoints.map((pt, i) => {
                const p = projection(pt as any);
                if (!p) return null;
                return (
                  <circle
                    key={i}
                    cx={p[0]}
                    cy={p[1]}
                    r={Math.max(0.35, (variant === "large" ? 2.6 : 1.4) / (viewScale ?? 1))}
                    fill="#93c5fd"
                    fillOpacity={variant === "large" ? 0.5 : 0.38}
                  />
                );
              })
            ) : (
              // mini variant: fewer circles (capped earlier)
              decodedPoints.map((pt, i) => {
                const p = projection(pt as any);
                if (!p) return null;
                return <circle key={i} cx={p[0]} cy={p[1]} r={0.9} fill="#93c5fd" fillOpacity={0.38} />;
              })
            )
          ) : (
            variant === "large" ? (
              cells.map((d: any, i: number) => {
                const dStr = path({ type: "Feature", geometry: d.poly, properties: {} } as any) ?? "";
                return (
                  <path
                    key={i}
                    d={dStr}
                    fill={color(d.c)}
                    fillOpacity={0.85}
                    stroke="#0a0a0a"
                    strokeOpacity={0.35}
                    strokeWidth={0.6}
                    onMouseEnter={() => setHover({ count: d.c, x: d.x, y: d.y })}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })
            ) : (
              // mini variant: combine all tile polygons into a single path to reduce DOM & layout overhead
              <path
                d={cellsPath}
                fill="#93c5fd"
                fillOpacity={0.85}
                stroke="#0a0a0a"
                strokeOpacity={0.35}
                strokeWidth={0.6}
                pointerEvents="auto"
              />
            )
          )}
        </g>

        {/* ✅ borders from admin1 (НЕ клипать) */}
        {admin1PathD && (
          <path
            d={admin1PathD}
            fill="none"
            stroke="#71717a"
            strokeOpacity={variant === "large" ? 0.35 : 0.28}
            strokeWidth={borderStrokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
      </svg>

      {hover && !("points_q" in (payload as any)) && (
        <div className="absolute right-2 top-2 rounded-lg bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-200 border border-zinc-800">
          {hover.count} in tile ({hover.x},{hover.y})
        </div>
      )}
    </div>
  );
}
