import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";

const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_KEY || "");

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
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

  // Get token from header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { country_id, pattern, reason, comment } = req.body;

  if (!country_id || !pattern) {
    return res.status(400).json({ error: "country_id and pattern required" });
  }

  try {
    const { error } = await supabase
      .from("pattern_reports")
      .insert([{
        country_id,
        pattern,
        user_id: decoded.userId,
        reason: reason || null,
        comment: comment || null,
        status: "pending"
      }]);

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Уже репортили этот паттерн" });
      }
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
