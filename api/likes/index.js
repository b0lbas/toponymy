import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SECRET_KEY || ""
);

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
    const { data } = await supabase
      .from("likes")
      .select("pattern_key, user_id");

    const likes = {};
    if (data) {
      data.forEach(({ pattern_key, user_id }) => {
        if (!likes[pattern_key]) likes[pattern_key] = [];
        likes[pattern_key].push(user_id);
      });
    }

    return res.json(likes);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
