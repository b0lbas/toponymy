import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MapView, { CountryFeature } from "./components/MapView";
import CountryPanel from "./components/CountryPanel";
import AuthControl from "./components/AuthControl";
import AdminPanel from "./components/AdminPanel";
import { loadEuropeCountries } from "./lib/world";

export default function App() {
  const isAdminRoute = typeof window !== "undefined" && window.location.pathname === "/admin";

  if (isAdminRoute) {
    return <AdminPanel />;
  }

  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [selected, setSelected] = useState<CountryFeature | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (window.localStorage.getItem("toponymy_theme") as "light" | "dark") ?? "light";
  });
  const changelogRef = useRef<HTMLDivElement | null>(null);
  const changelogButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    loadEuropeCountries().then(setCountries).catch((e) => {
      console.error(e);
      setCountries([]);
    });
  }, []);

  useEffect(() => {
    if (!showChangelog) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (changelogRef.current?.contains(target)) return;
      if (changelogButtonRef.current?.contains(target)) return;
      setShowChangelog(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showChangelog]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("toponymy_theme", theme);
  }, [theme]);

  const subtitle = useMemo(() => {
    if (!countries) return "Loading…";
    if (countries.length === 0) return "Failed to load country shapes.";
    return "";
  }, [countries]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950">
      <header className="absolute right-5 top-4 z-10 inline-flex pointer-events-none">
        <div className="flex flex-col items-end gap-2 text-xs text-zinc-400 relative pointer-events-auto">
          <AuthControl />
          <button
            type="button"
            onClick={() => setShowChangelog(true)}
            ref={changelogButtonRef}
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
          >
            Changelog
          </button>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
            title="Toggle theme"
          >
            Theme: {theme === "light" ? "Light" : "Dark"}
          </button>
          <AnimatePresence>
            {showChangelog && (
              <motion.div
                ref={changelogRef}
                className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 text-xs text-zinc-200 shadow-2xl"
                initial={{ y: -6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -6, opacity: 0 }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-400">Changelog</div>
                  <button
                    type="button"
                    onClick={() => setShowChangelog(false)}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
                    aria-label="Close"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-100">04.02.2026</div>
                <div className="mt-1 text-xs text-zinc-400">
                  Added updated patterns in original scripts and non-Latin labels; refreshed site data.
                </div>
                <div className="mt-1 text-xs text-zinc-400">Added heatmap rendering mode.</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div className="h-full w-full">
        <MapView
          countries={countries ?? []}
          selectedId={selected?.id ?? null}
          onSelect={(c) => setSelected(c)}
          theme={theme}
        />
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="absolute right-0 top-0 z-20 h-full w-full md:w-[520px] bg-zinc-950/90 backdrop-blur border-l border-zinc-800"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <CountryPanel country={selected} onClose={() => setSelected(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="absolute bottom-0 left-0 z-10 px-5 py-4 text-[11px] text-zinc-500">
        
      </footer>
    </div>
  );
}
