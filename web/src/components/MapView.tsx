import { useEffect, useMemo, useRef } from "react";
import maplibregl, { Map, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import style from "../map/style.json";
import { CountryFeature } from "../lib/world";

export type { CountryFeature };

type Props = {
  countries: CountryFeature[];
  selectedId: string | null;
  onSelect: (country: CountryFeature) => void;
};

function toFeatureCollection(countries: CountryFeature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: countries };
}

function normalizeId(idLike: unknown): string {
  const s = (idLike ?? "").toString();
  // Try to normalize numeric ids with/without leading zeros: "008" -> "8"
  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n) && s.match(/^\d+$/)) return String(n);
  return s;
}

export default function MapView({ countries, selectedId, onSelect }: Props) {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const countriesFC = useMemo(() => toFeatureCollection(countries), [countries]);
  const countriesFCRef = useRef(countriesFC);
  const countriesRef = useRef(countries);

  // keep latest data for the "load" handler (avoids race where countries load before map finishes loading)
  useEffect(() => {
    countriesFCRef.current = countriesFC;
  }, [countriesFC]);

  // keep latest array for click handler (avoids stale closure in dev / async loads)
  useEffect(() => {
    countriesRef.current = countries;
  }, [countries]);

  useEffect(() => {
    if (!containerRef.current) return;

    // React StrictMode runs effects twice in dev:
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
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
      map.addSource("countries", {
        type: "geojson",
        data: countriesFCRef.current as any,
      });

      map.addLayer({
        id: "countries-fill",
        type: "fill",
        source: "countries",
        layout: {
          // Draw large polygons first, small ones last (microstates on top).
          "fill-sort-key": ["*", -1, ["coalesce", ["get", "area"], 0]],
        },
        paint: {
          "fill-color": ["case", ["==", ["id"], selectedId ?? ""], "#60a5fa", "#27272a"],
          "fill-opacity": 0.35,
        },
      });

      map.addLayer({
        id: "countries-line",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "#52525b",
          "line-width": 1.2,
          "line-opacity": 0.8,
        },
      });

      map.on("mousemove", "countries-fill", (e) => {
        map.getCanvas().style.cursor = e.features?.length ? "pointer" : "";
      });
      map.on("mouseleave", "countries-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "countries-fill", (e) => {
        // Query all rendered features and pick the smallest by (precomputed) area.
        const feats = map.queryRenderedFeatures(e.point, { layers: ["countries-fill"] }) as any[];
        const feat =
          feats
            .map((f) => ({ f, area: Number(f.properties?.area ?? Infinity) }))
            .sort((a, b) => a.area - b.area)[0]?.f ?? (e.features?.[0] as any);

        if (!feat) return;

        const idRaw = feat.id ?? feat.properties?.id ?? "";
        const id = normalizeId(idRaw);
        const name = (feat.properties?.name ?? "Unknown").toString();

        const list = countriesRef.current ?? [];
        const found =
          list.find((c) => c.id === id) ||
          list.find((c) => c.id === idRaw?.toString()) ||
          list.find((c) => c.id === normalizeId(idRaw?.toString()));

        if (found) onSelect(found);
        else onSelect({ ...(feat as any), id, properties: { name } } as CountryFeature);
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update geojson source when countries load
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("countries") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(countriesFC as any);
  }, [countriesFC]);

  // Update selected coloring
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

  return <div ref={containerRef} className="h-full w-full" />;
}
