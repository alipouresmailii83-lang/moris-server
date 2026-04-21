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

async function fixTranscription(text) {
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are correcting speech-to-text output. " +
            "The text may contain errors. Fix it into a natural Persian sentence. " +
            "Keep English names like Trump, iPhone, Apple unchanged. " +
            "Do not change the meaning. Only fix mistakes."
        },
        {
          role: "user",
          content: text
        }
      ]
    });

    return response.output_text.trim();
  } catch (e) {
    return text;
  }
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

      const ts = Date.now();
      const tempPath = `/tmp/stt-${ts}.wav`;
      const debugPath = `/tmp/stt-last.wav`;

      fs.writeFileSync(tempPath, req.body);
      fs.writeFileSync(debugPath, req.body);

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "gpt-4o-transcribe",
        prompt: "This is casual Persian speech and may include English product names and person names. Transcribe faithfully and do not invent unrelated words."
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

app.get("/debug/stt-last", (req, res) => {
  const debugPath = `/tmp/stt-last.wav`;

  if (!fs.existsSync(debugPath)) {
    return res.status(404).send("No debug audio");
  }

  res.setHeader("Content-Type", "audio/wav");
  fs.createReadStream(debugPath).pipe(res);
});

// برای chat و tts
app.use(express.json({ limit: "2mb" }));

// -------------------- Health --------------------
app.get("/", (req, res) => {
  res.send("Moris server running");
});

// -------------------- Chat --------------------
function extractUserInfo(text) {
  const t = String(text || "").trim();

  // Persian: "اسمم علی هست" / "اسم من علی است"
  let m = t.match(/اسمم\s+(.+?)(?:\s+هست|\s+است|$)/);
  if (m) return { name: m[1].trim() };

  m = t.match(/اسم\s+من\s+(.+?)(?:\s+هست|\s+است|$)/);
  if (m) return { name: m[1].trim() };

  // English: "my name is Ali"
  m = t.match(/my name is\s+(.+)$/i);
  if (m) return { name: m[1].trim() };

  return null;
}


app.post("/chat", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const deviceId = String(req.body?.device_id || "default").trim();

    if (!text) {
      return res.status(400).send("Missing text");
    }

    if (!memoryStore[deviceId]) {
      memoryStore[deviceId] = {
        history: [],
        profile: {}
      };
    }

    let history = Array.isArray(memoryStore[deviceId].history)
      ? memoryStore[deviceId].history
      : [];

    let profile = memoryStore[deviceId].profile || {};

    // ===== Save long-term user info (like name) =====
    const info = extractUserInfo(text);
    if (info) {
      profile = { ...profile, ...info };
      memoryStore[deviceId].profile = profile;
    }

    // ===== Add user message to history =====
    history.push({
      role: "user",
      content: text,
    });

    // Keep last 12 messages
    if (history.length > 12) {
      history = history.slice(-12);
    }

    // ===== Build system prompt =====
    const systemPrompt =
  "You are Moris, a premium AI voice assistant. " +
  "Always reply in the same language as the user's latest message. " +
  "If the user speaks Persian, reply in natural Persian. " +
  "If the user speaks English, reply in natural English. " +
  "Do not randomly switch languages. " +
  "Be friendly, natural, and conversational. " +
  "Continue the conversation naturally instead of giving dry answers. " +
  "Sometimes ask a short follow-up question when appropriate. " +
  "Keep replies short, clear, and easy to speak aloud. " +
  "Do not sound robotic. " +
  "Very important: if the user's message seems unclear, ambiguous, or strange, do not assume or hallucinate. " +
  "Instead, politely ask the user to repeat or clarify. " +
  "Do not turn unclear words into a different topic. " +
  "If the message transcription looks wrong, say that you may have heard it incorrectly. " +
  (profile.name ? `The user's name is ${profile.name}. Use it naturally sometimes. ` : "");

    const input = [
      {
        role: "system",
        content: systemPrompt,
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

    // ===== Save assistant reply to history =====
    history.push({
      role: "assistant",
      content: reply,
    });

    if (history.length > 12) {
      history = history.slice(-12);
    }

    memoryStore[deviceId].history = history;
    memoryStore[deviceId].profile = profile;
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
