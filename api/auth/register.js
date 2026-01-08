import jwt from "jsonwebtoken";
import { hashSync } from "bcrypt";
import { createClient } from "@supabase/supabase-js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SECRET_KEY || ""
);

function sign(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
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

  const { username, password } = req.body;

  if (!username || typeof username !== "string") {
    return res.status(400).json({ error: "Username required" });
  }

  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  try {
    // Check if username exists
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .single();

    if (existing) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const hashed = hashSync(password, 10);
    const userId = `user_${Date.now()}`;
    const createdAt = Date.now();

    // Insert user
    const { error } = await supabase.from("users").insert({
      id: userId,
      username,
      hash: hashed,
      created_at: createdAt,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const token = sign(userId);
    return res.json({ success: true, userId, username, token });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
