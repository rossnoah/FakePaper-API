import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { buildPrompt, cleanLatex, generateLatex } from "./generator"; // Adjust the import path as needed
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { put } from "@vercel/blob";
import { spawn } from "child_process";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = (process.env.PORT as unknown as number) || 3000;
const SITE_URL = process.env.SITE_URL;

if (!AUTH_TOKEN || !BLOB_READ_WRITE_TOKEN || !OPENAI_API_KEY) {
  console.error("One or more environment variables are not set in .env file");
  process.exit(1);
}

export const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type"],
  })
); // Enable CORS for all routes

app.use(express.json()); // Parse JSON bodies

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Generation API is running!" });
});

app.get("/api/generate", (req, res) => {
  res.status(400).send("You must POST to /api/generate");
});

// Job Queue
const jobQueue: { [key: string]: any } = {};

// Util function to validate request body
function validateRequestBody(
  body: any
): body is { topic: string; isPremium: boolean } {
  return (
    typeof body?.topic === "string" && typeof body?.isPremium === "boolean"
  );
}

// Async wrapper for LaTeX PDF generation process
async function generatePdfFromLatex(
  latexString: string,
  tmpDir: string
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const uuid = uuidv4();
    const inputPath = path.join(tmpDir, `${uuid}.tex`);
    const outputPath = path.join(tmpDir, `${uuid}.pdf`);
    fs.writeFileSync(inputPath, latexString);
    let latexProcess;
    try {
      latexProcess = spawn("pdflatex", [
        "-output-directory",
        tmpDir,
        inputPath,
      ]);
    } catch (error) {
      console.error(error);
      return null;
    }

    latexProcess.on("exit", (code) => {
      if (code !== 0) {
        cleanupTempFiles(tmpDir);
        reject("Failed to compile LaTeX document.");
      } else {
        resolve(outputPath);
      }
    });
  });
}

function extractTitleFromLatex(latexString: string): string {
  const titleRegex = /\\title{([^}]*)}/;

  const titleMatch = latexString.match(titleRegex);
  let title = titleMatch ? titleMatch[1] : "Untitled";
  title = title.replace("\\\\", " ");
  return title;
}

// Rate limiter to 5 requests per minute and 20 requests per 24 hours
const shortTermLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 2 minutes
  max: 5,
  message: "Too many requests from this IP, please try again after 1 minute",
});

const longTermLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 20,
  message: "Too many requests from this IP, please try again after 24 hours",
});

app.use("/api/generate", shortTermLimiter);
app.use("/api/generate", longTermLimiter);

app.post("/api/generate", async (req, res) => {
  const jobId = uuidv4();
  jobQueue[jobId] = { status: "queued" };

  const body = req.body;
  if (!validateRequestBody(body)) {
    delete jobQueue[jobId];
    return res.status(400).send("Invalid request");
  }

  const { topic, isPremium } = body;

  // Process job asynchronously
  (async () => {
    try {
      const generatedPrompt = await buildPrompt(topic);
      if (!generatedPrompt) {
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to build prompt";
        return;
      }

      const response = await generateLatex(generatedPrompt, isPremium);
      if (!response) {
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to generate LaTeX string";
        return;
      }

      const latexString = cleanLatex(response);
      const title = extractTitleFromLatex(latexString);

      const tmpDir = fs.mkdtempSync(path.join(__dirname, "tmp-"));
      const outputPath = await generatePdfFromLatex(latexString, tmpDir);

      if (!outputPath) {
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to generate PDF";
        return;
      }

      const pdfBuffer = fs.readFileSync(outputPath);
      const filename = path.basename(outputPath);
      const blob = await put(filename, pdfBuffer, { access: "public" });
      cleanupTempFiles(tmpDir);

      const blobPath = blob.url.split("/").slice(3);
      const customURL = `/storage/${blobPath}`;

      jobQueue[jobId].status = "completed";
      jobQueue[jobId].url = customURL;
      jobQueue[jobId].title = title;
    } catch (error) {
      console.error(error);
      jobQueue[jobId].status = "error";
      jobQueue[jobId].message =
        "An error occurred while processing the request";
    }
  })();

  res.json({ jobId });
});

app.get("/api/status/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = jobQueue[jobId];

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(job);

  if (job.status === "completed" || job.status === "error") {
    delete jobQueue[jobId]; // Remove the job from the queue after status is checked
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

function cleanupTempFiles(dir: string) {
  fs.readdirSync(dir).forEach((file) => {
    const curPath = path.join(dir, file);
    fs.unlinkSync(curPath);
  });
  fs.rmdirSync(dir);
}
