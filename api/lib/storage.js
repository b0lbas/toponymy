const fs = require('fs');
const path = require('path');

// Use /tmp on Vercel, ./data locally
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../../server/data');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getUsersPath() {
  return path.join(DATA_DIR, 'users.json');
}

function getLikesPath() {
  return path.join(DATA_DIR, 'likes.json');
}

// Users: { [userId]: { password: hashedPassword, createdAt } }
function getUsers() {
  ensureDataDir();
  const usersPath = getUsersPath();
  if (!fs.existsSync(usersPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(getUsersPath(), JSON.stringify(users, null, 2));
}

// Likes: { [patternKey]: [userId, userId, ...] }
function getLikes() {
  ensureDataDir();
  const likesPath = getLikesPath();
  if (!fs.existsSync(likesPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(likesPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveLikes(likes) {
  ensureDataDir();
  fs.writeFileSync(getLikesPath(), JSON.stringify(likes, null, 2));
}

module.exports = {
  getUsers,
  saveUsers,
  getLikes,
  saveLikes,
};
