import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MapView, { CountryFeature } from "./components/MapView";
import CountryPanel from "./components/CountryPanel";
import { loadEuropeCountries } from "./lib/world";

export default function App() {
  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [selected, setSelected] = useState<CountryFeature | null>(null);

  useEffect(() => {
    loadEuropeCountries().then(setCountries).catch((e) => {
      console.error(e);
      setCountries([]);
    });
  }, []);

  const subtitle = useMemo(() => {
    if (!countries) return "Loading…";
    if (countries.length === 0) return "Failed to load country shapes.";
    return "";
  }, [countries]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950">
      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-5 py-4">
        <div className="flex flex-col gap-1">
          <div className="text-xs text-zinc-400">{subtitle}</div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400">
        </div>
      </header>

      <div className="h-full w-full">
        <MapView
          countries={countries ?? []}
          selectedId={selected?.id ?? null}
          onSelect={(c) => setSelected(c)}
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
