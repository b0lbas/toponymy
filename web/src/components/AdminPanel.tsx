import { useEffect, useMemo, useState } from "react";
import auth from "../lib/auth";
import { API_BASE } from "../lib/likes";
import type { CountryPatternsIndex, PatternIndexEntry } from "../lib/data";
import { fetchJson } from "../lib/data";
import SmallMultiple from "./SmallMultiple";

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
            const url = `/data/${encodeURIComponent(countryId)}/patterns.json`;
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

  const getEntryForReport = (countryId: string, pattern: string): PatternIndexEntry | null => {
    const idx = indexByCountry[countryId];
    if (!idx?.patterns?.length) return null;
    return idx.patterns.find((p) => p.pattern === pattern) ?? null;
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
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
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

      <div className="p-5">
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
              // SmallMultiple only needs id + some properties; no geometry required for rendering.
              const countryForPreview = { id: country_id, properties: { name: country_id, id: country_id, ISO_N3: country_id } } as any;

              return (
                <div key={keyBase} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      <span className="rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5 text-xs font-mono">
                        {country_id}
                      </span>
                      <span className="ml-2 rounded-full border border-zinc-800 bg-zinc-950/50 px-2 py-0.5 text-xs">
                        {pattern}
                      </span>
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
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3">
                        <SmallMultiple country={countryForPreview} entry={entry} />
                      </div>
                    ) : indexByCountry[country_id] === undefined ? (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                        Loading preview…
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                        Preview not found in /data/{country_id}/patterns.json
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
