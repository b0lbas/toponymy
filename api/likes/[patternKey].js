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

  const { patternKey } = req.query;
  if (!patternKey || typeof patternKey !== "string") {
    return res.status(400).json({ error: "Invalid patternKey" });
  }

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  try {
    const userId = payload.userId;

    const { data, error } = await supabase
      .from("likes")
      .select("id")
      .eq("pattern_key", patternKey)
      .eq("user_id", userId);

    if (error) {
      console.error("Query error:", error);
      return res.status(500).json({ error: `Database error: ${error.message}` });
    }

    const liked = data && data.length > 0;
    return res.json({ liked });
  } catch (e) {
    console.error("Exception:", e);
    return res.status(500).json({ error: `Exception: ${e.message}` });
  }
}

  return res.json({ count, users });
}
