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
  language: "fa",   // 👈 مهم
});
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

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: text,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(response.output_text?.trim() || "متوجه نشدم");
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).send("");
  }
});

app.post("/tts", async (req, res) => {
  try {
    const text = req.body?.text || "";

    if (!text) {
      return res.status(400).send("");
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
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
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
