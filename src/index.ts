import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { cleanLatex, Generator } from "./generator";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
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

const generator = new Generator("openai", "gpt-4.1-mini");

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

async function generatePdfFromLatex(
  latexString: string,
  tmpDir: string
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const uuid = uuidv4();
    const inputPath = path.join(tmpDir, `${uuid}.tex`);
    const outputPath = path.join(tmpDir, `${uuid}.pdf`);

    try {
      // Write LaTeX content to file
      fs.writeFileSync(inputPath, latexString);

      // Run pdflatex twice to ensure references are properly resolved
      const runPdfLatex = (attempt = 1) => {
        console.log(`Running pdflatex attempt ${attempt} for ${uuid}`);

        const command = `pdflatex -interaction=nonstopmode -halt-on-error -output-directory="${tmpDir}" "${inputPath}"`;

        exec(
          command,
          { maxBuffer: 1024 * 1024 * 10 },
          (error, stdout, stderr) => {
            if (error) {
              console.error(`LaTeX compilation failed on attempt ${attempt}:`);
              console.error(stderr || stdout);

              if (attempt === 1) {
                // Try to fix common LaTeX errors
                let fixedLatex = latexString;
                // Add missing packages that are commonly needed
                if (!fixedLatex.includes("\\usepackage{amsmath}")) {
                  fixedLatex = fixedLatex.replace(
                    "\\begin{document}",
                    "\\usepackage{amsmath}\n\\begin{document}"
                  );
                }
                // Try again with fixed LaTeX
                fs.writeFileSync(inputPath, fixedLatex);
                runPdfLatex(2);
              } else {
                reject(`Failed to compile LaTeX document: ${error.message}`);
              }
              return;
            }

            if (attempt === 1) {
              // Run second pass to resolve references
              runPdfLatex(2);
            } else {
              // Check if PDF was actually created
              if (fs.existsSync(outputPath)) {
                resolve(outputPath);
              } else {
                // Sometimes pdflatex doesn't return an error code even when it fails
                console.error(
                  "PDF file was not created despite successful compilation"
                );
                console.log("LaTeX output:", stdout);
                reject(
                  "PDF file was not created despite successful compilation"
                );
              }
            }
          }
        );
      };

      runPdfLatex();
    } catch (error) {
      console.error("Error in LaTeX generation:", error);
      reject(`Error in LaTeX generation: ${error}`);
      return null;
    }
  });
}

function extractTitleFromLatex(latexString: string): string {
  // Try to extract title with different patterns
  const titlePatterns = [
    /\\title{([^}]*)}/,
    /\\section{([^}]*)}/,
    /\\chapter{([^}]*)}/,
    /\\documentclass[\s\S]*?\n[\s\S]*?\n([\s\S]*?)\\begin/,
  ];

  for (const pattern of titlePatterns) {
    const match = latexString.match(pattern);
    if (match && match[1]) {
      // Clean up the title
      let title = match[1].trim();
      title = title.replace(/\\\\|\\newline|\\linebreak/g, " ");
      title = title.replace(/\s+/g, " ");
      // Remove any remaining LaTeX commands
      title = title.replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, "");
      return title || "Untitled";
    }
  }

  return "Untitled";
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
    let tmpDir = null;

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

      // Create temporary directory with more unique name
      tmpDir = fs.mkdtempSync(
        path.join(__dirname, `tmp-${jobId.substring(0, 8)}-`)
      );

      console.log(`Generating PDF for jobId: ${jobId} in directory ${tmpDir}`);

      const outputPath = await generatePdfFromLatex(latexString, tmpDir);

      if (!outputPath) {
        console.log(`Failed to generate PDF for jobId: ${jobId}`);
        jobQueue[jobId].status = "error";
        jobQueue[jobId].message = "Failed to generate PDF";
        return;
      }

      const pdfBuffer = fs.readFileSync(outputPath);

      // Create a more descriptive filename
      const sanitizedTitle = title
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .substring(0, 50);
      const filename = `${sanitizedTitle}-${jobId.substring(0, 8)}.pdf`;

      console.log(`Uploading PDF with filename: ${filename}`);
      const url = await storageService.uploadFile(filename, pdfBuffer);

      jobQueue[jobId].status = "completed";
      jobQueue[jobId].url = url;
      jobQueue[jobId].title = title;
      console.log(`Job completed successfully for jobId: ${jobId}`);
    } catch (error) {
      console.error(`Error processing jobId: ${jobId}`, error);
      jobQueue[jobId].status = "error";
      jobQueue[jobId].message =
        error instanceof Error
          ? `Error: ${error.message}`
          : "An error occurred while processing the request";
    } finally {
      // Clean up temporary directory if it was created
      if (tmpDir) {
        cleanupTempFiles(tmpDir);
      }
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
    // Set a short timeout to ensure the client has time to receive the response
    setTimeout(() => {
      delete jobQueue[jobId]; // Remove the job from the queue after status is checked
    }, 5000);
  }
});

function cleanupTempFiles(dir: string) {
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        try {
          const curPath = path.join(dir, file);
          fs.unlinkSync(curPath);
        } catch (err) {
          console.error(`Failed to delete file ${file}:`, err);
        }
      });
      fs.rmdirSync(dir);
      console.log(`Successfully cleaned up directory: ${dir}`);
    }
  } catch (err) {
    console.error(`Error cleaning up directory ${dir}:`, err);
  }
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
