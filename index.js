import { createServer } from "http";
import { WebSocketServer } from "ws";
import { accountFromName, accountFromToken, issueTokens, registerAccount } from "./src/lib/accounts.js";
import matchmakerHandler from "./src/routes/matchmaking/matchmakingv2/api/v2/new/Matchmaker.js";
import matchmakeRoutes from "./src/routes/matchmaking/matchmakingv2/api/v2/new/Matchmake.js";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import mainRoutes from "./src/routes/main.js";
import express from "express";
const router = express.Router();
import dotenv from "dotenv";
import readline from "readline";
import crypto from "crypto";
import fs from "fs";
import profileRoutes from "./src/routes/profile.js";
import shopRoutes from "./src/routes/shop.js";
import regionRoutes from "./src/routes/regions.js";
import nexoRoutes from "./src/routes/nexo.js";

// ------------------------
// __dirname for ESM (must be first)
// ------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------
// Global in‑memory store for all accounts
// ------------------------
const profiles = {};
function initProfile(accountId) {
  if (!profiles[accountId]) {
    profiles[accountId] = {
      athena: {
        revision: 0,
        created: new Date().toISOString(),
        wipeNumber: 1,
        items: {},
        stats: { attributes: {} }
      }
    };
  }
  return profiles[accountId];
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3551;

// ✅ Serve your videos folder
app.use('/videos', express.static(path.join(__dirname, 'cloudstorage/videos')));

// ------------------------
// Config loader (fixed to always resolve relative to index.js)
// ------------------------
let config = {};
const configPath = path.join(__dirname, "config.json");

try {
  console.log("Looking for config.json at:", configPath);
  const raw = fs.readFileSync(configPath, "utf-8");
  config = JSON.parse(raw);
  console.log("Loaded config:", config);
} catch (e) {
  console.log("No config.json found or invalid JSON, using defaults.");
  console.error("Config load error:", e.message);
}

app.locals.config = config;

// ------------------------
// Load Athena profile JSON from /profiles folder
// ------------------------
let athenaProfile = {};
const athenaProfilePath = path.join(__dirname, "profiles", "athena.json");

try {
  if (fs.existsSync(athenaProfilePath)) {
    const rawAthenaProfile = fs.readFileSync(athenaProfilePath, "utf-8");
    athenaProfile = JSON.parse(rawAthenaProfile);
    console.log("✅ Loaded profiles/athena.json successfully");
  } else {
    console.warn("⚠️ profiles/athena.json not found at:", athenaProfilePath);
  }
} catch (err) {
  console.error("❌ Failed to load profiles/athena.json:", err.message);
}

// ------------------------
// Battle Royale News Endpoint (MOTD)
// ------------------------
app.get('/fortnite/api/game/v2/world/info', (req, res) => {
  const newsPayload = {
    battleroyalenews: {
      news: {
        _type: "Battle Royale News",
        motds: [
          {
            entryType: "Website",
            image: "https://i.imgur.com/A5Ui8ij.png",
            tileImage: "https://i.imgur.com/A5Ui8ij.png",
            videoURL: "http://localhost:3551/videos/motd.mp4",
            videoMute: false,
            videoLoop: false,
            videoAutoplay: true,
            videoFullscreen: true,
            videoStreamingEnabled: true,
            hidden: false,
            tabTitleOverride: "Thanks for using Comoxy OG",
            _type: "CommonUI Simple Message MOTD",
            title: "Welcome to Reload!",
            body: "This backend was made by Comoxy OG.",
            offerAction: "ShowOfferDetails",
            sortingPriority: 1,
            websiteButtonText: "Comoxy Backend v1.0.0 - Github",
            websiteURL: "https://github.com/comoxyOG/comoxyog/releases",
            id: "61fb3dd8-f23d-45cc-9058-058ab223ba5c",
            spotlight: false
          }
        ]
      }
    }
  };

  res.json(newsPayload);
});

// ------------------------
// Profile Routes
// ------------------------

// ✅ Mount matchmaking REST endpoints

// Mount them on the app
app.use("/", mainRoutes);

// ------------------------
// Content Pages News Endpoint (MOTD + skeleton)
// ------------------------
app.get('/content/api/pages/fortnite-game', (req, res) => {
  const payload = {
    "battleroyalenews": {
      "news": {
        "_type": "Battle Royale News",
        "motds": [
          {
            "entryType": "Website",
            "image": "https://imgur.com/a/A5Ui8ij",
            "tileImage": "https://imgur.com/a/A5Ui8ij",
            "videoURL": "http://localhost:3551/videos/motd.mp4",
            "videoMute": false,
            "videoLoop": false,
            "videoAutoplay": true,
            "videoFullscreen": true,
            "videoStreamingEnabled": true,
            "hidden": false,
            "tabTitleOverride": "Thanks for using Comoxy OG",
            "_type": "CommonUI Simple Message MOTD",
            "title": "Welcome to Reload!",
            "body": "This backend was made by Comoxy OG.",
            "offerAction": "ShowOfferDetails",
            "sortingPriority": 1,
            "websiteButtonText": "Comoxy Backend v1.0.0 - Github",
            "websiteURL": "https://github.com/comoxyOG/comoxyog/releases",
            "id": "61fb3dd8-f23d-45cc-9058-058ab223ba5c",
            "spotlight": false
          }
        ]
      }
    },

    // --- Stubbed sections the client expects ---
    "emergencynotice": { "news": { "messages": [] } },
    "shopCarousel": { "items": [] },
    "subgameselectdata": {},
    "battleroyalenewsv2": {},
    "playlistinformation": {},
    "tournamentinformation": {}
  };

  res.json(payload);
});

// ------------------------
// Middleware
// ------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(nexoRoutes);


app.use((req, res, next) => {
  if (req.path.startsWith("/eulatracking/")) return res.status(204).end();
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ------------------------
// Routers (profile/equip/locker/shop purchase, item shop, regions, matchmaking)
// ------------------------
app.use(profileRoutes);
app.use(shopRoutes);
app.use(regionRoutes);
app.use("/", matchmakeRoutes);

// ------------------------
// In-memory store
// ------------------------
const users = new Map();
let mainUser = null;

// ------------------------
// Equipped skin state (untouched logic retained, additive enhancement)
// ------------------------
const equippedSkins = new Map();
const equippedEmotes = new Map();
function setEquippedEmotes(accountId, emoteIds) {
  equippedEmotes.set(accountId, emoteIds);
}
function getEquippedEmotes(accountId) {
  return equippedEmotes.get(accountId) || config.defaults?.equippedEmotes || ["EID_DanceMoves"];
}

function setEquippedSkin(accountId, cid) {
  equippedSkins.set(accountId, cid);
}
function getEquippedSkin(accountId) {
  return equippedSkins.get(accountId) || config.defaults?.equippedSkin || "CID_788_Athena_Commando_M_Mastermind_Ghost";
}

// ------------------------
// XP helper (additive)
// ------------------------
function addXp(accountId, amount) {
  if (typeof amount !== "number" || amount <= 0) return;
  const user = users.get(accountId);
  if (!user) return;
  user.xp = (user.xp || 0) + amount;
}

// ------------------------
// Prompt for username/email at startup
// ------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function makeMainUser(username, email) {
  // stable id derived from the display name: same name => same account => saved locker/shop data is found again
  const accountId = "acc-" + crypto.createHash("sha256").update(String(username).trim().toLowerCase()).digest("hex");
  mainUser = {
    accountId,
    username,
    email,
    level: config.defaults?.level || 1,
    xp: config.defaults?.xp || 0,
    platform: "PC"
  };
  users.set(accountId, mainUser);
  registerAccount(mainUser);
  console.log("Account ready:", mainUser.username, `(${accountId.slice(0, 16)}...)`);
}

function askCredentials(callback) {
  // skip the prompt with:  set COMOXY_NAME=YourName   (and optionally COMOXY_EMAIL)
  if (process.env.COMOXY_NAME) {
    makeMainUser(process.env.COMOXY_NAME, process.env.COMOXY_EMAIL || `${process.env.COMOXY_NAME}@gmail.com`);
    rl.close();
    return callback();
  }
  rl.question("Enter your display name: ", (username) => {
    rl.question("Enter your email: ", (email) => {
      makeMainUser(username, email);
      rl.close();
      callback();
    });
  });
}

// ------------------------
// Cloudstorage manifest + file serving
// ------------------------
const cloudFiles = [
  "DefaultEngine.ini",
  "DefaultGame.ini",
  "DefaultRuntimeOptions.ini",
  "DefaultInput.ini"
];

// Manifest: tells the client which files exist
app.get("/fortnite/api/cloudstorage/system", (req, res) => {
  const manifest = cloudFiles.map((file) => {
    const filePath = path.join(__dirname, "cloudstorage", file);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    return {
      uniqueFilename: file,
      filename: file,
      hash: crypto.createHash("sha1").update(data).digest("hex"),
      hash256: crypto.createHash("sha256").update(data).digest("hex"),
      length: data.length,
      contentType: "application/octet-stream",
      uploaded: new Date().toISOString(),
      storageType: "S3",
      doNotCache: false
    };
  }).filter(Boolean);

  res.json(manifest);
});

// Serve each file
app.get("/fortnite/api/cloudstorage/system/:filename", (req, res) => {
  const filePath = path.join(__dirname, "cloudstorage", req.params.filename);
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "text/plain");
    res.send(fs.readFileSync(filePath, "utf-8"));
  } else {
    res.status(404).send("File not found");
  }
});

// ------------------------
// NEW: OAuth token endpoint (additive, fixes 404)
// ------------------------
app.post("/account/api/oauth/token", (req, res) => {
  // one account per login name; the launcher sends the player's name as the password-grant username
  const body = req.body || {};
  let acc = null;
  if (body.grant_type === "password" && body.username) acc = accountFromName(body.username, config.defaults);
  else if (body.grant_type === "refresh_token") acc = accountFromToken(body.refresh_token);
  if (!acc) acc = mainUser; // fallback: host account
  const id = acc?.accountId || "acc-unknown";
  const { access, refresh } = issueTokens(id);

  res.json({
    access_token: access,
    expires_in: 28800,
    expires_at: new Date(Date.now() + 28800 * 1000).toISOString(),
    token_type: "bearer",
    refresh_token: refresh,
    refresh_expires: 86400,
    refresh_expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
    account_id: id,
    client_id: "comoxy-og",
    internal_client: true,
    client_service: "fortnite",
    displayName: acc?.username || "Player",
    app: "fortnite",
    in_app_id: id,
    device_id: crypto.randomUUID()
  });
});

// ------------------------
// FIX: OAuth verify endpoint (existing, untouched but kept)
// ------------------------
app.get("/account/api/oauth/verify", (req, res) => {
  const token = (req.headers.authorization || "").replace(/^bearer\s+/i, "");
  const acc = accountFromToken(token) || mainUser;
  res.json({
    access_token: token || crypto.randomUUID(),
    expires_in: 28800,
    expires_at: new Date(Date.now() + 28800 * 1000).toISOString(),
    token_type: "bearer",
    client_id: "comoxy-og",
    internal_client: true,
    client_service: "fortnite",
    account_id: acc?.accountId || "acc-unknown",
    displayName: acc?.username || "Player",
    app: "fortnite",
    in_app_id: acc?.accountId || "acc-unknown",
    device_id: crypto.randomUUID()
  });
});

// ------------------------
// Import routes (untouched)
// ------------------------
import accountRouter from "./src/routes/account.js";
import authRouter from "./src/routes/auth.js";
import cloudStorageRouter from "./src/routes/cloudstorage.js";
import contentPagesRouter from "./src/routes/contentpages.js";
import keychainRouter from "./src/routes/keychain.js";
import versionRouter from "./src/routes/version.js";

app.use("/", accountRouter);
app.use("/", authRouter);
app.use("/", cloudStorageRouter);
app.use("/content/api/pages", contentPagesRouter);
app.use("/", keychainRouter);
app.use("/", versionRouter);

// ------------------------
// Core Epic-style Endpoints (untouched)
// ------------------------
app.get("/lightswitch/api/service/bulk/status", (req, res) => {
  res.status(200).json([
    {
      serviceInstanceId: "fortnite",
      status: "UP",
      message: "Fortnite is online",
      maintenanceUri: null,
      overrideCatalogIds: [],
      allowedActions: ["PLAY", "DOWNLOAD"],
      banned: false,
      launcherInfoDTO: {
        appName: "Fortnite",
        catalogItemId: "comoxy-og",
        namespace: "fortnite"
      }
    }
  ]);
});

app.get("/status", (req, res) => res.json({ status: "OK", time: new Date().toISOString() }));
app.get("/launcher/api/status", (req, res) => res.json({ status: "OK", service: "Comoxy OG Backend" }));
app.get("/fortnite/api/game/v2/enabled_features", (req, res) => res.json([]));

app.get("/fortnite/api/game/v2/timeline", (req, res) => {
  res.json({
    channels: {
      "client-matchmaking": {
        states: [
          {
            validFrom: new Date().toISOString(),
            activeEvents: [],
            state: {}
          }
        ],
        cacheExpire: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      }
    },
    cacheIntervalMins: 15,
    currentTime: new Date().toISOString()
  });
});
// ------------------------
// Stub Endpoints
// ------------------------
app.post("/datarouter/api/v1/public/data", (req, res) => res.status(204).send());
app.get("/waitingroom/api/waitingroom", (req, res) => res.status(204).send());
app.get("/unknown", (req, res) => res.json({ status: "ok" }));

// ------------------------
// QueryProfile using preloaded JSONs from /profiles
// ------------------------

const profilesDir = path.join(__dirname, "profiles");
const profileFiles = [
  "athena.json",
  "campaign.json",
  "collection_book_people0.json",
  "collection_book_schematics0.json",
  "collections.json",
  "common_core.json",
  "common_public.json",
  "creative.json",
  "metadata.json",
  "outpost0.json",
  "profile0.json",
  "theater0.json"
];

// Preload all profiles at startup
const loadedProfiles = {};
for (const file of profileFiles) {
  const filePath = path.join(profilesDir, file);
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const profileId = path.basename(file, ".json");
      loadedProfiles[profileId] = data;
      console.log(` Loaded ${file}`);
    } else {
      console.warn(` Missing ${file}`);
    }
  } catch (err) {
    console.error(` Error reading ${file}:`, err.message);
  }
}


// ------------------------
// Extra stubs to satisfy client requests
// ------------------------
app.get("/fortnite/api/v2/versioncheck/Windows", (req, res) =>
  res.json({ type: "NO_UPDATE", message: "Up to date", version: req.query.version || "unknown" })
);

app.get("/account/api/public/account/:accountId/externalAuths", (req, res) => res.json({}));
app.get("/v1/avatar/fortnite/ids", (req, res) => res.json([]));
app.get("/fortnite/api/cloudstorage/user/:accountId", (req, res) => res.json([]));
app.get("/content-controls/:accountId", (req, res) => res.json({}));
app.get("/content-controls/:accountId/rules/namespaces/fn", (req, res) => res.json([]));


app.get("/fortnite/api/storefront/v2/keychain", (req, res) => res.json([]));
app.get("/fortnite/api/receipts/v1/account/:accountId/receipts", (req, res) => res.json([]));

app.get("/friends/api/v1/:accountId/summary", (req, res) =>
  res.json({ friends: [], incoming: [], outgoing: [] })
);
app.get("/friends/api/v1/:accountId/recent/fortnite", (req, res) => res.json([]));
app.get("/socialban/api/public/v1/:accountId", (req, res) => res.json({ bans: [] }));
app.get("/party/api/v1/Fortnite/user/:accountId", (req, res) => res.json({ current: null }));
app.get("/party/api/v1/Fortnite/user/:accountId/notifications/undelivered/count", (req, res) =>
  res.json({ count: 0 })
);

app.get("/sdk/v1/default", (req, res) => {
  res.json({ settings: {} });
});


app.put("/profile/languages", (req, res) => {
  res.json({ language: "en" });
});

app.put("/profile/privacy_settings", (req, res) => {
  res.json({ privacy: "public" });
});


app.get("/region", (req, res) => {
  res.json({ region: "NA" });
});

app.get("/fortnite/api/game/v2/privacy/account/:accountId", (req, res) => {
  res.json({
    privacySettings: {
      partyType: "Public",
      voiceChat: "FriendsOnly",
      gameStatsVisibility: "Public"
    }
  });
});

app.get("/presence/api/v1/_/:accountId/last-online", (req, res) => {
  res.json({ lastOnline: new Date().toISOString() });
});

app.get("/api/v2/interactions/aggregated/Fortnite/:accountId", (req, res) => {
  res.json({ interactions: [] });
});

app.get("/api/v2/interactions/latest/Fortnite/:accountId", (req, res) => {
  res.json({ interactions: [] });
});

app.get("/fortnite/api/calendar/v1/timeline", (req, res) => {
  res.json({
    channels: {},
    cacheIntervalMins: 15,
    currentTime: new Date().toISOString()
  });
});

app.get("/statsproxy/api/statsv2/account/:accountId", (req, res) => {
  res.json({ stats: {} });
});

app.post("/api/v1/assets/Fortnite/:build/:cl", (req, res) => {
  res.json({ assets: [] });
});

app.get("/content/api/pages/fortnite-game/media-events", (req, res) => {
  res.json({ events: [] });
});

app.get("/api/v1/events/Fortnite/download/:accountId", (req, res) => {
  res.json({ events: [] });
});

app.get("/fortnite/api/game/v2/br-inventory/account/:accountId", (req, res) => {
  const { accountId } = req.params;

  // Ensure profile exists
  const root = initProfile(accountId);
  const athena = root.athena || { items: {} };

  // Get currently equipped skin
  const equipped = getEquippedSkin(accountId);

  // Collect all item keys
  const items = Object.keys(athena.items || {});

  // Guarantee the equipped skin is present
  if (equipped && !items.includes(`AthenaCharacter:${equipped}`)) {
    items.push(`AthenaCharacter:${equipped}`);
  }

  res.json({ items });
});



// ------------------------
// Live profile revision + locker state
// ------------------------
const profileRvns = new Map(); // accountId -> revision number
const lockerState = new Map(); // accountId -> { Character: { items: [...], activeVariants: [] } }

function bumpRvn(accountId) {
  const current = profileRvns.get(accountId) || 0;
  const next = current + 1;
  profileRvns.set(accountId, next);
  return next;
}

function ensureLocker(accountId) {
  if (!lockerState.has(accountId)) {
    lockerState.set(accountId, {
      Character: {
        items: [ `AthenaCharacter:${getEquippedSkin(accountId)}` ],
        activeVariants: []
      }
    });
  }
  return lockerState.get(accountId);
}

// ------------------------
// NEW: Equip Endpoints
// ------------------------




// ------------------------
// 6. Inventory endpoint (ensures equipped skin is visible)
// ------------------------
app.get("/fortnite/api/game/v2/br-inventory/account/:accountId", (req, res) => {
  const { accountId } = req.params;
  const root = initProfile(accountId);
  const athena = root.athena || { items: {} };
  const equipped = getEquippedSkin(accountId);

  const items = Object.keys(athena.items || {});
  if (equipped && !items.includes(`AthenaCharacter:${equipped}`)) {
    items.push(`AthenaCharacter:${equipped}`);
  }

  res.json({ items });
});

app.post("/fortnite/api/game/v2/profile/:accountId/client/JoinMatchmaking", (req, res) => {
  const { accountId } = req.params;

  const profileRoot = initProfile(accountId);
  const profile = profileRoot.multiplayer || {
    _id: accountId,
    profileId: "multiplayer",
    revision: 0,
    items: {},
    stats: { attributes: {} }
  };
  profileRoot.multiplayer = profile;

  // Increment revision
  const rvn = bumpRvn(accountId);
  profile.revision = rvn;

  // Build a fake matchmaking ticket / opponent list
  const matchmakingTicket = {
    ticketId: `ticket_${Date.now()}`,
    queue: "default",
    opponents: [
      { accountId: "opponent1", skill: 1200 },
      { accountId: "opponent2", skill: 1180 }
    ],
    estimatedWaitSec: 5
  };

  const profileChanges = [
    {
      changeType: "statModified",
      name: "last_matchmaking_ticket",
      value: matchmakingTicket
    }
  ];

  res.json({
    profileRevision: rvn,
    profileId: "multiplayer",
    profileChangesBaseRevision: rvn - 1,
    profileCommandRevision: rvn,
    profileChanges,
    serverTime: new Date().toISOString(),
    responseVersion: 1
  });
});

// ------------------------
// NEW: Daily Reward (10M V-Bucks)
// ------------------------
app.post("/fortnite/api/game/v2/profile/:accountId/client/ClaimDailyReward", (req, res) => {
  addXp(req.params.accountId, 500); // reward 500 XP
  res.json({
    status: "claimed",
    reward: `${config.rewards?.dailyVbucks || 10000000} V-Bucks`,
    xpGained: 500
  });
});

app.post("/fortnite/api/game/v2/profile/:accountId/client/AddXP", (req, res) => {
  const { accountId } = req.params;
  const { amount } = req.body || {};

  if (typeof amount === "number" && amount > 0) {
    addXp(accountId, amount);
  }

  res.json({
    profileRevision: 1,
    profileId: "common_core",
    profileChangesBaseRevision: 1,
    profileChanges: [],
    serverTime: new Date().toISOString(),
    responseVersion: 1
  });
});

// ------------------------
// NEW: Matchmaking with UUIDs
// ------------------------
app.post("/fortnite/api/matchmaking/session/join", (req, res) => {
  const sessionId = crypto.randomUUID();
  res.json({ status: "joined", sessionId });
});

app.post("/fortnite/api/matchmaking/session/leave", (req, res) => {
  const sessionId = crypto.randomUUID();
  res.json({ status: "left", sessionId });
});

// ------------------------
// NEW: Party with UUIDs
// ------------------------
app.post("/party/api/v1/Fortnite/party/create", (req, res) => {
  const partyId = crypto.randomUUID();
  res.json({ partyId, members: [] });
});

app.post("/party/api/v1/Fortnite/party/join", (req, res) => {
  const partyId = crypto.randomUUID();
  res.json({ status: "joined", partyId });
});

app.post("/party/api/v1/Fortnite/party/leave", (req, res) => {
  const partyId = crypto.randomUUID();
  res.json({ status: "left", partyId });
});

// ------------------------
// NEW: System info
// ------------------------
app.get("/system/info", (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    platform: process.platform,
    nodeVersion: process.version
  });
});

// ------------------------
// Start server after prompt
// ------------------------
askCredentials(() => {
  const server = createServer(app);

  // Attach WebSocket server for Matchmaker.js
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    console.log("[WS] Client connected to matchmaking");
    matchmakerHandler(ws, req, app.locals.config); // hand off to your Matchmaker.js flow
  });

  const BIND = config?.server?.bindHost || "26.140.180.160";
  server.listen(PORT, BIND, () => {
    console.log(`Comoxy OG Backend running on http://${BIND}:${PORT}`);
  });
});

// ------------------------
// Node process error hooks
// ------------------------
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

// ------------------------
// Export shared state for routes
// ------------------------
export { mainUser, users, setEquippedSkin, getEquippedSkin, setEquippedEmotes, getEquippedEmotes, addXp };

