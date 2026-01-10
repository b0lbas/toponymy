import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

function looksLikeUuid(v) {
  if (!v || typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

export default async function handler(req, res) {
  const corsOrigin = process.env.CORS_ORIGIN || "*";
  Object.entries(corsHeaders(corsOrigin)).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const countryId = (req.body?.country_id || req.body?.countryId || "").toString();
  const pattern = (req.body?.pattern || "").toString();
  const note = (req.body?.note || req.body?.reason || "").toString();

  if (!countryId) return res.status(400).json({ error: "country_id required" });
  if (!pattern) return res.status(400).json({ error: "pattern required" });

  try {
    const userId = payload.userId;
    const userIdUuid = looksLikeUuid(userId) ? userId : undefined;

    const buildCandidate = () => ({
      country_id: countryId,
      pattern,
      user_id: userIdUuid,
      // optional fields (may not exist in schema)
      note: note || undefined,
      reason: note || undefined,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    let candidate = buildCandidate();
    // Retry by dropping unknown columns (Supabase schema cache mismatch / older schema)
    for (let i = 0; i < 6; i++) {
      const { error: insertError } = await supabase.from("pattern_reports").insert(candidate);
      if (!insertError) {
        return res.json({ success: true });
      }

      const msg = insertError.message || "";
      const m = msg.match(/Could not find the '([^']+)' column/i);
      if (m && m[1] && Object.prototype.hasOwnProperty.call(candidate, m[1])) {
        const col = m[1];
        delete candidate[col];
        continue;
      }

      console.error("Insert error:", insertError);
      return res.status(500).json({ error: `Failed to create report: ${insertError.message}` });
    }

    return res.status(500).json({ error: "Failed to create report: schema mismatch" });
  } catch (e) {
    console.error("Exception:", e);
    return res.status(500).json({ error: `Exception: ${e.message}` });
  }
}
