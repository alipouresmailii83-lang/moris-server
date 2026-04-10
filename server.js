const express = require("express");
const multer = require("multer");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json());

// ===== Telegram config =====
const TELEGRAM_BOT_TOKEN = "8351185413:AAGTSaKyEt2W-PfYHyIUB5_8KkZgy5dMlBc";
const TELEGRAM_OWNER_CHAT_ID = "845841333";
const TELEGRAM_BOT_USERNAME = "MorisAgentBot";

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const CONTACTS_FILE = "contacts.json";
const PENDING_LINKS_FILE = "pending_links.json";

let contacts = {};
let pendingLinks = {};
let telegramOffset = 0;

if (fs.existsSync(CONTACTS_FILE)) {
  try {
    contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
  } catch (e) {
    contacts = {};
  }
}

if (fs.existsSync(PENDING_LINKS_FILE)) {
  try {
    pendingLinks = JSON.parse(fs.readFileSync(PENDING_LINKS_FILE, "utf8"));
  } catch (e) {
    pendingLinks = {};
  }
}

function saveContacts() {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

function savePendingLinks() {
  fs.writeFileSync(PENDING_LINKS_FILE, JSON.stringify(pendingLinks, null, 2));
}

async function sendTelegramMessage(chatId, text) {
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });

  return await response.json();
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\u200c/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ");
}

function makeInviteCode() {
  return `c_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function buildContactLink(code) {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=add_${code}`;
}

async function processTelegramUpdates() {
  try {
    const url = `${TELEGRAM_API}/getUpdates?offset=${telegramOffset}&limit=20`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      telegramOffset = update.update_id + 1;

      const msg = update.message;
      if (!msg || !msg.text || !msg.chat) continue;

      const text = msg.text.trim();
      const chatId = String(msg.chat.id);
      const firstName = msg.from?.first_name || "";
      const username = msg.from?.username || "";

      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        const payload = parts[1] || "";

        if (payload.startsWith("add_")) {
          const code = payload.replace("add_", "").trim();
          const pending = pendingLinks[code];

          if (pending && pending.display_name && pending.normalized_name) {
            contacts[pending.normalized_name] = {
              display_name: pending.display_name,
              chat_id: chatId,
              username,
              first_name: firstName,
            };

            delete pendingLinks[code];

            saveContacts();
            savePendingLinks();

            await sendTelegramMessage(
              chatId,
              `ثبت شد ✅\nاز این به بعد Moris می‌تونه با اسم "${pending.display_name}" بهت پیام بده.`
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("Telegram polling error:", err.message);
  }
}

setInterval(processTelegramUpdates, 3000);

// ===== Memory =====
let memoryStore = {};
const MAX_HISTORY = 8;
const MEMORY_FILE = "memory.json";

if (fs.existsSync(MEMORY_FILE)) {
  try {
    memoryStore = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch (e) {
    memoryStore = {};
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
}

// ===== Helpers =====
function parseTelegramTarget(text) {
  const cleaned = text.trim();

  if (!cleaned.startsWith("به ")) return null;
  if (!cleaned.includes(" بگو ")) return null;

  const withoutBe = cleaned.substring(2);
  const splitIndex = withoutBe.indexOf(" بگو ");

  if (splitIndex < 0) return null;

  const targetName = withoutBe.substring(0, splitIndex).trim();
  const messageText = withoutBe.substring(splitIndex + 5).trim();

  if (!targetName || !messageText) return null;

  return {
    targetName: normalizeName(targetName),
    messageText,
  };
}

function findContactByNormalizedName(targetName) {
  const normalizedTarget = normalizeName(targetName);
  const found = contacts[normalizedTarget];

  if (!found) return null;

  return {
    savedName: found.display_name || normalizedTarget,
    data: found,
  };
}

// ===== STT =====
app.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const debugPath = `uploads/debug-${Date.now()}.wav`;

    fs.copyFileSync(filePath, debugPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(debugPath),
      model: "gpt-4o-mini-transcribe",
    });

    fs.unlinkSync(filePath);

    res.json({ text: transcription.text || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ text: "", error: "STT error" });
  }
});

// ===== CHAT =====
app.post("/chat", async (req, res) => {
  try {
    const text = req.body?.text || "";
    const deviceId = req.body?.device_id || "default";

    if (!text) {
      return res.status(400).send("Missing text");
    }

    if (text.startsWith("به تلگرامم بگو")) {
      const msg = text.replace("به تلگرامم بگو", "").trim();

      if (!msg) {
        return res.send("متن پیام رو نگفتی.");
      }

      await sendTelegramMessage(TELEGRAM_OWNER_CHAT_ID, msg);
      return res.send("پیام به تلگرامت فرستاده شد.");
    }

    if (text.startsWith("لینک اضافه کردن")) {
      const name = text.replace("لینک اضافه کردن", "").trim();

      if (!name) {
        return res.send("اسم مخاطب رو نگفتی.");
      }

      const code = makeInviteCode();
      const normalized = normalizeName(name);

      pendingLinks[code] = {
        display_name: name,
        normalized_name: normalized,
        created_at: Date.now(),
      };
      savePendingLinks();

      const link = buildContactLink(code);

      await sendTelegramMessage(
        TELEGRAM_OWNER_CHAT_ID,
        `لینک اضافه کردن ${name}:\n${link}`
      );

      return res.send(`لینک اضافه کردن ${name} به تلگرامت فرستاده شد.`);
    }

    const parsed = parseTelegramTarget(text);
    if (parsed) {
      const found = findContactByNormalizedName(parsed.targetName);

      if (!found) {
        return res.send("مخاطب پیدا نشد.");
      }

      await sendTelegramMessage(found.data.chat_id, parsed.messageText);
      return res.send(`پیام برای ${found.savedName} فرستاده شد.`);
    }

    if (!memoryStore[deviceId]) {
      memoryStore[deviceId] = { history: [] };
    }

    let history = memoryStore[deviceId].history;

    history.push({ role: "user", content: text });

    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    const messages = [
      {
        role: "system",
        content: `
You are Moris, a premium AI voice assistant.

Personality:
- Calm, confident, and slightly charismatic
- Friendly but not overly casual
- Speaks naturally like a human, not robotic

Behavior:
- Always remember conversation context
- Sometimes ask a short follow-up question when appropriate
- If the user answers your question, connect it to your previous message
- Show interest in the user

Style:
- Speak smoothly and naturally
- Avoid long explanations
- Keep a premium, modern tone

Goal:
Make the interaction feel like talking to a real intelligent assistant, not a machine.
`
      },
      ...history
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    const reply = response.output_text || "";

    history.push({ role: "assistant", content: reply });
    memoryStore[deviceId].history = history;
    saveMemory();

    res.send(reply);
  } catch (err) {
    console.error(err);
    res.status(500).send("Chat error");
  }
});

// ===== TTS =====
app.post("/tts", async (req, res) => {
  try {
    const text = req.body?.text || "";

    if (!text) {
      return res.status(400).send("Missing text");
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "cedar",
      input: text,
      response_format: "pcm",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length.toString());
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send("TTS error");
  }
});

// ===== Debug routes =====
app.get("/contacts", (req, res) => {
  res.json(contacts);
});

app.get("/pending-links", (req, res) => {
  res.json(pendingLinks);
});

app.post("/telegram-test", async (req, res) => {
  try {
    const text = req.body?.text || "سلام از طرف Moris";
    const result = await sendTelegramMessage(TELEGRAM_OWNER_CHAT_ID, text);

    res.json({
      ok: true,
      telegram: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Telegram send failed" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
