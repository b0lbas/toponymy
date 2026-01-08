import express from "express";
import cors from "cors";
import { hashSync, compareSync } from "bcrypt";
import { readUsers, writeUsers, readLikes, writeLikes } from "./db.js";
import { sign, authMiddleware } from "./jwt.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
app.use(express.json());

// ===== AUTH ROUTES =====

app.post("/api/auth/register", async (req, res) => {
  const { password } = req.body;
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  const users = readUsers();
  const hashed = hashSync(password, 10);
  const userId = `user_${Date.now()}`;

  // Check if this password hash already exists (to prevent duplicate registrations)
  for (const u of Object.values(users)) {
    if (u.hash === hashed) {
      return res.status(409).json({ error: "Password already registered" });
    }
  }

  users[userId] = { hash: hashed, createdAt: Date.now() };
  writeUsers(users);

  const token = sign(userId);
  return res.json({ success: true, userId, token });
});

app.post("/api/auth/login", async (req, res) => {
  const { password } = req.body;
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  const users = readUsers();
  let foundUser = null;

  for (const [uid, userData] of Object.entries(users)) {
    const match = compareSync(password, userData.hash);
    if (match) {
      foundUser = uid;
      break;
    }
  }

  if (!foundUser) {
    return res.status(401).json({ error: "Password not found" });
  }

  const token = sign(foundUser);
  return res.json({ success: true, userId: foundUser, token });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  return res.json({ userId: req.userId });
});

app.post("/api/auth/logout", (req, res) => {
  // Just return success; client deletes token
  return res.json({ success: true });
});

// ===== LIKES ROUTES =====

app.post("/api/likes/toggle", authMiddleware, (req, res) => {
  const { patternKey } = req.body;
  if (!patternKey || typeof patternKey !== "string") {
    return res.status(400).json({ error: "patternKey required" });
  }

  const likes = readLikes();
  const arr = new Set(likes[patternKey] ?? []);
  const userId = req.userId;

  const isLiked = arr.has(userId);
  if (isLiked) arr.delete(userId);
  else arr.add(userId);

  likes[patternKey] = Array.from(arr);
  writeLikes(likes);

  return res.json({ success: true, liked: !isLiked, count: arr.size });
});

app.get("/api/likes/:patternKey", (req, res) => {
  const { patternKey } = req.params;
  const likes = readLikes();
  const count = (likes[patternKey] ?? []).length;
  return res.json({ count, users: likes[patternKey] ?? [] });
});

app.get("/api/likes", (req, res) => {
  const likes = readLikes();
  return res.json(likes);
});

app.listen(PORT, () => {
  console.log(`Toponymy server listening on port ${PORT}`);
  console.log(`CORS origin: ${process.env.CORS_ORIGIN || "* (any origin)"}`);
  console.log(`API ready at http://localhost:${PORT}/api`);
});
