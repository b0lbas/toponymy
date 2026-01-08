import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";

const dataDir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "../../server/data");
const likesFile = path.join(dataDir, "likes.json");

function ensureDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readLikes() {
  try {
    ensureDir();
    if (!fs.existsSync(likesFile)) return {};
    return JSON.parse(fs.readFileSync(likesFile, "utf-8"));
  } catch {
    return {};
  }
}

function writeLikes(likes) {
  ensureDir();
  fs.writeFileSync(likesFile, JSON.stringify(likes, null, 2));
}

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

export default function handler(req, res) {
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

  const likes = readLikes();
  const arr = new Set(likes[patternKey] ?? []);
  const userId = payload.userId;

  const isLiked = arr.has(userId);
  if (isLiked) arr.delete(userId);
  else arr.add(userId);

  likes[patternKey] = Array.from(arr);
  writeLikes(likes);

  return res.json({ success: true, liked: !isLiked, count: arr.size });
}
