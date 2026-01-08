import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usersFile = path.join(__dirname, "../data/users.json");
const likesFile = path.join(__dirname, "../data/likes.json");

// Ensure data directory exists
const dataDir = path.dirname(usersFile);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function readUsers() {
  try {
    if (!fs.existsSync(usersFile)) return {};
    const content = fs.readFileSync(usersFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function writeUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

export function readLikes() {
  try {
    if (!fs.existsSync(likesFile)) return {};
    const content = fs.readFileSync(likesFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function writeLikes(likes) {
  fs.writeFileSync(likesFile, JSON.stringify(likes, null, 2));
}
