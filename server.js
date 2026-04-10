const express = require("express");
const multer = require("multer");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const upload = multer({ dest: "uploads/" });

const MEMORY_FILE = "memory.json";

// لود حافظه
if (fs.existsSync(MEMORY_FILE)) {
  memoryStore = JSON.parse(fs.readFileSync(MEMORY_FILE));
}

// ذخیره حافظه
function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json());

// حافظه مکالمه
let memoryStore = {};


// تعداد پیام‌هایی که نگه می‌داریم
const MAX_HISTORY = 10;

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

// ===================== CHAT WITH MEMORY =====================
app.post("/chat", async (req, res) => {
  try {
    const text = req.body?.text || "";
    const deviceId = req.body?.device_id || "default";

    if (!text) {
      return res.status(400).send("Missing text");
    }

    // اگر برای این دستگاه حافظه نبود، بساز
    if (!memoryStore[deviceId]) {
      memoryStore[deviceId] = [];
    }

    let conversationHistory = memoryStore[deviceId];

    // پیام کاربر
    conversationHistory.push({
      role: "user",
      content: text,
    });

    // محدود کردن حافظه
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    const messages = [
      {
        role: "system",
        content:
          "You are Moris, a premium AI assistant. Remember context, talk naturally, and keep responses short and smart.",
      },
      ...conversationHistory,
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    const reply = response.output_text || "";

    // ذخیره جواب
    conversationHistory.push({
      role: "assistant",
      content: reply,
    });

    // دوباره محدود
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    // ذخیره نهایی
    memoryStore[deviceId] = conversationHistory;
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

// ===================== OPTIONAL RESET MEMORY =====================
app.post("/reset-memory", (req, res) => {
  conversationHistory = [];
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
