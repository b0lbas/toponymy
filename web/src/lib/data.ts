export type Hotspot = [number, number, number]; // [x,y,count] in slippy-tile space

export type PatternIndexEntry = {
  pattern: string;
  title: string;
  mode: "suffix" | "prefix" | "substring";
  zoom: number;
  places: number;
  file: string; // gz JSON
  tiles?: number;
  score?: number;
  entropy?: number;
  hotspots?: Hotspot[]; // top-N tiles for quick "hotspot" preview
  points?: number | null;
  points_sampled?: boolean | null;
};

export type CountryPatternsIndex = {
  country_id: string;
  country_name: string;
  modes: string[];
  default_mode: string;
  default_zoom: number;
  patterns: PatternIndexEntry[];
  selection_mode?: string;
  min_places_for_candidate?: number;
  analyze_tail_token_only?: boolean;
  suffix_len?: [number, number];
};

export type PatternCellsPayload = {
  country_id: string;
  pattern: string;
  mode: string;
  zoom: number;
  cells: [number, number, number][]; // [x,y,count]
  total_places: number;
};

export type PatternPointsPayload = {
  country_id: string;
  pattern: string;
  mode: string;
  zoom: number; // kept for metadata/compat; not used for point rendering
  total_places: number;
  points_q: [number, number][]; // [lon_q, lat_q]
  points_named?: [number, number, string][]; // [lon_q, lat_q, name]
  points_scale: number; // divide quantized ints by this
  points_sampled?: boolean;
  points_named_sampled?: boolean;
};

export type PatternPayload = PatternCellsPayload | PatternPointsPayload;

/**
 * A tiny in-browser fetch queue:
 * - caps concurrent downloads (prevents 100+ pattern requests nuking the main thread)
 * - caches parsed JSON by URL (so reopening the same country/pattern is instant)
 */
const MAX_INFLIGHT = 6;

let inflight = 0;
const waiters: Array<() => void> = [];
const jsonCache = new Map<string, Promise<any>>();

async function runLimited<T>(task: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inflight++;
  try {
    return await task();
  } finally {
    inflight--;
    const next = waiters.shift();
    if (next) next();
  }
}

function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = jsonCache.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = factory().catch((e) => {
    // don’t poison the cache with errors
    jsonCache.delete(key);
    throw e;
  });

  jsonCache.set(key, p);
  return p;
}

async function fetchJsonUncached<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} while fetching ${url}`);
  return (await r.json()) as T;
}

export async function fetchJson<T>(url: string): Promise<T> {
  return cached(url, () => runLimited(() => fetchJsonUncached<T>(url)));
}

async function fetchJsonGzUncached<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} while fetching ${url}`);
  }

  // Some hosts (e.g., CDNs) will serve *.json.gz with Content-Encoding: gzip and
  // transparently decompress for the browser. In that case, trying to gunzip
  // again will fail. So we first try to parse the response as plain JSON.
  const buf = await r.arrayBuffer();
  const u8 = new Uint8Array(buf);

  const tryParsePlainJson = () => {
    try {
      const text = new TextDecoder().decode(u8);
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return JSON.parse(trimmed) as T;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const plain = tryParsePlainJson();
  if (plain) return plain;

  // If plain parse failed, treat as gzip.
  // @ts-ignore
  if (typeof DecompressionStream !== "undefined") {
    // @ts-ignore
    const ds = new DecompressionStream("gzip");
    const stream = new Response(new Blob([u8]).stream().pipeThrough(ds));
    const text = await stream.text();
    return JSON.parse(text) as T;
  }

  throw new Error(
    "This browser cannot decompress .gz files (DecompressionStream unavailable). " +
      "Serve plain .json instead, or use a modern browser."
  );
}

export async function fetchJsonGz<T>(url: string): Promise<T> {
  return cached(url, () => runLimited(() => fetchJsonGzUncached<T>(url)));
}

export function toDataCountryId(idLike: unknown): string {
  const s = (idLike ?? "").toString();
  if (/^\d+$/.test(s)) return s.padStart(3, "0");
  return s;
}
