// Local video analysis: ffmpeg (frames/audio), whisper (STT), LLaVA (vision)
import { spawn } from "child_process";
import fs from "node:fs";
import path from "node:path";

// Helper to get Docker path for a file relative to project root
function dockerPath(absPath) {
  return "/data/" + path.relative(process.cwd(), absPath).replace(/\\/g, "/");
}

// Helper to run ffmpeg via Docker
export async function dockerFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const dockerArgs = [
      "run", "--rm",
      "-v", `${process.cwd().replace(/\\/g, "/")}:/data`,
      "jrottenberg/ffmpeg",
      ...args
    ];
    const proc = spawn("docker", dockerArgs);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("docker ffmpeg failed"))));
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.stdout.on("data", (d) => process.stdout.write(d));
  });
}

// Helper to run whisper.cpp via Docker
export async function dockerWhisper(args) {
  return new Promise((resolve, reject) => {
    const dockerArgs = [
      "run", "--rm",
      "-v", `${process.cwd().replace(/\\/g, "/")}:/data`,
      "whisper.cpp",
      ...args
    ];
    const proc = spawn("docker", dockerArgs);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("docker whisper.cpp failed"))));
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.stdout.on("data", (d) => process.stdout.write(d));
  });
}

// Extract audio to WAV for whisper
export async function extractAudio(videoPath, outPath) {
  const args = [
    "-y", "-i", dockerPath(videoPath),
    "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", dockerPath(outPath)
  ];
  await dockerFfmpeg(args);
}

// Extract N evenly spaced frames as JPEGs
export async function extractFrames(videoPath, outDir, count = 5) {
  fs.mkdirSync(outDir, { recursive: true });
  // For simplicity, extract 1 frame per second up to count
  const outPattern = path.join(outDir, "frame%d.jpg");
  const args = [
    "-y", "-i", dockerPath(videoPath),
    "-vf", `fps=${count}`,
    dockerPath(outPattern)
  ];
  await dockerFfmpeg(args);
}

// Call whisper.cpp or openai-whisper for STT
export async function transcribeAudio(wavPath) {
  const args = [
    dockerPath(wavPath),
    "--model", "/models/ggml-base.bin",
    "--output_format", "txt"
  ];
  await dockerWhisper(args);
  // Read transcript from output file
  const txtPath = wavPath.replace(/\.wav$/, ".txt");
  return fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf-8") : "";
}

// Call LLaVA via Ollama REST API for each frame
export async function analyzeFramesWithLLaVA(framePaths, prompt, ollamaUrl = "http://localhost:11434") {
  const results = [];
  for (const frame of framePaths) {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llava:13b",
        prompt,
        images: [fs.readFileSync(frame).toString("base64")],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`LLaVA failed: ${res.status}`);
    const data = await res.json();
    results.push(data.response);
  }
  return results;
}

// Main pipeline
export async function analyzeVideoLocal(videoPath, ollamaUrl) {
  const tmp = path.join("./tmp", path.basename(videoPath, path.extname(videoPath)) + "-" + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const audioPath = path.join(tmp, "audio.wav");
  const framesDir = path.join(tmp, "frames");
  await extractAudio(videoPath, audioPath);
  await extractFrames(videoPath, framesDir, 5);
  const transcript = await transcribeAudio(audioPath);
  const frameFiles = fs.readdirSync(framesDir).map(f => path.join(framesDir, f));
  const visionPrompt = "Describe the candidate's body language, confidence, and professionalism.";
  const frameAnalyses = await analyzeFramesWithLLaVA(frameFiles, visionPrompt, ollamaUrl);
  // Clean up tmp if desired
  return { transcript, frameAnalyses };
}
