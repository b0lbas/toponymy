import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hashSync, compareSync } from "bcrypt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";

// Use /tmp for Vercel serverless (or current dir for local)
const dataDir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "../server/data");
const usersFile = path.join(dataDir, "users.json");

function ensureDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readUsers() {
  try {
    ensureDir();
    if (!fs.existsSync(usersFile)) return {};
    return JSON.parse(fs.readFileSync(usersFile, "utf-8"));
  } catch {
    return {};
  }
}

function writeUsers(users) {
  ensureDir();
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function sign(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
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

  const users = readUsers();
  
  // Check if username already exists
  for (const userData of Object.values(users)) {
    if (userData.username === username) {
      return res.status(409).json({ error: "Username already taken" });
    }
  }

  const hashed = hashSync(password, 10);
  const userId = `user_${Date.now()}`;

  users[userId] = { username, hash: hashed, createdAt: Date.now() };
  writeUsers(users);

  const token = sign(userId);
  return res.json({ success: true, userId, username, token });
}
