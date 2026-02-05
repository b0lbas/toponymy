import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { CountryFeature } from "./MapView";
import type { PatternPayload, PatternIndexEntry } from "../lib/data";
import { fetchJsonGz } from "../lib/data";
import TileSVG from "./TileSVG";
import { AnimatePresence, motion } from "framer-motion";
import likes from "../lib/likes";
import auth from "../lib/auth";

type Props = {
  country: CountryFeature;
  entry: PatternIndexEntry;
  renderMode?: "points" | "heatmap";
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeId(idLike: unknown): string {
  const s = (idLike ?? "").toString();
  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n) && /^\d+$/.test(s)) return String(n);
  return s;
}

function uniqueStrings(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
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

function buildDataKeyCandidates(country: CountryFeature): string[] {
  const p: any = (country as any)?.properties ?? {};
  const raw = [
    // то, что раньше у тебя использовалось
    (country as any)?.id?.toString?.() ?? "",
    p?.id?.toString?.() ?? "",
    p?.ID?.toString?.() ?? "",
    // Natural Earth
    p?.ISO_N3?.toString?.() ?? "",
    p?.iso_n3?.toString?.() ?? "",
    p?.ADM0_A3?.toString?.() ?? "",
    p?.ISO_A3?.toString?.() ?? "",
    p?.adm0_a3?.toString?.() ?? "",
    p?.iso_a3?.toString?.() ?? "",
  ];

  const out: string[] = [];
  for (const k of raw) {
    if (!k) continue;
    out.push(k);
    out.push(normalizeId(k));
  }
  return uniqueStrings(out);
}

function sanitizeFile(file: string): string {
  // entry.file должен быть относительным файлом без ведущего "/"
  const f = (file ?? "").toString().replace(/^\/+/, "");
  // encodeURI сохраняет "/" (если вдруг), но кодирует пробелы и т.п.
  return encodeURI(f);
}

function buildUrlCandidates(country: CountryFeature, entryFile: string): string[] {
  const keys = buildDataKeyCandidates(country);
  const file = sanitizeFile(entryFile);

  const prefixes = ["/data", "data"]; // basePath-safe
  const urls: string[] = [];

  for (const pref of prefixes) {
    for (const key of keys) {
      // key — это сегмент пути => encodeURIComponent
      urls.push(`${pref}/${encodeURIComponent(key)}/${file}`);
    }
  }
  return uniqueStrings(urls);
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 26.0;
const PAN_PAD = 80;

const INERTIA_FRICTION = 0.92;
const INERTIA_STOP_SPEED = 10;

export default function SmallMultiple({ country, entry, renderMode = "points" }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const miniWrapRef = useRef<HTMLDivElement | null>(null);

  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<PatternPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [zoomUI, setZoomUI] = useState(1);
  const [selectedLabel, setSelectedLabel] = useState<{ name: string } | null>(null);
  const [reporting, setReporting] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const viewRef = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
  });

  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    vx: 0,
    vy: 0,
  });

  const rafRef = useRef<number | null>(null);
  const rafLastTRef = useRef<number>(0);

  // IntersectionObserver -> load only when near viewport
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px 0px" }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ✅ Robust payload loader (tries multiple URLs)
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    setPayload(null);
    setErr(null);

    const urls = buildUrlCandidates(country, entry.file);

    (async () => {
      let lastErr: any = null;

      for (const url of urls) {
        try {
          const data = await fetchJsonGz<PatternPayload>(url);
          if (cancelled) return;

          if ((import.meta as any).env?.MODE !== "production") {
            console.info("[SmallMultiple] payload loaded:", url);
          }

          setPayload(data);
          return;
        } catch (e) {
          lastErr = e;
        }
      }

      if (cancelled) return;

      console.error("[SmallMultiple] Failed to load payload. Tried:", urls, "Last error:", lastErr);
      setErr("Failed to load pattern data.");
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, country, entry.file]);

  const subtitle = useMemo(() => {
    const places = entry.places.toLocaleString();
    return `${places} places`;
  }, [entry.places]);

  const decodedNamedPoints = useMemo(() => {
    if (!payload) return [];
    const scale = (payload as any).points_scale ?? 10000;

    if ("points_named" in (payload as any) && Array.isArray((payload as any).points_named)) {
      const pts = (payload as any).points_named as [number, number, string][];
      return pts.map(([lonq, latq, name]) => ({ lon: lonq / scale, lat: latq / scale, name }));
    }

    if ("points_q" in (payload as any) && Array.isArray((payload as any).points_q)) {
      const pts = (payload as any).points_q as [number, number][];
      return pts.map(([lonq, latq]) => ({ lon: lonq / scale, lat: latq / scale, name: null }));
    }

    return [];
  }, [payload]);

  const applyTransform = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const { scale, tx, ty } = viewRef.current;
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const clampToBounds = () => {
    const vp = viewportRef.current;
    const sheet = sheetRef.current;
    if (!vp || !sheet) return;

    const { scale } = viewRef.current;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;

    const sw = sheet.offsetWidth;
    const sh = sheet.offsetHeight;

    const W = sw * scale;
    const H = sh * scale;

    if (W <= vw) viewRef.current.tx = (vw - W) / 2;
    else {
      const minTx = vw - W - PAN_PAD;
      const maxTx = PAN_PAD;
      viewRef.current.tx = clamp(viewRef.current.tx, minTx, maxTx);
    }

    if (H <= vh) viewRef.current.ty = (vh - H) / 2;
    else {
      const minTy = vh - H - PAN_PAD;
      const maxTy = PAN_PAD;
      viewRef.current.ty = clamp(viewRef.current.ty, minTy, maxTy);
    }
  };

  const centerView = (scale = 1) => {
    viewRef.current.scale = scale;
    viewRef.current.tx = 0;
    viewRef.current.ty = 0;
    clampToBounds();
    applyTransform();
    setZoomUI(viewRef.current.scale);
  };

  const stopInertia = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    rafLastTRef.current = 0;
  };

  const startInertia = () => {
    stopInertia();
    rafRef.current = requestAnimationFrame(function tick(ts) {
      const stage = stageRef.current;
      const vp = viewportRef.current;
      const sheet = sheetRef.current;
      if (!stage || !vp || !sheet) {
        stopInertia();
        return;
      }

      const last = rafLastTRef.current || ts;
      const dtMs = Math.max(1, ts - last);
      const dt = dtMs / 1000;
      rafLastTRef.current = ts;

      const friction = Math.pow(INERTIA_FRICTION, dtMs / 16);

      dragRef.current.vx *= friction;
      dragRef.current.vy *= friction;

      const speed = Math.hypot(dragRef.current.vx, dragRef.current.vy);
      if (speed < INERTIA_STOP_SPEED) {
        stopInertia();
        return;
      }

      viewRef.current.tx += dragRef.current.vx * dt;
      viewRef.current.ty += dragRef.current.vy * dt;

      clampToBounds();
      applyTransform();

      rafRef.current = requestAnimationFrame(tick);
    });
  };

  // Disable page scroll while modal open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // When modal opens, center view after layout is ready
  useEffect(() => {
    if (!open) return;
    stopInertia();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        centerView(1);
      });
    });

    const vp = viewportRef.current;
    if (!vp) return;

    const ro = new ResizeObserver(() => {
      clampToBounds();
      applyTransform();
    });
    ro.observe(vp);

    const wheelHandler = (e: globalThis.WheelEvent) => onWheel(e as any);
    vp.addEventListener("wheel", wheelHandler, { passive: false });

    return () => {
      ro.disconnect();
      vp.removeEventListener("wheel", wheelHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload]);

  useEffect(() => {
    setSelectedLabel(null);
  }, [payload, zoomUI]);

  const onWheel = (e: WheelEvent<HTMLDivElement> | globalThis.WheelEvent) => {
    setSelectedLabel(null);

    e.preventDefault();
    e.stopPropagation();

    const vp = viewportRef.current;
    const sheet = sheetRef.current;
    if (!vp || !sheet) return;

    stopInertia();

    const rect = vp.getBoundingClientRect();
    const mx = (e as any).clientX - rect.left;
    const my = (e as any).clientY - rect.top;

    const { scale, tx, ty } = viewRef.current;

    const factor = Math.exp(-((e as any).deltaY) * 0.0015);
    const nextScale = clamp(scale * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextScale === scale) return;

    const cx = (mx - tx) / scale;
    const cy = (my - ty) / scale;

    viewRef.current.scale = nextScale;
    viewRef.current.tx = mx - cx * nextScale;
    viewRef.current.ty = my - cy * nextScale;

    clampToBounds();
    applyTransform();
    setZoomUI(viewRef.current.scale);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    setSelectedLabel(null);
    if (e.button !== 0) return;

    stopInertia();

    dragRef.current.active = true;
    dragRef.current.pointerId = e.pointerId;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.startTx = viewRef.current.tx;
    dragRef.current.startTy = viewRef.current.ty;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    dragRef.current.lastT = performance.now();
    dragRef.current.vx = 0;
    dragRef.current.vy = 0;

    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    if (dragRef.current.pointerId !== e.pointerId) return;

    setSelectedLabel(null);

    const now = performance.now();
    const dtMs = Math.max(1, now - dragRef.current.lastT);
    const dt = dtMs / 1000;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    viewRef.current.tx = dragRef.current.startTx + dx;
    viewRef.current.ty = dragRef.current.startTy + dy;

    const ddx = e.clientX - dragRef.current.lastX;
    const ddy = e.clientY - dragRef.current.lastY;
    const vx = ddx / dt;
    const vy = ddy / dt;

    dragRef.current.vx = dragRef.current.vx * 0.6 + vx * 0.4;
    dragRef.current.vy = dragRef.current.vy * 0.6 + vy * 0.4;

    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    dragRef.current.lastT = now;

    clampToBounds();
    applyTransform();

    e.preventDefault();
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    if (dragRef.current.pointerId !== e.pointerId) return;

    dragRef.current.active = false;
    dragRef.current.pointerId = -1;

    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {}

    const speed = Math.hypot(dragRef.current.vx, dragRef.current.vy);
    if (speed > INERTIA_STOP_SPEED) startInertia();

    e.preventDefault();
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.pointerId = -1;
    stopInertia();
    e.preventDefault();
  };

  const reset = () => {
    stopInertia();
    centerView(1);
  };

  const reportPattern = async () => {
    const userId = auth.getCurrentUser();
    if (!userId) {
      auth.showAuth();
      return;
    }

    if (reporting) return;

    const ok = window.confirm(`Report this pattern ("${entry.pattern}")?`);
    if (!ok) return;

    const token = auth.getToken();
    if (!token) {
      auth.showAuth();
      return;
    }

    setReporting(true);
    try {
      const res = await fetch("/api/patterns/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          country_id: country.id,
          pattern: entry.pattern,
        }),
      });

      if (!res.ok) {
        let msg = "Report failed";
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {}
        alert(msg);
        return;
      }

      alert("Reported. Thank you!");
    } finally {
      setReporting(false);
    }
  };

  const makeFileSafe = (value: string) => value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

  const onDownloadImage = async () => {
    const svg = miniWrapRef.current?.querySelector("svg");
    if (!svg) return;

    const serializer = new XMLSerializer();
    const cloned = svg.cloneNode(true) as SVGElement;
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const svgString = serializer.serializeToString(cloned);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const width = svg.viewBox.baseVal.width || svg.clientWidth || 520;
      const height = svg.viewBox.baseVal.height || svg.clientHeight || 320;
      const scale = 2;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const pad = 12 * scale;
      ctx.fillStyle = "#e5e7eb";
      ctx.font = `${Math.round(16 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`;
      ctx.textBaseline = "top";
      ctx.fillText(entry.title, pad, pad);

      ctx.fillStyle = "#9ca3af";
      ctx.font = `${Math.round(12 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`;
      ctx.fillText("Toponymy Atlas", pad, pad + Math.round(20 * scale));

      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        const countryName = (country as any)?.properties?.name ?? country.id;
        const filename = `${makeFileSafe(countryName)}_${makeFileSafe(entry.title)}.png`;
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");

      URL.revokeObjectURL(url);
    };

    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const modal =
    open && payload ? (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="w-[96vw] h-[94vh] max-w-none overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col"
            initial={{ scale: 0.98, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, y: 8, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-zinc-800 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col">
                  <div className="text-sm font-semibold text-zinc-100">{entry.title}</div>
                  <div className="text-[11px] text-zinc-400">
                    {entry.places.toLocaleString()} places
                    {"points_sampled" in (payload as any) && (payload as any).points_sampled ? " (sampled)" : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onDownloadImage}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
                    title="Download image"
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={reportPattern}
                    disabled={reporting}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950 disabled:opacity-60"
                    title="Report this pattern"
                  >
                    {reporting ? "Reporting…" : "Report"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 p-3 overflow-hidden flex gap-3">
              <div className="flex-1 h-full">
                <div
                  ref={viewportRef}
                  className="h-full w-full overflow-hidden rounded-xl border border-zinc-800 bg-black/20 cursor-grab active:cursor-grabbing"
                  onWheel={onWheel}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  style={{ touchAction: "none" }}
                  title="Wheel to zoom, drag to pan"
                >
                  <div ref={stageRef} style={{ transformOrigin: "0 0" }}>
                    <div ref={sheetRef} style={{ width: 1100 }} className="select-none">
                      <TileSVG
                        country={country}
                        payload={payload}
                        variant="large"
                        viewScale={zoomUI}
                        renderMode={renderMode}
                        onPointClick={(pt) => {
                          if (!pt) {
                            setSelectedLabel(null);
                            return;
                          }
                          setSelectedLabel({ name: pt.name });
                        }}
                        onPointHover={(pt) => {
                          if (!pt) {
                            setSelectedLabel(null);
                            return;
                          }
                          setSelectedLabel({ name: pt.name });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <aside className="w-80 max-w-[28rem] border-l border-zinc-800 pl-3 overflow-auto">
                {selectedLabel ? (
                  <div className="mb-3">
                    <div className="text-3xl font-extrabold text-zinc-50 leading-tight">{selectedLabel.name}</div>
                    <div className="text-xs text-zinc-400 mb-2">Selected city</div>
                  </div>
                ) : null}

                {decodedNamedPoints.length > 0 ? (
                  <div>
                    <div className="text-sm font-semibold text-zinc-100 mb-2">
                      Cities ({(payload as any).points ?? decodedNamedPoints.length})
                    </div>
                    {(payload as any).points_sampled && (
                      <div className="text-xs text-zinc-400 mb-2">Sampled (not all cities)</div>
                    )}
                    {!("points_named" in (payload as any)) && (
                      <div className="text-xs text-zinc-500 mb-2">
                        Names not exported for this pattern — showing coordinates only.
                      </div>
                    )}
                    <ul className="divide-y divide-zinc-800 text-sm">
                      {decodedNamedPoints.slice(0, 2000).map((p, i) => (
                        <li key={i} className="py-2">
                          <div className="font-medium text-zinc-100">
                            {p.name ?? `(${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})`}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {decodedNamedPoints.length > 2000 && (
                      <div className="text-xs text-zinc-400 mt-2">
                        Showing first 2000 of {decodedNamedPoints.length}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-400">No city list available for this pattern.</div>
                )}
              </aside>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    ) : null;

  const [likeCount, setLikeCount] = useState<number>(0);
  const [liked, setLiked] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<string | null>(() => auth.getCurrentUser());
  const [liking, setLiking] = useState(false);
  const justToggledRef = useRef(false);

  const patternKey = `${country.id}|${entry.file ?? `${entry.pattern}|${entry.mode}|${entry.zoom}`}`;


  // Load initial like count
  useEffect(() => {
    likes.getCount(patternKey).then(setLikeCount);
    const user = auth.getCurrentUser();
    setCurrentUser(user);
    if (user) likes.hasLiked(patternKey, user).then(setLiked);
  }, [patternKey]);

  // Subscribe to auth and likes changes
  useEffect(() => {
    const offAuth = auth.onAuthChange((u) => {
      setCurrentUser(u);
      if (u) likes.hasLiked(patternKey, u).then(setLiked);
    });
    const offLikes = likes.onLikesChange((key) => {
      // Ignore events immediately after our own toggle to prevent race condition
      if (justToggledRef.current) {
        justToggledRef.current = false;
        return;
      }
      if (!key || key === patternKey) {
        likes.getCount(patternKey).then(setLikeCount);
        const u = auth.getCurrentUser();
        if (u) likes.hasLiked(patternKey, u).then(setLiked);
      }
    });
    return () => {
      offAuth();
      offLikes();
    };
  }, [patternKey]);

  const onToggleLike = async () => {
    const user = auth.getCurrentUser();
    if (!user) {
      auth.showAuth();
      return;
    }
    setLiking(true);
    justToggledRef.current = true; // Mark that we're toggling
    const r = await likes.toggleLike(patternKey, user);
    setLiking(false);
    if (r.ok) {
      setLikeCount(r.count ?? 0);
      setLiked(r.liked ?? false);
      // justToggledRef will be cleared by the event listener
    } else {
      justToggledRef.current = false; // Reset if failed
    }
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{entry.title}</div>
          <div className="text-[11px] text-zinc-400">{subtitle}</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleLike}
            disabled={liking}
            className={`flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-2 py-0.5 text-xs disabled:opacity-50 ${liked ? "text-pink-400" : "text-zinc-300"}`}
            title={liked ? "Unlike" : "Like"}
          >
            <span aria-hidden>{liked ? "♥" : "♡"}</span>
            <span className="font-mono text-[11px]">{likeCount}</span>
          </button>
          <button
            onClick={onDownloadImage}
            className="rounded-full border border-zinc-800 bg-zinc-950/40 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-950"
            title="Download image"
            type="button"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3v12" />
              <path d="M7 10l5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </button>
          <div className="relative group">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/60 text-[11px] text-zinc-300 hover:bg-zinc-950"
              aria-label="Pattern info"
              title="Info"
            >
              i
            </button>
            <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 w-max max-w-[220px] rounded-xl border border-zinc-800 bg-zinc-950/95 p-2 text-xs text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              <div className="space-y-1">
                <div>
                  <span className="text-zinc-400">Places:</span>{" "}
                  <span className="font-mono">{entry.places.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Zoom:</span>{" "}
                  <span className="font-mono">z{entry.zoom}</span>
                </div>
                {typeof entry.score === "number" ? (
                  <div>
                    <span className="text-zinc-400">Score:</span>{" "}
                    <span className="font-mono">{entry.score.toFixed(2)}</span>
                  </div>
                ) : null}
                {entry.hotspots?.length ? (
                  <div>
                    <div className="text-zinc-400">Hotspots:</div>
                    <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                      {entry.hotspots.slice(0, 3).map(([x, y, c], i) => {
                        const { lon, lat } = tileCenterLonLat(x, y, entry.zoom);
                        return (
                          <div key={i}>
                            {fmtCoord(lat)},{fmtCoord(lon)} · {c}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div ref={miniWrapRef} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
        {err && <div className="p-3 text-xs text-zinc-400">{err}</div>}
        {!err && !payload && <div className="p-3 text-xs text-zinc-400">Loading map…</div>}
        {payload && (
          <button
            type="button"
            onClick={() => {
              setZoomUI(1);
              setOpen(true);
            }}
            className="block w-full cursor-zoom-in text-left"
            title="Open larger view"
          >
            <TileSVG
              country={country}
              payload={payload}
              variant="mini"
              viewScale={1}
              renderMode={renderMode}
            />
          </button>
        )}
      </div>

      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </div>
  );
}
