import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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

    // Check if already liked - use .not.is(null) to avoid single() errors
    const { data: existing, error: selectError } = await supabase
      .from("likes")
      .select("id")
      .eq("pattern_key", patternKey)
      .eq("user_id", userId);

    let liked = false;
    
    if (selectError) {
      console.error("Select error:", selectError);
      return res.status(500).json({ error: `Database error: ${selectError.message}` });
    }

    if (existing && existing.length > 0) {
      // Delete like - remove all duplicates if somehow they exist
      const { error: deleteError } = await supabase
        .from("likes")
        .delete()
        .eq("pattern_key", patternKey)
        .eq("user_id", userId);
      
      if (deleteError) {
        console.error("Delete error:", deleteError);
        return res.status(500).json({ error: `Failed to delete like: ${deleteError.message}` });
      }
      liked = false;
    } else {
      // Add like
      const { error: insertError } = await supabase.from("likes").insert({
        pattern_key: patternKey,
        user_id: userId,
        created_at: Date.now(),
      });
      
      if (insertError) {
        console.error("Insert error:", insertError);
        return res.status(500).json({ error: `Failed to add like: ${insertError.message}` });
      }
      liked = true;
    }

    // Get updated count
    const { count, error: countError } = await supabase
      .from("likes")
      .select("id", { count: "exact", head: true })
      .eq("pattern_key", patternKey);

    if (countError) {
      console.error("Count error:", countError);
      return res.status(500).json({ error: `Failed to count likes: ${countError.message}` });
    }

    return res.json({ success: true, liked, count: count || 0 });
  } catch (e) {
    console.error("Exception:", e);
    return res.status(500).json({ error: `Exception: ${e.message}` });
  }
}
