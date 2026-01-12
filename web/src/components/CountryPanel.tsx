import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CountryFeature } from "./MapView";
import type { CountryPatternsIndex, PatternIndexEntry } from "../lib/data";
import { fetchJson, toDataCountryId } from "../lib/data";
import SmallMultiple from "./SmallMultiple";
import likes, { API_BASE } from "../lib/likes";

type Props = {
  country: CountryFeature;
  onClose: () => void;
};

type SortMode = "localized" | "common" | "az" | "popularity";

const PAGE_SIZE = 40;

function normalizeIndex(idx: CountryPatternsIndex): CountryPatternsIndex {
  const seen = new Set<string>();
  const deduped: PatternIndexEntry[] = [];

  for (const p of idx?.patterns ?? []) {
    const key = `${p.file ?? ""}|${p.mode ?? ""}|${p.pattern ?? ""}|${p.zoom ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  if (!idx?.patterns || deduped.length === idx.patterns.length) return idx;
  return { ...idx, patterns: deduped };
}

function tileCenterLonLat(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const merc2lat = (a: number) => (180 / Math.PI) * Math.atan(Math.sinh(a));
  const lat = merc2lat(Math.PI * (1 - (2 * (y + 0.5)) / n));
  return { lon, lat };
}

function fmtCoord(v: number) {
  return (Math.round(v * 10) / 10).toFixed(1);
}

export default function CountryPanel({ country, onClose }: Props) {
  const [index, setIndex] = useState<CountryPatternsIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenPatterns, setHiddenPatterns] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const [sort, setSort] = useState<SortMode>("localized");
  const [mode, setMode] = useState<string>("suffix");

  // progressive rendering (no “Show more” button, loads automatically while you scroll)
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const guard = <T,>(fn: (value: T) => void) => (value: T) => {
      if (cancelled) return;
      fn(value);
    };

    setIndex(null);
    setError(null);
    setQuery("");
    setSort("localized");
    setHiddenPatterns(new Set());

    const cid = toDataCountryId(country.id);
    const url = `/data/${cid}/${mode === "prefix" ? "patterns_prefix.json" : "patterns.json"}`;
    fetchJson<CountryPatternsIndex>(url)
      .then(guard((idx) => {
        setIndex(normalizeIndex(idx));
      }))
      .catch(() => {
        if (mode === "prefix") {
          const fallbackUrl = `/data/${cid}/patterns.json`;
          fetchJson<CountryPatternsIndex>(fallbackUrl)
            .then(guard((idx) => {
              setMode("suffix");
              setIndex(normalizeIndex(idx));
              setError(null);
            }))
            .catch(() => {
              if (cancelled) return;
              setError("None");
            });
          return;
        }
        if (!cancelled) setError("None");
      });

    fetch(`${API_BASE}/patterns/hidden?country_id=${country.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(guard((data) => {
        if (data?.hidden) {
          setHiddenPatterns(new Set(data.hidden));
        }
      }))
      .catch(() => {
        // Silently fail, just show all patterns
      });

    return () => {
      cancelled = true;
    };
  }, [country.id, mode]);

  const searchKeyFor = useMemo(() => {
    const wm = new WeakMap<PatternIndexEntry, string>();
    const all = index?.patterns ?? [];
    for (const p of all) {
      wm.set(p, (p.pattern + " " + (p.title ?? "")).toLowerCase());
    }
    return wm;
  }, [index]);

  const [likesTick, setLikesTick] = useState(0);
  const [allLikesCache, setAllLikesCache] = useState<Record<string, string[]>>({});

  useEffect(() => {
    // Load all likes on mount and subscribe to changes
    likes.getAllLikes().then(setAllLikesCache);
    const off = likes.onLikesChange((key) => {
      // Refetch all likes on any change
      // Small delay (100ms) to ensure server has fully processed the like/unlike
      setTimeout(() => {
        likes.getAllLikes().then(setAllLikesCache);
        setLikesTick((t) => t + 1);
      }, 100);
    });
    return off;
  }, []);

  const patternKeyFor = (p: PatternIndexEntry) => `${country.id}|${p.file ?? `${p.pattern}|${p.mode}|${p.zoom}`}`;

  const baseSorted: PatternIndexEntry[] = useMemo(() => {
    // Deduplicate aggressively even if upstream data sneaks duplicates in (seen for France/prefix creac)
    const deduped: PatternIndexEntry[] = [];
    const seen = new Set<string>();
    for (const p of index?.patterns ?? []) {
      const key = p.file ?? `${p.pattern}|${p.mode}|${p.zoom}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
    }

    const sorted = [...deduped];

    if (sort === "az") {
      sorted.sort((a, b) => a.pattern.localeCompare(b.pattern));
    } else if (sort === "common") {
      sorted.sort((a, b) => (b.places ?? 0) - (a.places ?? 0) || a.pattern.localeCompare(b.pattern));
    } else if (sort === "popularity") {
      sorted.sort((a, b) => (allLikesCache[patternKeyFor(b)]?.length ?? 0) - (allLikesCache[patternKeyFor(a)]?.length ?? 0) || (b.places ?? 0) - (a.places ?? 0) || a.pattern.localeCompare(b.pattern));
    } else {
      // localized (score desc, then places desc)
      sorted.sort(
        (a, b) =>
          (b.score ?? 0) - (a.score ?? 0) ||
          (b.places ?? 0) - (a.places ?? 0) ||
          a.pattern.localeCompare(b.pattern)
      );
    }

    return sorted;
  }, [index, sort, likesTick, country.id, allLikesCache]);

  const filteredSorted: PatternIndexEntry[] = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return baseSorted.filter(p => !hiddenPatterns.has(p.pattern));
    return baseSorted.filter((p) => (searchKeyFor.get(p) ?? "").includes(q) && !hiddenPatterns.has(p.pattern));
  }, [baseSorted, deferredQuery, searchKeyFor, hiddenPatterns]);

  // reset progressive render when user changes country/query/sort
  useEffect(() => {
    setRenderLimit(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [country.id, sort, deferredQuery, mode]);

  // auto-load next “page” while scrolling
  useEffect(() => {
    const root = scrollRef.current;
    const target = loadMoreRef.current;
    if (!root || !target) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setRenderLimit((cur) => Math.min(cur + PAGE_SIZE, filteredSorted.length));
      },
      { root, rootMargin: "900px 0px" }
    );

    obs.observe(target);
    return () => obs.disconnect();
  }, [filteredSorted.length]);

  const shown = useMemo(() => filteredSorted.slice(0, renderLimit), [filteredSorted, renderLimit]);

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <div className="text-xl font-semibold tracking-tight">{country.properties.name}</div>
          <div className="mt-1 text-xs text-zinc-400">
            Country id: <span className="font-mono">{country.id}</span>
          </div>

          {index?.patterns?.length ? (
            <div className="mt-1 text-xs text-zinc-500">
              Patterns: <span className="font-mono">{index.patterns.length.toLocaleString()}</span>
              {filteredSorted.length !== index.patterns.length ? (
                <>
                  {" "}
                  • filtered: <span className="font-mono">{filteredSorted.length.toLocaleString()}</span>
                </>
              ) : null}{" "}
              • showing: <span className="font-mono">{shown.length.toLocaleString()}</span>
            </div>
          ) : null}
        </div>

        <button
          onClick={onClose}
          className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
          aria-label="Close country panel"
          title="Close"
        >
          Close
        </button>
      </div>

      {/* controls */}
      <div className="px-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "prefix" ? "Search prefix…" : "Search suffix…"}
            className="w-full flex-1 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-700 sm:w-auto"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
            title="Sort"
          >
            <option value="localized">Most localized</option>
            <option value="common">Most common</option>
            <option value="popularity">By popularity</option>
            <option value="az">A–Z</option>
          </select>
          {/* Mode toggle */}
          <button
            type="button"
            onClick={() => setMode((m) => (m === "suffix" ? "prefix" : "suffix"))}
            aria-pressed={mode === "prefix"}
            title="Toggle suffix/prefix"
            className={
              "rounded-xl border border-zinc-800 px-3 py-2 text-sm font-medium text-white outline-none focus:border-zinc-700 " +
              (mode === "suffix" ? "bg-rose-950 hover:bg-rose-900" : "bg-emerald-950 hover:bg-emerald-900")
            }
          >
            {mode}
          </button>
        </div>
      </div>

      {/* body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {error ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">{error}</div>
        ) : !index ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">Loading…</div>
        ) : filteredSorted.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
            No patterns match your search.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {shown.map((p) => (
                <div
                  key={p.file ?? `${p.pattern}|${p.mode}|${p.zoom}`}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5">{p.pattern}</span>
                      <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5">
                        {p.places.toLocaleString()} places
                      </span>
                      <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5">z{p.zoom}</span>
                      {typeof p.score === "number" ? (
                        <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5">
                          score {p.score.toFixed(2)}
                        </span>
                      ) : null}
                    </div>

                    {p.hotspots?.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-500">hotspots:</span>
                        {p.hotspots.slice(0, 3).map(([x, y, c], i) => {
                          const { lon, lat } = tileCenterLonLat(x, y, p.zoom);
                          return (
                            <span
                              key={i}
                              className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5 font-mono"
                              title={`tile (${x},${y}) @ z${p.zoom}`}
                            >
                              {fmtCoord(lat)},{fmtCoord(lon)} · {c}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <SmallMultiple country={country} entry={p} />
                </div>
              ))}
            </div>

            {/* sentinel for auto “load next page” */}
            <div ref={loadMoreRef} className="h-10" />

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
              Tip: This UI renders patterns progressively for speed. All patterns remain available — just scroll.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
