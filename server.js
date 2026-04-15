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

// ===== STT =====
app.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    const filePath = req.file.path;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-mini-transcribe",
    });

    fs.unlinkSync(filePath);

    res.json({ text: transcription.text });
  } catch (e) {
    console.log(e);
    res.status(500).json({ text: "" });
  }
});

// ===== CHAT =====
app.post("/chat", async (req, res) => {
  try {
    const text = req.body.text;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: text,
    });

    res.send(response.output_text);
  } catch (e) {
    console.log(e);
    res.status(500).send("");
  }
});

// ===== TTS =====
app.post("/tts", async (req, res) => {
  try {
    const text = req.body.text;

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "cedar",
      input: text,
      response_format: "pcm"
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buffer);
  } catch (e) {
    console.log(e);
    res.status(500).send("");
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
