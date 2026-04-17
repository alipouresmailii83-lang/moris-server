const express = require("express");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------------------- Config --------------------
const PORT = process.env.PORT || 3000;
const MEMORY_FILE = path.join(process.cwd(), "memory.json");
const MAX_HISTORY = 10;

// -------------------- Memory --------------------
let memoryStore = {};

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

function getDeviceMemory(deviceId) {
  if (!memoryStore[deviceId]) {
    memoryStore[deviceId] = { history: [] };
  }
  return memoryStore[deviceId];
}

// -------------------- Helpers --------------------
function trimHistory(history, maxItems = MAX_HISTORY) {
  if (!Array.isArray(history)) return [];
  if (history.length <= maxItems) return history;
  return history.slice(-maxItems);
}

function normalizeForTTS(text) {
  if (!text) return "";
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/([.!?؟])([^\s])/g, "$1 $2")
    .trim();
}

// مهم:
// route مربوط به STT باید قبل از express.json بیاد
app.post(
  "/stt",
  express.raw({ type: "audio/wav", limit: "8mb" }),
  async (req, res) => {
    try {
      if (!req.body || !req.body.length) {
        return res.status(400).send("");
      }

      const tempPath = `/tmp/stt-${Date.now()}.wav`;
      fs.writeFileSync(tempPath, req.body);

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "gpt-4o-transcribe",
        language: "fa",
        prompt: "این یک گفت‌وگوی فارسی محاوره‌ای است. نام دستیار موریس است. متن را دقیق و بدون حدس اضافه بنویس."
      });

      try {
        fs.unlinkSync(tempPath);
      } catch {}

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(transcription.text || "");
    } catch (err) {
      console.error("STT ERROR:", err);
      res.status(500).send("STT_SERVER_ERROR");
    }
  }
);

// برای chat و tts
app.use(express.json({ limit: "2mb" }));

// -------------------- Health --------------------
app.get("/", (req, res) => {
  res.send("Moris server running");
});

// -------------------- Chat --------------------
app.post("/chat", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const deviceId = String(req.body?.device_id || "default").trim();

    if (!text) {
      return res.status(400).send("Missing text");
    }

    const deviceMemory = getDeviceMemory(deviceId);
    let history = Array.isArray(deviceMemory.history) ? deviceMemory.history : [];

    history.push({
      role: "user",
      content: text,
    });

    history = trimHistory(history, MAX_HISTORY);

    const input = [
      {
        role: "system",
        content:
          "You are Moris, a premium AI voice assistant. " +
          "Always reply in the same language as the user's latest message. " +
          "If the user speaks Persian, reply in natural Persian. " +
          "If the user speaks English, reply in natural English. " +
          "Do not randomly switch languages. " +
          "Keep replies short, clear, friendly, and easy to speak aloud. " +
          "Use natural punctuation so the voice sounds calm and well-paced. " +
          "Remember the recent conversation context.",
      },
      ...history,
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input,
    });

    const reply = String(
      response.output_text || "متوجه نشدم، دوباره بگو."
    ).trim();

    history.push({
      role: "assistant",
      content: reply,
    });

    history = trimHistory(history, MAX_HISTORY);
    deviceMemory.history = history;
    saveMemory();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(reply);
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).send("Chat error");
  }
});

// -------------------- TTS --------------------
app.post("/tts", async (req, res) => {
  try {
    const text = req.body?.text || "";

    if (!text) {
      return res.status(400).send("");
    }

    const speech = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "alloy",
      input: text,
      response_format: "pcm",
      speed: 0.95
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length.toString());
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    console.error("TTS ERROR:", err);
    res.status(500).send("");
  }
});

// -------------------- Memory Debug / Reset --------------------
app.get("/memory/:deviceId", (req, res) => {
  const deviceId = String(req.params.deviceId || "default");
  const deviceMemory = getDeviceMemory(deviceId);
  res.json(deviceMemory);
});

app.post("/memory/:deviceId/reset", (req, res) => {
  const deviceId = String(req.params.deviceId || "default");
  memoryStore[deviceId] = { history: [] };
  saveMemory();
  res.json({ ok: true, deviceId });
});

// -------------------- Start --------------------
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
