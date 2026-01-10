import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

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
  if (!decoded || decoded.userId !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { id } = req.query;
  const { decision } = req.body; // 'accept' or 'reject'

  if (!["accept", "reject"].includes(decision)) {
    return res.status(400).json({ error: "Invalid decision" });
  }

  try {
    if (decision === "accept") {
      // Get the report
      const { data: report, error: getError } = await supabase
        .from("pattern_reports")
        .select("country_id, pattern")
        .eq("id", id)
        .single();

      if (getError || !report) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Add to hidden_patterns
      await supabase
        .from("hidden_patterns")
        .insert([{
          country_id: report.country_id,
          pattern: report.pattern
        }]);
    }

    // Update report status
    const { error: updateError } = await supabase
      .from("pattern_reports")
      .update({ status: decision === "accept" ? "accepted" : "rejected" })
      .eq("id", id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
