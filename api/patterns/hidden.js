import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "");

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
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

  const { country_id } = req.query;

  if (!country_id) {
    return res.status(400).json({ error: "country_id required" });
  }

  try {
    // Get hidden patterns for this country
    const { data: hidden, error: hiddenError } = await supabase
      .from("hidden_patterns")
      .select("pattern")
      .eq("country_id", country_id);

    if (hiddenError) {
      return res.status(500).json({ error: hiddenError.message });
    }

    const hiddenPatterns = new Set((hidden || []).map(h => h.pattern));

    res.status(200).json({ hidden: Array.from(hiddenPatterns) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
