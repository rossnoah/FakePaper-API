import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { cleanLatex, Generator } from "./generator"; // Adjust the import path as needed
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
import rateLimit from "express-rate-limit";
import { IStorageService } from "./storage/storage";
import { S3StorageService } from "./storage/s3aws";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const PORT = (process.env.PORT as unknown as number) || 3000;

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const GOOGLE_GENERATIVE_AI_API_KEY =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!AUTH_TOKEN || (!OPENAI_API_KEY && !GOOGLE_GENERATIVE_AI_API_KEY)) {
  console.error("One or more environment variables are not set in .env file");
  process.exit(1);
}

const generator = new Generator("google", "gemini-2.0-flash-001");

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
  console.log("Received request at /");
  res.json({ status: "ok", message: "Generation API is running!" });
});

app.get("/api/generate", (req, res) => {
  console.log("Received GET request at /api/generate");
  res.status(400).send("You must POST to /api/generate");
});

// Job Queue
const jobQueue: { [key: string]: any } = {};
const JOB_TIMEOUT = 60000; // 60 seconds

// Instantiate the Vercel Blob Storage service
const storageService: IStorageService = new S3StorageService();

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

// Rate limiter to 2 requests per minute and 20 requests per 24 hours
const shortTermLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 2,
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
  jobQueue[jobId] = { status: "queued", timestamp: Date.now() };

  console.log(`Received POST request at /api/generate with jobId: ${jobId}`);

  const body = req.body;
  if (!validateRequestBody(body)) {
    console.log(`Invalid request body for jobId: ${jobId}`);
    delete jobQueue[jobId];
    return res.status(400).send("Invalid request");
  }

  const { topic, isPremium } = body;

  // Process job asynchronously
  (async () => {
    try {
      console.log(`Building prompt for jobId: ${jobId}`);
      const generatedPrompt = await generator.buildPrompt(topic);
      if (!generatedPrompt) {
        console.log(`Failed to build prompt for jobId: ${jobId}`);
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to build prompt";
        return;
      }

      console.log(`Generating LaTeX for jobId: ${jobId}`);
      const response = await generator.generateLatex(
        generatedPrompt,
        isPremium
      );
      if (!response) {
        console.log(`Failed to generate LaTeX string for jobId: ${jobId}`);
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to generate LaTeX string";
        return;
      }

      const latexString = cleanLatex(response);
      const title = extractTitleFromLatex(latexString);

      const tmpDir = fs.mkdtempSync(path.join(__dirname, "tmp-"));
      console.log(`Generating PDF for jobId: ${jobId}`);
      const outputPath = await generatePdfFromLatex(latexString, tmpDir);

      if (!outputPath) {
        console.log(`Failed to generate PDF for jobId: ${jobId}`);
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to generate PDF";
        return;
      }

      const pdfBuffer = fs.readFileSync(outputPath);
      const filename = path.basename(outputPath);
      const url = await storageService.uploadFile(filename, pdfBuffer);

      cleanupTempFiles(tmpDir);

      jobQueue[jobId].status = "completed";
      jobQueue[jobId].url = url;
      jobQueue[jobId].title = title;
      console.log(`Job completed successfully for jobId: ${jobId}`);
    } catch (error) {
      console.error(`Error processing jobId: ${jobId}`, error);
      jobQueue[jobId].status = "error";
      jobQueue[jobId].message =
        "An error occurred while processing the request";
    }
  })();

  res.json({ jobId });
});

app.get("/api/status/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  console.log(`Received status request for jobId: ${jobId}`);
  const job = jobQueue[jobId];

  if (!job) {
    console.log(`Job not found for jobId: ${jobId}`);
    return res.status(404).json({ error: "Job not found" });
  }

  jobQueue[jobId].timestamp = Date.now(); // Update timestamp on access
  res.json(job);

  if (job.status === "completed" || job.status === "error") {
    console.log(`Cleaning up jobId: ${jobId}`);
    delete jobQueue[jobId]; // Remove the job from the queue after status is checked
  }
});

function cleanupTempFiles(dir: string) {
  fs.readdirSync(dir).forEach((file) => {
    const curPath = path.join(dir, file);
    fs.unlinkSync(curPath);
  });
  fs.rmdirSync(dir);
}

// Function to clean up abandoned jobs
function cleanUpAbandonedJobs() {
  const now = Date.now();
  Object.keys(jobQueue).forEach((jobId) => {
    const job = jobQueue[jobId];
    if (now - job.timestamp > JOB_TIMEOUT) {
      console.log(`Job ${jobId} abandoned and removed from queue`);
      delete jobQueue[jobId];
    }
  });
}

// Run cleanup function at regular intervals
setInterval(cleanUpAbandonedJobs, 60000); // Every 60 seconds

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
