import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compareSync } from "bcrypt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-in-production";

const dataDir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "../../server/data");
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

  const users = readUsers();
  let foundUser = null;
  let foundUsername = null;

  for (const [uid, userData] of Object.entries(users)) {
    const match = compareSync(password, userData.hash);
    if (match) {
      foundUser = uid;
      foundUsername = userData.username;
      break;
    }
  }

  if (!foundUser) {
    return res.status(401).json({ error: "Password not found" });
  }

  const token = sign(foundUser);
  return res.json({ success: true, userId: foundUser, username: foundUsername, token });
}
