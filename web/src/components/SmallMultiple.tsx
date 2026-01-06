import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { CountryFeature } from "./MapView";
import type { PatternPayload, PatternIndexEntry } from "../lib/data";
import { fetchJsonGz } from "../lib/data";
import TileSVG from "./TileSVG";
import { AnimatePresence, motion } from "framer-motion";

type Props = {
  country: CountryFeature;
  entry: PatternIndexEntry;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 16.0;

// how much “empty space” beyond edges we allow while panning (px)
const PAN_PAD = 80;

// inertia tuning
const INERTIA_FRICTION = 0.92; // per frame-ish (dt adjusted)
const INERTIA_STOP_SPEED = 10; // px/sec

export default function SmallMultiple({ country, entry }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<PatternPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // For displaying zoom in header (UI state).
  const [zoomUI, setZoomUI] = useState(1);
  const [selectedLabel, setSelectedLabel] = useState<{ name: string } | null>(null);

  // Modal refs
  const viewportRef = useRef<HTMLDivElement | null>(null); // visible viewport
  const stageRef = useRef<HTMLDivElement | null>(null); // transformed wrapper
  const sheetRef = useRef<HTMLDivElement | null>(null); // untransformed content (fixed size)

  // Transform state kept in refs for smooth updates without rerender spam
  const viewRef = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
  });

  // Drag state
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
    vx: 0, // px/sec
    vy: 0,
  });

  // Inertia RAF
  const rafRef = useRef<number | null>(null);
  const rafLastTRef = useRef<number>(0);

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

  useEffect(() => {
    if (!visible) return;
    setPayload(null);
    setErr(null);

    fetchJsonGz<PatternPayload>(`/data/${country.id}/${entry.file}`)
      .then(setPayload)
      .catch((e) => {
        console.error(e);
        setErr("Failed to load pattern data.");
      });
  }, [visible, country.id, entry.file]);

  const subtitle = useMemo(() => {
    const places = entry.places.toLocaleString();
    return `${places} places • z${entry.zoom}`;
  }, [entry.places, entry.zoom]);

  const decodedNamedPoints = useMemo(() => {
    if (!payload) return [];
    const scale = (payload as any).points_scale ?? 10000;

    if ("points_named" in (payload as any) && Array.isArray((payload as any).points_named)) {
      const pts = (payload as any).points_named as [number, number, string][];
      return pts.map(([lonq, latq, name]) => ({ lon: lonq / scale, lat: latq / scale, name }));
    }

    // Fallback: if only quantized coords are available, show them (names unavailable)
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
    // ✅ 2D transform only (no translate3d) to reduce GPU bitmap caching
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const clampToBounds = () => {
    const vp = viewportRef.current;
    const sheet = sheetRef.current;
    if (!vp || !sheet) return;

    const { scale } = viewRef.current;

    const vw = vp.clientWidth;
    const vh = vp.clientHeight;

    // untransformed layout size of the content
    const sw = sheet.offsetWidth;
    const sh = sheet.offsetHeight;

    const W = sw * scale;
    const H = sh * scale;

    // When content smaller than viewport: center it.
    if (W <= vw) {
      viewRef.current.tx = (vw - W) / 2;
    } else {
      const minTx = vw - W - PAN_PAD;
      const maxTx = PAN_PAD;
      viewRef.current.tx = clamp(viewRef.current.tx, minTx, maxTx);
    }

    if (H <= vh) {
      viewRef.current.ty = (vh - H) / 2;
    } else {
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

      // dt-adjusted friction (stable across refresh rates)
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

    // Add native wheel listener with passive:false to avoid "Unable to preventDefault" warnings
    const wheelHandler = (e: WheelEvent) => {
      // call our existing handler which expects an event-like object
      onWheel(e as any);
    };
    vp.addEventListener("wheel", wheelHandler, { passive: false });

    return () => {
      ro.disconnect();
      vp.removeEventListener("wheel", wheelHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload]);

  // Clear selection when payload or zoom changes
  useEffect(() => {
    setSelectedLabel(null);
  }, [payload, zoomUI]);

  const onWheel = (e: WheelEvent<HTMLDivElement> | WheelEvent) => {
    // clear any selected label when zooming
    setSelectedLabel(null);

    e.preventDefault();
    e.stopPropagation();

    const vp = viewportRef.current;
    const sheet = sheetRef.current;
    if (!vp || !sheet) return;

    stopInertia();

    const rect = vp.getBoundingClientRect();
    const mx = (e as WheelEvent).clientX - rect.left;
    const my = (e as WheelEvent).clientY - rect.top;

    const { scale, tx, ty } = viewRef.current;

    // Smooth exponential zoom (trackpad friendly)
    const factor = Math.exp(-((e as WheelEvent).deltaY) * 0.0015);
    const nextScale = clamp(scale * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextScale === scale) return;

    // Keep the point under mouse fixed:
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
    // clear any selected label when starting a drag/interaction
    setSelectedLabel(null);

    if (e.button !== 0) return;
    const vp = viewportRef.current;
    if (!vp) return;

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
    // Only clear selected label when actively dragging (so hover can work)
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

    // Velocity for inertia (px/sec)
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
    } catch {
      // ignore
    }

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
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="flex flex-col">
                <div className="text-sm font-semibold text-zinc-100">{entry.title}</div>
                <div className="text-[11px] text-zinc-400">
                  {entry.places.toLocaleString()} matches
                  {"points_sampled" in (payload as any) && (payload as any).points_sampled ? " (sampled)" : ""}
                  {" · "}
                  <span className="font-mono">{Math.round(zoomUI * 100)}%</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
                  title="Reset zoom & center"
                >
                  Reset
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
                  {/* NOTE: no will-change here => less chance of bitmap caching */}
                  <div
                    ref={stageRef}
                  style={{
                    transformOrigin: "0 0",
                  }}
                >
                  <div ref={sheetRef} style={{ width: 1100 }} className="select-none">
                    <TileSVG country={country} payload={payload} variant="large" viewScale={zoomUI}
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
                    <div className="text-sm font-semibold text-zinc-100 mb-2">Cities ({(payload as any).points ?? decodedNamedPoints.length})</div>
                    {(payload as any).points_sampled && <div className="text-xs text-zinc-400 mb-2">Sampled (not all cities)</div>}
                    {!("points_named" in (payload as any)) && (
                      <div className="text-xs text-zinc-500 mb-2">Names not exported for this pattern — showing coordinates only.</div>
                    )}
                    <ul className="divide-y divide-zinc-800 text-sm">
                      {decodedNamedPoints.slice(0, 2000).map((p, i) => (
                        <li key={i} className="py-2">
                          <div className="font-medium text-zinc-100">{p.name ?? `(${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})`}</div>
                          <div className="text-[11px] text-zinc-400">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</div>
                        </li>
                      ))}
                    </ul>
                    {decodedNamedPoints.length > 2000 && <div className="text-xs text-zinc-400 mt-2">Showing first 2000 of {decodedNamedPoints.length}</div>}
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

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">{entry.title}</div>
        <div className="text-[11px] text-zinc-400">{subtitle}</div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
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
            <TileSVG country={country} payload={payload} variant="mini" viewScale={1} />
          </button>
        )}
      </div>

      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </div>
  );
}
