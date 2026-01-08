import jwt from "jsonwebtoken";
import { compareSync } from "bcrypt";
import { createClient } from "@supabase/supabase-js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

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

  const { password } = req.body;

  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  try {
    // Get all users (inefficient but works for MVP)
    const { data: users, error } = await supabase
      .from("users")
      .select("id, username, hash");

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    let foundUser = null;
    let foundUsername = null;

    for (const userData of users || []) {
      const match = compareSync(password, userData.hash);
      if (match) {
        foundUser = userData.id;
        foundUsername = userData.username;
        break;
      }
    }

    if (!foundUser) {
      return res.status(401).json({ error: "Password not found" });
    }

    const token = sign(foundUser);
    return res.json({ success: true, userId: foundUser, username: foundUsername, token });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
