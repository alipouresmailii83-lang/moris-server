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

// STT
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

// CHAT
app.post("/chat", async (req, res) => {
  try {
    const text = req.body?.text || "";

    if (!text) {
      return res.status(400).send("Missing text");
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `You are Moris, a calm and premium AI assistant. Answer briefly.\nUser: ${text}`,
    });

    const reply = response.output_text || "";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(reply);
  } catch (err) {
    console.error(err);
    res.status(500).send("Chat error");
  }
});

// TTS
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

app.listen(3000, () => {
  console.log("Moris AI server running on http://localhost:3000");
});