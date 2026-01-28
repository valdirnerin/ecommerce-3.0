const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DATA_DIR, dataPath, IS_PERSISTENT } = require("./dataDir");

const ANALYTICS_DIR = path.join(DATA_DIR, "analytics");
const ARCHIVE_DIR = path.join(ANALYTICS_DIR, "archive");
const EVENT_FILE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const ARCHIVE_FILE_PATTERN = /^(\d{4})-W(\d{2})\.jsonl\.gz$/;
const DEFAULT_HOT_DAYS = 14;
const DEFAULT_ARCHIVE_WEEKS = 12;

function ensureDirs() {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function getDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function getEventFilePath(dateKey) {
  return path.join(ANALYTICS_DIR, `events-${dateKey}.jsonl`);
}

function listEventFiles() {
  ensureDirs();
  let entries = [];
  try {
    entries = fs.readdirSync(ANALYTICS_DIR);
  } catch {
    return [];
  }
  return entries
    .map((name) => {
      const match = EVENT_FILE_PATTERN.exec(name);
      if (!match) return null;
      return {
        name,
        dateKey: match[1],
        filePath: path.join(ANALYTICS_DIR, name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function listArchiveFiles() {
  ensureDirs();
  let entries = [];
  try {
    entries = fs.readdirSync(ARCHIVE_DIR);
  } catch {
    return [];
  }
  return entries
    .map((name) => {
      const match = ARCHIVE_FILE_PATTERN.exec(name);
      if (!match) return null;
      const year = Number(match[1]);
      const week = Number(match[2]);
      const weekDate = getDateFromIsoWeek(year, week);
      return {
        name,
        year,
        week,
        weekDate,
        filePath: path.join(ARCHIVE_DIR, name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.weekDate - b.weekDate);
}

function parseJsonLine(line) {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function appendEvent(event) {
  if (!event || typeof event !== "object") return;
  ensureDirs();
  const timestamp = event.timestamp || new Date().toISOString();
  const dateKey = getDateKey(timestamp);
  const filePath = getEventFilePath(dateKey);
  const payload = { ...event, timestamp };
  const line = `${JSON.stringify(payload)}\n`;
  await fs.promises.appendFile(filePath, line, "utf8");
}

let sessionsWriteChain = Promise.resolve();

function readSessionsFile() {
  ensureDirs();
  const filePath = path.join(ANALYTICS_DIR, "sessions.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

function persistSessionsFile(sessions) {
  ensureDirs();
  const filePath = path.join(ANALYTICS_DIR, "sessions.json");
  const payload = {
    updatedAt: new Date().toISOString(),
    sessions,
  };
  sessionsWriteChain = sessionsWriteChain
    .then(() =>
      fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8"),
    )
    .catch((err) => {
      console.error("analytics sessions write error", err);
    });
  return sessionsWriteChain;
}

async function upsertSession(sessionData) {
  if (!sessionData || !sessionData.id) return;
  const sessions = readSessionsFile();
  const sessionId = String(sessionData.id);
  const idx = sessions.findIndex((s) => String(s.id) === sessionId);
  const payload = { ...sessionData, id: sessionId };
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...payload };
  } else {
    sessions.push(payload);
  }
  await persistSessionsFile(sessions);
}

function normalizeSearchValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getSessions({ from, to, search, status } = {}) {
  const sessions = readSessionsFile();
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;
  const normalizedSearch = normalizeSearchValue(search);
  const normalizedStatus = normalizeSearchValue(status);
  return sessions
    .filter((session) => {
      if (!session || !session.id) return false;
      const lastSeenRaw =
        session.lastSeenAt || session.lastSeen || session.updatedAt || session.startedAt;
      const lastSeenMs = Date.parse(lastSeenRaw || "");
      if (Number.isFinite(fromMs) && Number.isFinite(lastSeenMs) && lastSeenMs < fromMs) {
        return false;
      }
      if (Number.isFinite(toMs) && Number.isFinite(lastSeenMs) && lastSeenMs > toMs) {
        return false;
      }
      if (normalizedStatus) {
        const sessionStatus = normalizeSearchValue(session.status);
        if (sessionStatus !== normalizedStatus) return false;
      }
      if (normalizedSearch) {
        const haystack = [
          session.id,
          session.userEmail,
          session.userName,
          session.lastPath,
          session.location,
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" |");
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.lastSeenAt || a.lastSeen || a.updatedAt || 0) || 0;
      const bTime = Date.parse(b.lastSeenAt || b.lastSeen || b.updatedAt || 0) || 0;
      return bTime - aTime;
    });
}

function getEventsByRange({ from, to, type } = {}) {
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;
  const typeFilter =
    typeof type === "string"
      ? type
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : null;
  const files = listEventFiles();
  const events = [];
  files.forEach((file) => {
    const dateMs = Date.parse(file.dateKey);
    if (Number.isFinite(fromMs) && Number.isFinite(dateMs) && dateMs < fromMs) return;
    if (Number.isFinite(toMs) && Number.isFinite(dateMs) && dateMs > toMs) return;
    let raw = "";
    try {
      raw = fs.readFileSync(file.filePath, "utf8");
    } catch {
      return;
    }
    raw
      .split("\n")
      .map((line) => parseJsonLine(line))
      .filter(Boolean)
      .forEach((evt) => {
        const ts = Date.parse(evt.timestamp || "");
        if (Number.isFinite(fromMs) && Number.isFinite(ts) && ts < fromMs) return;
        if (Number.isFinite(toMs) && Number.isFinite(ts) && ts > toMs) return;
        if (typeFilter && typeFilter.length) {
          const evtType = String(evt.type || "").toLowerCase();
          if (!typeFilter.includes(evtType)) return;
        }
        events.push(evt);
      });
  });
  const archiveFiles = listArchiveFiles();
  archiveFiles.forEach((archive) => {
    const weekMs = archive.weekDate.getTime();
    if (Number.isFinite(fromMs) && weekMs + 7 * 86400000 < fromMs) return;
    if (Number.isFinite(toMs) && weekMs > toMs) return;
    let raw = null;
    try {
      const compressed = fs.readFileSync(archive.filePath);
      raw = zlib.gunzipSync(compressed).toString("utf8");
    } catch {
      return;
    }
    raw
      .split("\n")
      .map((line) => parseJsonLine(line))
      .filter(Boolean)
      .forEach((evt) => {
        const ts = Date.parse(evt.timestamp || "");
        if (Number.isFinite(fromMs) && Number.isFinite(ts) && ts < fromMs) return;
        if (Number.isFinite(toMs) && Number.isFinite(ts) && ts > toMs) return;
        if (typeFilter && typeFilter.length) {
          const evtType = String(evt.type || "").toLowerCase();
          if (!typeFilter.includes(evtType)) return;
        }
        events.push(evt);
      });
  });
  return events.sort((a, b) => {
    const aTime = Date.parse(a.timestamp || "") || 0;
    const bTime = Date.parse(b.timestamp || "") || 0;
    return aTime - bTime;
  });
}

function getSessionTimeline(sessionId, { from, to } = {}) {
  if (!sessionId) return [];
  const events = getEventsByRange({ from, to });
  const target = String(sessionId);
  return events.filter((evt) => String(evt.sessionId || "") === target);
}

function getLatestEventInfo() {
  const files = listEventFiles();
  if (!files.length) return null;
  const latestFile = files[files.length - 1];
  try {
    const raw = fs.readFileSync(latestFile.filePath, "utf8");
    const lines = raw.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const evt = parseJsonLine(lines[i]);
      if (evt && evt.timestamp) return evt;
    }
  } catch {
    return null;
  }
  return null;
}

function getIsoWeek(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week: weekNo };
}

function getDateFromIsoWeek(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = simple.getUTCDay() || 7;
  if (day <= 4) {
    simple.setUTCDate(simple.getUTCDate() - day + 1);
  } else {
    simple.setUTCDate(simple.getUTCDate() + 8 - day);
  }
  return simple;
}

function rotateAndArchive({ now = new Date() } = {}) {
  ensureDirs();
  const hotDays = Number.parseInt(process.env.ANALYTICS_HOT_DAYS, 10) || DEFAULT_HOT_DAYS;
  const archiveWeeks =
    Number.parseInt(process.env.ANALYTICS_ARCHIVE_WEEKS, 10) || DEFAULT_ARCHIVE_WEEKS;
  const cutoffHot = new Date(now);
  cutoffHot.setUTCDate(cutoffHot.getUTCDate() - hotDays + 1);
  cutoffHot.setUTCHours(0, 0, 0, 0);

  const files = listEventFiles();
  const archiveGroups = new Map();
  files.forEach((file) => {
    const fileDate = new Date(`${file.dateKey}T00:00:00.000Z`);
    if (fileDate >= cutoffHot) return;
    const { year, week } = getIsoWeek(fileDate);
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    if (!archiveGroups.has(key)) {
      archiveGroups.set(key, []);
    }
    archiveGroups.get(key).push(file);
  });

  archiveGroups.forEach((groupFiles, key) => {
    const archivePath = path.join(ARCHIVE_DIR, `${key}.jsonl.gz`);
    const contents = groupFiles
      .map((file) => {
        try {
          return fs.readFileSync(file.filePath, "utf8");
        } catch {
          return "";
        }
      })
      .join("");
    if (!contents.trim()) return;
    const zipped = zlib.gzipSync(contents);
    fs.writeFileSync(archivePath, zipped);
    groupFiles.forEach((file) => {
      try {
        fs.unlinkSync(file.filePath);
      } catch (err) {
        console.warn("analytics archive cleanup error", err?.message || err);
      }
    });
  });

  const archiveCutoff = new Date(now);
  archiveCutoff.setUTCDate(archiveCutoff.getUTCDate() - archiveWeeks * 7);
  let archiveEntries = [];
  try {
    archiveEntries = fs.readdirSync(ARCHIVE_DIR);
  } catch {
    archiveEntries = [];
  }
  archiveEntries.forEach((name) => {
    const match = ARCHIVE_FILE_PATTERN.exec(name);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const weekDate = getDateFromIsoWeek(year, week);
    if (weekDate < archiveCutoff) {
      try {
        fs.unlinkSync(path.join(ARCHIVE_DIR, name));
      } catch (err) {
        console.warn("analytics archive retention error", err?.message || err);
      }
    }
  });

  if (!IS_PERSISTENT) {
    console.warn(
      "[analytics] DATA_DIR no es persistente; los logs pueden perderse al reiniciar.",
    );
  }
}

function getTrackingHealth() {
  const lastEvent = getLatestEventInfo();
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const eventsLastHour = getEventsByRange({ from: oneHourAgo, to: new Date(now) }).length;
  return {
    lastEventAt: lastEvent?.timestamp || null,
    eventsLastHour,
    isPersistentDataDir: IS_PERSISTENT,
    dataDirPath: dataPath("").replace(/\/$/, ""),
  };
}

module.exports = {
  appendEvent,
  upsertSession,
  getSessions,
  getSessionTimeline,
  getEventsByRange,
  rotateAndArchive,
  getTrackingHealth,
  ANALYTICS_DIR,
};
