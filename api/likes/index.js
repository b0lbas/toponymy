import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

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

  try {
    const { data, error } = await supabase
      .from("likes")
      .select("pattern_key, user_id");

    if (error) {
      console.error("Query error:", error);
      return res.status(500).json({ error: `Database error: ${error.message}` });
    }

    // Group by pattern_key
    const likes = {};
    if (data && Array.isArray(data)) {
      data.forEach(({ pattern_key, user_id }) => {
        if (!likes[pattern_key]) {
          likes[pattern_key] = [];
        }
        likes[pattern_key].push(user_id);
      });
    }

    return res.json(likes);
  } catch (e) {
    console.error("Exception:", e);
    return res.status(500).json({ error: `Exception: ${e.message}` });
  }
}
