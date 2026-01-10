import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function uniqueStrings(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

export default async function handler(req, res) {
  const corsOrigin = process.env.CORS_ORIGIN || "*";
  Object.entries(corsHeaders(corsOrigin)).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const countryId = (req.query?.country_id || req.query?.countryId || "").toString();
  if (!countryId) return res.status(400).json({ error: "country_id required" });

  try {
    const { data, error } = await supabase
      .from("hidden_patterns")
      .select("*")
      .eq("country_id", countryId);

    if (error) {
      console.error("Query error:", error);
      return res.status(500).json({ error: `Database error: ${error.message}` });
    }

    const hidden = uniqueStrings(
      (data || []).map((row) => row.pattern || row.pattern_key || row.patternKey || row.suffix)
    );

    return res.json({ hidden });
  } catch (e) {
    console.error("Exception:", e);
    return res.status(500).json({ error: `Exception: ${e.message}` });
  }
}
