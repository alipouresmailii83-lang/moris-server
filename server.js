const express = require("express");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== Telegram config =====
const TELEGRAM_BOT_TOKEN = "8351185413:AAGTSaKyEt2W-PfYHyIUB5_8KkZgy5dMlBc";
const TELEGRAM_BOT_USERNAME = "MorisAgentBor";

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const CONTACTS_FILE = "contacts.json";
const PENDING_LINKS_FILE = "pending_links.json";

let contacts = {};
let pendingLinks = {};
let telegramOffset = 0;

if (fs.existsSync(CONTACTS_FILE)) {
  contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
}

if (fs.existsSync(PENDING_LINKS_FILE)) {
  pendingLinks = JSON.parse(fs.readFileSync(PENDING_LINKS_FILE, "utf8"));
}

function saveContacts() {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

function savePendingLinks() {
  fs.writeFileSync(PENDING_LINKS_FILE, JSON.stringify(pendingLinks, null, 2));
}

async function sendTelegramMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function makeInviteCode() {
  return `c_${Date.now()}`;
}

function buildContactLink(code) {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=add_${code}`;
}

function findContactByChatId(chatId) {
  for (const key in contacts) {
    if (contacts[key].chat_id === chatId) {
      return contacts[key].display_name;
    }
  }
  return null;
}

async function processTelegramUpdates() {
  try {
    const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${telegramOffset}`);
    const data = await res.json();

    if (!data.ok) return;

    for (const update of data.result) {
      telegramOffset = update.update_id + 1;

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const text = msg.text;
      const chatId = String(msg.chat.id);

      // ===== Owner register =====
      if (text === "/start") {
        contacts["owner"] = {
          display_name: "خودم",
          chat_id: chatId,
        };
        saveContacts();

        await sendTelegramMessage(chatId, "ثبت شدی ✅");
        continue;
      }

      // ===== Add contact =====
      if (text.startsWith("/start add_")) {
        const code = text.split("add_")[1];
        const pending = pendingLinks[code];

        if (pending) {
          contacts[pending.normalized_name] = {
            display_name: pending.display_name,
            chat_id: chatId,
          };

          delete pendingLinks[code];
          saveContacts();
          savePendingLinks();

          await sendTelegramMessage(chatId, "ثبت شدی ✅");
        }
      }

      // ===== Forward reply =====
      const owner = contacts["owner"];
      const name = findContactByChatId(chatId);

      if (owner && name && name !== "خودم") {
        await sendTelegramMessage(
          owner.chat_id,
          `پاسخ از ${name}:\n${text}`
        );
      }
    }
  } catch (e) {
    console.log("Telegram error");
  }
}

setInterval(processTelegramUpdates, 4000);

// ===== CHAT =====
app.post("/chat", async (req, res) => {
  const text = req.body.text;

  // ===== Create link =====
  if (text.startsWith("لینک اضافه کردن")) {
    const name = text.replace("لینک اضافه کردن", "").trim();

    const code = makeInviteCode();
    const normalized = normalizeName(name);

    pendingLinks[code] = {
      display_name: name,
      normalized_name: normalized,
    };

    savePendingLinks();

    const link = buildContactLink(code);

    const owner = contacts["owner"];
    if (owner) {
      await sendTelegramMessage(owner.chat_id, link);
    }

    return res.send("لینک ارسال شد");
  }

  // ===== Send message =====
  if (text.startsWith("به ")) {
    const parts = text.split(" بگو ");
    if (parts.length === 2) {
      const name = normalizeName(parts[0].replace("به ", ""));
      const message = parts[1];

      const contact = contacts[name];
      if (contact) {
        await sendTelegramMessage(contact.chat_id, message);
        return res.send("ارسال شد");
      }
    }
  }

  // ===== Normal chat =====
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: text,
  });

  res.send(response.output_text || "...");
});

// ===== TTS =====
app.post("/tts", async (req, res) => {
  const text = req.body.text;

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "cedar",
    input: text,
    response_format: "pcm",
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  res.setHeader("Content-Type", "application/octet-stream");
  res.send(buffer);
});

app.listen(3000, () => console.log("Server running"));
