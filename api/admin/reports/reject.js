import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "user_1767857068696";

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

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

  if (payload.userId !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const reportId = req.body?.report_id || req.body?.reportId || null;
  const countryId = (req.body?.country_id || req.body?.countryId || "").toString();
  const pattern = (req.body?.pattern || "").toString();

  if (!reportId && (!countryId || !pattern)) {
    return res.status(400).json({ error: "report_id or (country_id + pattern) required" });
  }

  try {
    let upd;
    if (reportId) {
      upd = supabase
        .from("pattern_reports")
        .update({ status: "rejected", decided_at: Date.now(), decided_by: payload.userId })
        .eq("id", reportId);
    } else {
      upd = supabase
        .from("pattern_reports")
        .update({ status: "rejected", decided_at: Date.now(), decided_by: payload.userId })
        .eq("country_id", countryId)
        .eq("pattern", pattern)
        .eq("status", "pending");
    }

    const { error } = await upd;
    if (error) {
      console.error("Update error:", error);
      return res.status(500).json({ error: `Failed to reject report: ${error.message}` });
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("Exception:", e);
    return res.status(500).json({ error: `Exception: ${e.message}` });
  }
}
