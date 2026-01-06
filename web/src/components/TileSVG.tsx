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

  let bestIdx = 0;
  let bestArea = -Infinity;

  g.coordinates.forEach((coords: any, i: number) => {
    const poly: GeoJSON.Polygon = { type: "Polygon", coordinates: coords };
    const a = d3.geoArea(poly as any);
    if (a > bestArea) {
      bestArea = a;
      bestIdx = i;
    }
  });

  return {
    ...feature,
    geometry: {
      type: "Polygon",
      coordinates: g.coordinates[bestIdx],
    },
  };
}

export default function TileSVG({ country, payload, variant = "mini", viewScale = 1, onPointClick }: Props) {
  const [hover, setHover] = useState<{ count: number; x: number; y: number } | null>(null);

  const width = variant === "large" ? 980 : 520;
  const height = variant === "large" ? 620 : 320;
  const pad = 10;

  // Only for South Africa (ISO numeric id = "710"): drop distant islands by keeping the largest polygon
  const countryForView = useMemo(() => {
    if ((country as any).id === "710") return keepLargestPolygonOnly(country as any);
    return country;
  }, [country]);

  const { path, projection } = useMemo(() => {
    const proj = d3.geoMercator();
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

  // If named points are present, decode them similarly (and respect maxRender)
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

  // Labels are rendered by the parent overlay (`SmallMultiple`). No local label state is kept here.

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
              const hitR = Math.max(visibleR, (12 / (viewScale ?? 1)));

              // For mini variants we render a simple marker without interactive hit targets
              if (variant !== "large") {
                return (
                  <circle
                    key={i}
                    cx={p[0]}
                    cy={p[1]}
                    r={visibleR}
                    fill="#93c5fd"
                    fillOpacity={0.38}
                  />
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
                  {/* invisible but pointer-enabled hit target to improve hover & click reliability */}
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
