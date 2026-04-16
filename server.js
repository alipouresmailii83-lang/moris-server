const express = require("express");
const multer = require("multer");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json({ limit: "2mb" }));

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

// ===== Health =====
app.get("/", (req, res) => {
  res.send("Moris server is running");
});

// ===== STT =====
app.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ text: "", error: "No audio file" });
    }

    const filePath = req.file.path;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-mini-transcribe",
    });

    try {
      fs.unlinkSync(filePath);
    } catch {}

    res.json({ text: transcription.text || "" });
  } catch (err) {
    console.error("STT ERROR:", err);
    try {
      if (req.file?.path) fs.unlinkSync(req.file.path);
    } catch {}
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

    if (!memoryStore[deviceId]) {
      memoryStore[deviceId] = { history: [] };
    }

    let history = memoryStore[deviceId].history;

    history.push({
      role: "user",
      content: text,
    });

    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    const messages = [
      {
        role: "system",
        content: `
You are Moris, a premium AI voice assistant.

Style:
- Natural
- Calm
- Friendly
- Not robotic
- Keep responses concise but useful
- Maintain context across the conversation

If the user speaks Persian, reply in Persian.
`,
      },
      ...history,
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    const reply =
      response.output_text?.trim() || "متوجه نشدم، دوباره بگو 👌";

    history.push({
      role: "assistant",
      content: reply,
    });

    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    memoryStore[deviceId].history = history;
    saveMemory();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(reply);
  } catch (err) {
    console.error("CHAT ERROR:", err);
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

    res.status(200);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length.toString());
    res.setHeader("Cache-Control", "no-store");
    res.end(buffer);
  } catch (err) {
    console.error("TTS ERROR:", err);
    res.status(500).send("");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
