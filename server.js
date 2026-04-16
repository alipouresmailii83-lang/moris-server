const express = require("express");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// مهم: اول raw route بیاد
app.post(
  "/stt",
  express.raw({ type: "audio/wav", limit: "6mb" }),
  async (req, res) => {
    try {
      if (!req.body || !req.body.length) {
        return res.status(400).send("");
      }

      const tempPath = `/tmp/stt-${Date.now()}.wav`;
      fs.writeFileSync(tempPath, req.body);

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "gpt-4o-mini-transcribe",
        language: "fa"
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

app.use(express.json({ limit: "2mb" }));

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

    if (history.length > 10) {
      history = history.slice(-10);
    }

    const messages = [
      {
        role: "system",
        content: `
You are Moris, a premium AI voice assistant.

IMPORTANT RULES:
- Always reply in Persian.
- Never reply in English unless the user explicitly asks for English.
- Do not use Finglish.
- Use natural spoken Persian.
- Keep answers short, clear, and friendly.
- Remember the previous conversation context.
`,
      },
      ...history,
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    const reply =
      response.output_text?.trim() || "متوجه نشدم، دوباره بگو.";

    history.push({
      role: "assistant",
      content: reply,
    });

    if (history.length > 10) {
      history = history.slice(-10);
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

app.post("/tts", async (req, res) => {
  try {
    const text = req.body?.text || "";

    if (!text) {
      return res.status(400).send("Missing text");
    }

    const cleanText = String(text).replace(/[A-Za-z]/g, "");

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "cedar",
      input: cleanText,
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

app.get("/", (req, res) => {
  res.send("Moris server running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
