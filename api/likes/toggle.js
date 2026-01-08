import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SECRET_KEY || ""
);

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

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const { patternKey } = req.body;
  if (!patternKey || typeof patternKey !== "string") {
    return res.status(400).json({ error: "patternKey required" });
  }

  try {
    const userId = payload.userId;

    // Check if already liked
    const { data: existing } = await supabase
      .from("likes")
      .select("id")
      .eq("pattern_key", patternKey)
      .eq("user_id", userId)
      .single();

    let liked = false;
    if (existing) {
      // Delete like
      await supabase
        .from("likes")
        .delete()
        .eq("pattern_key", patternKey)
        .eq("user_id", userId);
      liked = false;
    } else {
      // Add like
      await supabase.from("likes").insert({
        pattern_key: patternKey,
        user_id: userId,
        created_at: Date.now(),
      });
      liked = true;
    }

    // Get updated count
    const { count } = await supabase
      .from("likes")
      .select("id", { count: "exact" })
      .eq("pattern_key", patternKey);

    return res.json({ success: true, liked, count: count || 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
