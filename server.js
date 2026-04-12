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
const TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_TOKEN";
const TELEGRAM_BOT_USERNAME = "YourBotUsername";

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const CONTACTS_FILE = "contacts.json";
const PENDING_LINKS_FILE = "pending_links.json";

// ===== Telegram state =====
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

        // Register owner automatically when user just sends /start
        if (!payload) {
          contacts["owner"] = {
            display_name: "خودم",
            chat_id: chatId,
            username,
            first_name: firstName,
          };

          saveContacts();

          await sendTelegramMessage(
            chatId,
            "به عنوان صاحب دستگاه ثبت شدی ✅"
          );

          continue;
        }

        // Register contact from invite link
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

// ===== Helper functions =====
function findContactByDisplayName(targetName) {
  const normalizedTarget = normalizeName(targetName);

  if (normalizedTarget === "خودم" || normalizedTarget === "تلگرامم") {
    const owner = contacts["owner"];
    if (!owner) return null;

    return {
      savedName: "خودم",
      data: owner,
    };
  }

  const found = contacts[normalizedTarget];
  if (!found) return null;

  return {
    savedName: found.display_name || normalizedTarget,
    data: found,
  };
}

async function detectMessageIntent(text, contactsMap) {
  const contactNames = Object.values(contactsMap)
    .map((c) => c.display_name)
    .filter(Boolean);

  const prompt = `
You are an intent parser.

Your job is to detect whether the user wants to send a Telegram message.

Return ONLY valid JSON in one of these two formats:

If the user wants to send a message:
{"intent":"send_message","target_name":"NAME","message_text":"MESSAGE"}

If the user does not want to send a message:
{"intent":"normal_chat"}

Rules:
- The user may speak naturally in Persian.
- If they want to send a message, extract the target person's name and the actual message text.
- If target is "تلگرامم" or "خودم", set target_name to "خودم".
- Known contacts: ${contactNames.join(", ") || "none"}
- Do not explain anything.
- Output JSON only.

User text:
${text}
`;

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  const raw = (response.output_text || "").trim();

  try {
    return JSON.parse(raw);
  } catch (e) {
    return { intent: "normal_chat" };
  }
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

    // Create invite link for a contact and send it to owner on Telegram
    if (text.startsWith("لینک اضافه کردن")) {
      const name = text.replace("لینک اضافه کردن", "").trim();

      if (!name) {
        return res.send("اسم مخاطب رو نگفتی.");
      }

      const owner = contacts["owner"];
      if (!owner) {
        return res.send("اول خودت توی ربات /start بزن تا به عنوان صاحب دستگاه ثبت بشی.");
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
        owner.chat_id,
        `لینک اضافه کردن ${name}:\n${link}`
      );

      return res.send(`لینک اضافه کردن ${name} به تلگرامت فرستاده شد.`);
    }

    // Smart Telegram message detection
    const intentResult = await detectMessageIntent(text, contacts);

    if (intentResult.intent === "send_message") {
      const targetName = intentResult.target_name || "";
      const messageText = intentResult.message_text || "";

      if (!targetName || !messageText) {
        return res.send("متوجه پیام نشدم.");
      }

      const found = findContactByDisplayName(targetName);

      if (!found) {
        return res.send(`مخاطب ${targetName} پیدا نشد.`);
      }

      await sendTelegramMessage(found.data.chat_id, messageText);
      return res.send(`پیام برای ${found.savedName} فرستاده شد.`);
    }

    // Normal conversation memory
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
`,
      },
      ...history,
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
    const owner = contacts["owner"];
    if (!owner) {
      return res.status(400).json({ ok: false, error: "Owner not registered" });
    }

    const text = req.body?.text || "سلام از طرف Moris";
    const result = await sendTelegramMessage(owner.chat_id, text);

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
