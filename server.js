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
const TELEGRAM_OWNER_CHAT_ID = "YOUR_CHAT_ID";
const TELEGRAM_BOT_USERNAME = "MorisAgentBot";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const CONTACTS_FILE = "contacts.json";
let contacts = {};
let telegramOffset = 0;
if (fs.existsSync(CONTACTS_FILE)) {
try {
contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
  } catch (e) {
    contacts = {};
  }
}
function saveContacts() {
}
fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
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
  return String(name || "").trim().toLowerCase();
}
function buildContactLink(name) {
  const safe = normalizeName(name).replace(/\s+/g, "_");
return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=add_${safe}`;
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
          const contactName = payload.replace("add_", "").replace(/_/g, " ").trim();
          if (contactName) {
            contacts[contactName] = {
              chat_id: chatId,
              username,
              first_name: firstName,
            };
            saveContacts();
            await sendTelegramMessage(
              chatId,
              `Saved \nNow Moris can send messages to you as "${contactName}".`
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
if (!cleaned.startsWith(" ﻪٮ ")) return null;
if (!cleaned.includes(" ﮕٮﻮ

 ")) return null;
  const withoutBe = cleaned.substring(2);
  const splitIndex = withoutBe.indexOf(" ﮕٮ
  if (splitIndex < 0) return null;ﻮ

 ");
  const targetName = withoutBe.substring(0, splitIndex).trim();
  const messageText = withoutBe.substring(splitIndex + 5).trim();
if (!targetName || !messageText) return null;
  return {
    targetName: normalizeName(targetName),
    messageText,
  };
}
function findContactByNormalizedName(targetName) {
for (const key of Object.keys(contacts)) {
if (normalizeName(key) === targetName) {
return { savedName: key, data: contacts[key] };
    }
  }
  return null;
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
    if (text.startsWith(" ﻮﮕٮ ﻢﻣارﮕﻠٮ ﻪٮ ")) {
      const msg = text.replace(" ﻮﮕٮ ﻢﻣارﮕﻠٮ ﻪٮ ", "").trim();
      if (!msg) {
        return res.send("No message provided.");
      }
      await sendTelegramMessage(TELEGRAM_OWNER_CHAT_ID, msg);
      return res.send("Message sent to your Telegram.");
    }
    if (text.startsWith(" ندﺮﮐ ﻪڡﺎﺿا ﮏٮٮﻟ ")) {
      const name = text.replace(" ندﺮﮐ ﻪڡﺎﺿا ﮏٮٮﻟ ", "").trim();
      if (!name) {
        return res.send("No name provided.");
      }
      const link = buildContactLink(name);
      return res.send(`Send this link: ${link}`);
    }
    const parsed = parseTelegramTarget(text);
    if (parsed) {
      const found = findContactByNormalizedName(parsed.targetName);
      if (!found) {
        return res.send(`Contact not found.`);
      }
      await sendTelegramMessage(found.data.chat_id, parsed.messageText);
      return res.send(`Message sent to ${found.savedName}.`);
    }
    if (!memoryStore[deviceId]) {
      memoryStore[deviceId] = { history: [] };
    }
    let history = memoryStore[deviceId].history;
    history.push({ role: "user", content: text });
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: history,
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
