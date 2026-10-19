// src/routes/nexo.js
// Nexo launcher login. First login with a new username creates the account, after that the password must match.
// fltoken + caldera + accountId are generated ONCE per account and saved in data/nexo_users.json forever.
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { accountFromName } from "../lib/accounts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "nexo_users.json");

const users = {}; // lowercase username -> { username, accountId, salt, hash, flToken, caldera, createdAt }
try {
  if (fs.existsSync(FILE)) Object.assign(users, JSON.parse(fs.readFileSync(FILE, "utf8")));
} catch (e) {
  console.warn("[nexo] could not read data/nexo_users.json, starting fresh:", e.message);
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(users, null, 2));
  } catch (e) { console.warn("[nexo] save failed:", e.message); }
}

const b64url = b => Buffer.from(b).toString("base64url");

function makeCaldera(accountId) {
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    account_id: accountId,
    generated: Math.floor(Date.now() / 1000),
    calderaGuid: crypto.randomUUID(),
    acProvider: "EasyAntiCheat",
    notes: "",
    fallback: false
  }));
  return `${header}.${payload}.${b64url(crypto.randomBytes(64))}`;
}

const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 64).toString("hex");

const router = express.Router();

router.post("/nexo/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!/^[A-Za-z0-9_-]{3,16}$/.test(username))
    return res.status(400).json({ errorMessage: "Username must be 3-16 characters (letters, numbers, _ or -)." });
  if (password.length < 4 || /\s/.test(password))
    return res.status(400).json({ errorMessage: "Password must be at least 4 characters with no spaces." });

  const key = username.toLowerCase();
  let u = users[key];

  if (!u) {
    const acc = accountFromName(username); // same id the game's oauth login resolves to
    const salt = crypto.randomBytes(16).toString("hex");
    u = {
      username: acc.username,
      accountId: acc.accountId,
      salt,
      hash: hashPass(password, salt),
      flToken: crypto.randomBytes(12).toString("hex"),
      caldera: makeCaldera(acc.accountId),
      createdAt: new Date().toISOString()
    };
    users[key] = u;
    persist();
    console.log(`[nexo] new account: ${u.username}`);
  } else {
    const given = Buffer.from(hashPass(password, u.salt), "hex");
    const real = Buffer.from(u.hash, "hex");
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real))
      return res.status(401).json({ errorMessage: "Wrong password." });
  }

  res.json({ username: u.username, accountId: u.accountId, flToken: u.flToken, caldera: u.caldera });
});

export default router;
