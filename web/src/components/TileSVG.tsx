import { useId, useMemo, useState } from "react";
import * as d3 from "d3";
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

  const west = lon1;
  const east = lon2;
  const south = lat2;
  const north = lat1;
  return { west, south, east, north };
}

function keepLargestPolygonOnly(feature: any) {
  const g = feature?.geometry;
  if (!g || g.type !== "MultiPolygon") return feature;

  // Prefer the polygon whose centroid is closest to the country's overall centroid.
  // This avoids selecting a distant island / Far-East fragment for large countries.
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
    // Fallback: choose the largest polygon by area
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
  // Any adjacent lon jump > 180° OR total lon span > 180°.
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

function sampleLongitudes(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  maxSamples = 8000
): number[] {
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

/**
 * Choose a “safe” central meridian so the projection seam falls into the largest longitude gap
 * of the country (important for Russia and other dateline-crossing geometries).
 */
function computeSafeCentralMeridian(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number | null {
  if (!geomCrossesAntimeridian(geom)) return null;

  const lons = sampleLongitudes(geom, 8000);
  if (lons.length < 2) return null;

  const a = lons.map(wrap360).sort((x, y) => x - y);
  const n = a.length;
  if (n < 2) return null;

  let bestGap = -Infinity;
  let bestI = 0;
  let bestNext = 0;

  for (let i = 0; i < n; i++) {
    const next = i === n - 1 ? a[0] + 360 : a[i + 1]; // ✅ important: wrap-around gap uses +360
    const gap = next - a[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestI = i;
      bestNext = next;
    }
  }

  // Empty gap is (a[bestI] .. bestNext). Country occupies the complement arc:
  // [bestNext .. a[bestI]+360]. Take its midpoint.
  const mid = (bestNext + (a[bestI] + 360)) / 2;

  return wrap180(mid);
}

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

  // Keep-largest only where it реально нужно (ЮАР). Россию не режем, а чиним шов проекцией.
  const countryForView = useMemo(() => {
    if (String((country as any).id) === "710") return keepLargestPolygonOnly(country as any);
    return country;
  }, [country]);

  const { path, projection } = useMemo(() => {
    const proj = d3.geoMercator();

    // ✅ Robust dateline fix: choose a safe central meridian (seam goes into the biggest gap).
    try {
      const g = (countryForView as any)?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined;
      if (g) {
        const cm = computeSafeCentralMeridian(g);
        if (cm != null) proj.rotate([-cm, 0]);
      }
    } catch {
      // best effort
    }

    proj.fitExtent(
      [
        [pad, pad],
        [width - pad, height - pad],
      ],
      countryForView as any
    );

    const p = d3.geoPath(proj);
    return { path: p, projection: proj };
  }, [countryForView, width, height]);

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

  const decodedPoints = useMemo(() => {
    if (!("points_q" in (payload as any))) return [];
    const scale = (payload as any).points_scale ?? 10000;
    const pts = (payload as any).points_q as [number, number][];
    const maxRender = variant === "large" ? 20000 : 5000;

    if (pts.length <= maxRender) {
      return pts.map(([lonq, latq]) => [lonq / scale, latq / scale] as [number, number]);
    }

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
    const maxRender = variant === "large" ? 20000 : 5000;

    if (pts.length <= maxRender) {
      return pts.map(([lonq, latq, name]) => [lonq / scale, latq / scale, name] as [number, number, string]);
    }

    const step = pts.length / maxRender;
    const out: [number, number, string][] = [];
    for (let i = 0; i < maxRender; i++) {
      const idx = Math.floor(i * step);
      const [lonq, latq, name] = pts[idx];
      out.push([lonq / scale, latq / scale, name]);
    }
    return out;
  }, [payload, variant]);

  const maxC = useMemo(() => d3.max(cells, (d) => d.c) ?? 1, [cells]);

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

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full">
        <defs>
          <clipPath id={clipId}>
            <path d={path(countryForView as any) ?? ""} />
          </clipPath>
        </defs>

        {/* base country outline */}
        <path d={path(countryForView as any) ?? ""} fill="none" stroke="#3f3f46" strokeWidth={1.2} />

        {/* data */}
        <g clipPath={`url(#${clipId})`} onClick={() => onPointClick?.(null)}>
          {"points_named" in (payload as any) ? (
            decodedNamedPoints.map((pt, i) => {
              const [lon, lat, name] = pt;
              const p = projection([lon, lat] as any);
              if (!p) return null;

              const visibleR = Math.max(0.35, (variant === "large" ? 2.6 : 1.4) / (viewScale ?? 1));
              const hitR = Math.max(visibleR, 12 / (viewScale ?? 1));

              if (variant !== "large") {
                return (
                  <circle key={i} cx={p[0]} cy={p[1]} r={visibleR} fill="#93c5fd" fillOpacity={0.38} />
                );
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
            cells.map((d, i) => {
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
          )}
        </g>
      </svg>

      {hover && !("points_q" in (payload as any)) && (
        <div className="absolute right-2 top-2 rounded-lg bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-200 border border-zinc-800">
          {hover.count} in tile ({hover.x},{hover.y})
        </div>
      )}
    </div>
  );
}
