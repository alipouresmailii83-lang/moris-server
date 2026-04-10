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

// حافظه مکالمه
let conversationHistory = [];

// تعداد پیام‌هایی که نگه می‌داریم
const MAX_HISTORY = 8;

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

    if (!text) {
      return res.status(400).send("Missing text");
    }

    // پیام جدید کاربر را به حافظه اضافه کن
    conversationHistory.push({
      role: "user",
      content: text,
    });

    // فقط چند پیام آخر را نگه دار
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    const messages = [
      {
        role: "system",
        content:
          "You are Moris, a calm and premium AI assistant. Keep context of the conversation, answer naturally, and ask follow-up questions when appropriate. Keep responses concise and clear.",
      },
      ...conversationHistory,
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    const reply = response.output_text || "";

    // جواب Moris را هم داخل حافظه نگه دار
    conversationHistory.push({
      role: "assistant",
      content: reply,
    });

    // دوباره محدودش کن
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

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
