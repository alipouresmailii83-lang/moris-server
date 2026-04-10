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

// ===================== Telegram =====================
const TELEGRAM_BOT_TOKEN = "توکن_جدید_ربات";
const TELEGRAM_CHAT_ID = "845841333";

async function sendTelegramMessage(text) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
    }),
  });

  return await response.json();
}

// ===================== Memory =====================
let memoryStore = {};
const MAX_HISTORY = 8;
const MEMORY_FILE = "memory.json";

if (fs.existsSync(MEMORY_FILE)) {
  try {
    memoryStore = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch (e) {
    console.error("Failed to load memory.json", e);
    memoryStore = {};
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
}

// ===================== STT =====================
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

    let msg = "STT error";
    if (err && err.error && err.error.message) msg = err.error.message;
    else if (err && err.message) msg = err.message;

    res.status(500).json({ text: "", error: msg });
  }
});

// ===================== CHAT =====================
app.post("/chat", async (req, res) => {
  try {
    const text = req.body?.text || "";
    const deviceId = req.body?.device_id || "default";

    if (!text) {
      return res.status(400).send("Missing text");
    }

    // اگر کاربر گفت به تلگرامم بگو...
    if (text.startsWith("به تلگرامم بگو")) {
      const msg = text.replace("به تلگرامم بگو", "").trim();

      if (!msg) {
        return res.send("متن پیام رو نگفتی.");
      }

      await sendTelegramMessage(msg);
      return res.send("پیام به تلگرامت فرستاده شد.");
    }

    // اگر برای این دستگاه حافظه نبود، بساز
    if (!memoryStore[deviceId]) {
      memoryStore[deviceId] = {
        history: [],
      };
    }

    let conversationHistory = memoryStore[deviceId].history || [];

    // پیام جدید کاربر
    conversationHistory.push({
      role: "user",
      content: text,
    });

    // محدود کردن history
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
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
      ...conversationHistory
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    const reply = response.output_text || "";

    // ذخیره جواب Moris
    conversationHistory.push({
      role: "assistant",
      content: reply,
    });

    if (conversationHistory.length > MAX_HISTORY) {conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    memoryStore[deviceId].history = conversationHistory;
    saveMemory();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(reply);
  } catch (err) {
    console.error(err);
    res.status(500).send("Chat error");
  }
});

// ===================== TTS =====================
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

// ===================== Telegram Test =====================
app.post("/telegram-test", async (req, res) => {
  try {
    const text = req.body?.text || "سلام از طرف Moris";

    const result = await sendTelegramMessage(text);

    res.json({
      ok: true,
      telegram: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Telegram send failed" });
  }
});

// ===================== Reset Memory =====================
app.post("/reset-memory", (req, res) => {
  memoryStore = {};
  saveMemory();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
