import { useEffect, useMemo, useRef, useState } from "react";
import auth from "../lib/auth";
import { API_BASE } from "../lib/likes";
import type { CountryPatternsIndex, PatternIndexEntry, PatternPayload } from "../lib/data";
import { fetchJson, fetchJsonGz, toDataCountryId } from "../lib/data";
import type { CountryFeature } from "./MapView";
import TileSVG from "./TileSVG";

type ReportRow = {
  id?: string;
  country_id?: string;
  countryId?: string;
  pattern?: string;
  note?: string;
  reason?: string;
  user_id?: string;
  userId?: string;
  status?: string;
  created_at?: number | string;
};

function getAdminUserId() {
  const vite = (import.meta as any).env?.VITE_ADMIN_USER_ID;
  return vite || "user_1767857068696";
}

export default function AdminPanel() {
  const [userId, setUserId] = useState<string | null>(() => auth.getCurrentUser());
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [indexByCountry, setIndexByCountry] = useState<Record<string, CountryPatternsIndex | null>>({});
  const [payloadByKey, setPayloadByKey] = useState<Record<string, PatternPayload | null>>({});
  const [previewScaleByKey, setPreviewScaleByKey] = useState<Record<string, number>>({});
  const previewWrapRef = useRef<Record<string, HTMLDivElement | null>>({});
  const previewCenteredRef = useRef<Record<string, boolean>>({});

  const PREVIEW_BASE_W = 520;
  const PREVIEW_BASE_H = 320;

  useEffect(() => {
    return auth.onAuthChange((u) => setUserId(u));
  }, []);

  const isAdmin = useMemo(() => userId === getAdminUserId(), [userId]);

  const load = async () => {
    setError(null);

    const token = auth.getToken();
    if (!token) {
      setReports([]);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/admin/reports?status=pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Failed to load reports (${res.status})`);
        setReports([]);
        return;
      }
      const data = await res.json();
      setReports(Array.isArray(data?.reports) ? data.reports : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load reports");
      setReports([]);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!reports || reports.length === 0) return;

    const countries = Array.from(
      new Set(
        reports
          .map((r) => (r.country_id || r.countryId || "").toString())
          .filter(Boolean)
      )
    );

    const missing = countries.filter((c) => !(c in indexByCountry));
    if (missing.length === 0) return;

    let cancelled = false;

    (async () => {
      const results: Record<string, CountryPatternsIndex | null> = {};
      await Promise.all(
        missing.map(async (countryId) => {
          try {
            const cid = toDataCountryId(countryId);
            const url = `/data/${encodeURIComponent(cid)}/patterns.json`;
            const idx = await fetchJson<CountryPatternsIndex>(url);
            results[countryId] = idx;
          } catch {
            results[countryId] = null;
          }
        })
      );

      if (cancelled) return;
      setIndexByCountry((prev) => ({ ...prev, ...results }));
    })();

    return () => {
      cancelled = true;
    };
  }, [reports, indexByCountry]);

  useEffect(() => {
    if (!reports || reports.length === 0) return;

    const needed: Array<{ countryId: string; pattern: string }> = [];
    for (const r of reports) {
      const countryId = (r.country_id || r.countryId || "").toString();
      const pattern = (r.pattern || "").toString();
      if (!countryId || !pattern) continue;

      // Wait for country index to load before deciding payload availability.
      if (indexByCountry[countryId] === undefined) continue;

      const key = `${countryId}|${pattern}`;
      if (payloadByKey[key] !== undefined) continue;
      needed.push({ countryId, pattern });
    }

    if (needed.length === 0) return;

    let cancelled = false;

    (async () => {
      const updates: Record<string, PatternPayload | null> = {};

      await Promise.all(
        needed.map(async ({ countryId, pattern }) => {
          const key = `${countryId}|${pattern}`;
          const entry = getEntryForReport(countryId, pattern);
          if (!entry?.file) {
            updates[key] = null;
            return;
          }

          const file = entry.file.toString().replace(/^\/+/, "");
          const cid = toDataCountryId(countryId);
          const url = `/data/${encodeURIComponent(cid)}/${encodeURI(file)}`;

          try {
            const payload = await fetchJsonGz<PatternPayload>(url);
            updates[key] = payload;
          } catch {
            updates[key] = null;
          }
        })
      );

      if (cancelled) return;
      setPayloadByKey((prev) => ({ ...prev, ...updates }));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, indexByCountry, payloadByKey]);

  const getEntryForReport = (countryId: string, pattern: string): PatternIndexEntry | null => {
    const idx = indexByCountry[countryId];
    if (!idx?.patterns?.length) return null;
    return idx.patterns.find((p) => p.pattern === pattern) ?? null;
  };

  const decodedPointsForPayload = (payload: PatternPayload | null) => {
    if (!payload) return [] as Array<{ lon: number; lat: number; name: string | null }>;
    const anyPayload = payload as any;
    const scale = anyPayload.points_scale ?? 10000;

    if (Array.isArray(anyPayload.points_named)) {
      return (anyPayload.points_named as [number, number, string][])?.map(([lonq, latq, name]) => ({
        lon: lonq / scale,
        lat: latq / scale,
        name: typeof name === "string" && name.trim() ? name : null,
      }));
    }

    if (Array.isArray(anyPayload.points_q)) {
      return (anyPayload.points_q as [number, number][])?.map(([lonq, latq]) => ({
        lon: lonq / scale,
        lat: latq / scale,
        name: null,
      }));
    }

    return [] as Array<{ lon: number; lat: number; name: string | null }>;
  };

  const getPreviewScale = (key: string) => previewScaleByKey[key] ?? 12;

  const updatePreviewScale = (key: string, next: number) => {
    const clamped = Math.max(0.5, Math.min(96, next));
    setPreviewScaleByKey((prev) => (prev[key] === clamped ? prev : { ...prev, [key]: clamped }));
  };

  const centerPreview = (key: string) => {
    const el = previewWrapRef.current[key];
    if (!el) return;
    const scale = getPreviewScale(key);
    const contentW = PREVIEW_BASE_W * scale;
    const contentH = PREVIEW_BASE_H * scale;
    const targetLeft = Math.max(0, (contentW - el.clientWidth) / 2);
    const targetTop = Math.max(0, (contentH - el.clientHeight) / 2);
    el.scrollLeft = targetLeft;
    el.scrollTop = targetTop;
  };

  const buildPreviewCountry = (
    countryId: string,
    countryName: string,
    points: Array<{ lon: number; lat: number }>
  ): CountryFeature | null => {
    if (!points.length) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const p of points) {
      if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
    if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) return null;
    if (minLon === maxLon) {
      minLon -= 0.05;
      maxLon += 0.05;
    }
    if (minLat === maxLat) {
      minLat -= 0.05;
      maxLat += 0.05;
    }

    const geometry: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    } as any;

    return {
      type: "Feature",
      id: countryId,
      properties: { id: countryId, name: countryName || countryId },
      geometry,
    } as CountryFeature;
  };

  const accept = async (r: ReportRow) => {
    const token = auth.getToken();
    if (!token) return;

    const country_id = (r.country_id || r.countryId || "").toString();
    const pattern = (r.pattern || "").toString();
    const report_id = r.id;

    if (!country_id || !pattern) return;

    setBusyKey(`${country_id}|${pattern}|accept`);
    try {
      const res = await fetch(`${API_BASE}/admin/reports/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ country_id, pattern, report_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Accept failed");
      }
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const reject = async (r: ReportRow) => {
    const token = auth.getToken();
    if (!token) return;

    const country_id = (r.country_id || r.countryId || "").toString();
    const pattern = (r.pattern || "").toString();
    const report_id = r.id;

    if (!report_id && (!country_id || !pattern)) return;

    setBusyKey(`${country_id}|${pattern}|reject`);
    try {
      const res = await fetch(`${API_BASE}/admin/reports/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ country_id, pattern, report_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Reject failed");
      }
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Admin</div>
          <div className="flex items-center gap-2">
            {userId ? (
              <button
                onClick={() => auth.logout()}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
              >
                Logout
              </button>
            ) : (
              <button
                onClick={() => auth.showAuth()}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
              >
                Sign in
              </button>
            )}
            <a
              href="/"
              className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
            >
              Back
            </a>
          </div>
        </div>
        <div className="mt-1 text-xs text-zinc-400">Pending reports</div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {!userId ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
            Sign in as admin to review reports.
          </div>
        ) : !isAdmin ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">Not authorized.</div>
        ) : error ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">{error}</div>
        ) : reports === null ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">No pending reports.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {reports.map((r, i) => {
              const country_id = (r.country_id || r.countryId || "").toString();
              const pattern = (r.pattern || "").toString();
              const reporter = (r.user_id || r.userId || "").toString();
              const keyBase = `${country_id}|${pattern}|${i}`;

              const entry = country_id && pattern ? getEntryForReport(country_id, pattern) : null;
              const payloadKey = country_id && pattern ? `${country_id}|${pattern}` : "";
              const payload = payloadKey ? payloadByKey[payloadKey] : null;
              const decodedPoints = decodedPointsForPayload(payload);
              const countryName = indexByCountry[country_id]?.country_name || "";
              const previewCountry = payload
                ? buildPreviewCountry(country_id, countryName, decodedPoints)
                : null;

              return (
                <div key={keyBase} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5 text-xs font-mono">
                          {country_id}
                        </span>
                        {countryName ? (
                          <span className="text-sm font-semibold text-zinc-100">{countryName}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5">
                          {pattern}
                        </span>
                        {entry?.title && entry.title !== pattern ? (
                          <span className="text-zinc-300">{entry.title}</span>
                        ) : null}
                        {entry?.places ? (
                          <span className="text-zinc-500">· {entry.places.toLocaleString()} places</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={busyKey === `${country_id}|${pattern}|accept`}
                        onClick={() => accept(r)}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950 disabled:opacity-60"
                      >
                        Accept (hide)
                      </button>
                      <button
                        disabled={busyKey === `${country_id}|${pattern}|reject`}
                        onClick={() => reject(r)}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 text-xs text-zinc-400">
                    reported by <span className="font-mono">{reporter || "(unknown)"}</span>
                    {r.note || r.reason ? (
                      <>
                        {" "}• note: <span className="text-zinc-300">{(r.note || r.reason) as string}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    {!country_id || !pattern ? null : entry ? (
                      payloadByKey[payloadKey] === undefined ? (
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                          Loading cities…
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 lg:flex-row">
                          <div className="w-full shrink-0 lg:w-1/2">
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30">
                              {payload && previewCountry ? (
                                <div
                                  className="relative h-72 w-full overflow-auto rounded-2xl lg:h-[420px]"
                                  ref={(el) => {
                                    previewWrapRef.current[keyBase] = el;
                                    if (el && !previewCenteredRef.current[keyBase]) {
                                      previewCenteredRef.current[keyBase] = true;
                                      requestAnimationFrame(() => centerPreview(keyBase));
                                    }
                                  }}
                                  onWheel={(e) => {
                                    const container = e.currentTarget;
                                    const oldScale = getPreviewScale(keyBase);
                                    const delta = e.deltaY;
                                    const nextScale = oldScale * (delta > 0 ? 0.9 : 1.1);
                                    const clamped = Math.max(0.5, Math.min(96, nextScale));
                                    if (clamped === oldScale) return;

                                    const rect = container.getBoundingClientRect();
                                    const cursorX = e.clientX - rect.left + container.scrollLeft;
                                    const cursorY = e.clientY - rect.top + container.scrollTop;
                                    const ratio = clamped / oldScale;

                                    updatePreviewScale(keyBase, clamped);

                                    container.scrollLeft = cursorX * ratio - (e.clientX - rect.left);
                                    container.scrollTop = cursorY * ratio - (e.clientY - rect.top);
                                    e.preventDefault();
                                  }}
                                >
                                  <div
                                    className="origin-top-left"
                                    style={{
                                      transform: `scale(${getPreviewScale(keyBase)})`,
                                      width: `${PREVIEW_BASE_W}px`,
                                      height: `${PREVIEW_BASE_H}px`,
                                    }}
                                  >
                                    <TileSVG country={previewCountry} payload={payload} variant="mini" viewScale={1} renderMode="points" />
                                  </div>
                                  <div className="pointer-events-none absolute bottom-2 right-3 rounded-full border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 text-[11px] text-zinc-300">
                                    Zoom: {getPreviewScale(keyBase).toFixed(2)}×
                                  </div>
                                </div>
                              ) : (
                                <div className="p-3 text-xs text-zinc-500">Map preview unavailable.</div>
                              )}
                            </div>
                            <div className="mt-2 text-[11px] text-zinc-500">Scroll to zoom · use scrollbars to pan</div>
                          </div>

                          <div className="min-w-0 flex-1">
                            {decodedPoints.length > 0 ? (
                              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="text-xs text-zinc-400">
                                    Cities ({(payload as any)?.points ?? decodedPoints.length})
                                  </div>
                                  <div className="text-xs text-zinc-500">{decodedPoints.length.toLocaleString()}</div>
                                </div>
                                {(payload as any)?.points_sampled && (
                                  <div className="text-xs text-zinc-400 mb-2">Sampled (not all cities)</div>
                                )}
                                {!((payload as any) && "points_named" in (payload as any)) && (
                                  <div className="text-xs text-zinc-500 mb-2">
                                    Names not exported for this pattern — showing coordinates only.
                                  </div>
                                )}
                                <ul className="divide-y divide-zinc-800 text-sm">
                                  {decodedPoints.slice(0, 2000).map((p, idx) => (
                                    <li key={`${p.lon}-${p.lat}-${idx}`} className="py-2">
                                      <div className="font-medium text-zinc-100">
                                        {p.name ?? `(${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})`}
                                      </div>
                                      <div className="text-[11px] text-zinc-400">
                                        {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                                {decodedPoints.length > 2000 && (
                                  <div className="text-xs text-zinc-400 mt-2">
                                    Showing first 2000 of {decodedPoints.length}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                                No city list available for this pattern.
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    ) : indexByCountry[country_id] === undefined ? (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                        Loading country patterns…
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                        Pattern not found in /data/{country_id}/patterns.json
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
