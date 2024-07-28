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
  res.send("LaTeX to PDF API is running!");
});

app.get("/api/generate", (req, res) => {
  res.status(400).send("You must POST to /api/generate");
});

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

// Rate limiter to 2 requests per minute and 10 requests per 24 hours
const shortTermLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 15 minutes
  max: 2, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
});

const longTermLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10, // Limit each IP to 10 requests per windowMs
  message: "Too many requests from this IP, please try again after 24 hours",
});

app.use("/api/generate", shortTermLimiter);
app.use("/api/generate", longTermLimiter);

app.post("/api/generate", async (req, res) => {
  try {
    const body = req.body;
    if (!validateRequestBody(body)) {
      return res.status(400).send("Invalid request");
    }

    const { topic, isPremium } = body;

    if (isPremium) {
      return res.status(400).send("Premium requests are no longer supported");
    }

    const generatedPrompt = await buildPrompt(topic);
    if (!generatedPrompt) {
      return res
        .status(500)
        .send("An error occurred while building the prompt");
    }

    const response = await generateLatex(generatedPrompt, isPremium);
    if (!response) {
      return res
        .status(500)
        .send("An error occurred while generating LaTeX string");
    }

    const latexString = cleanLatex(response);
    const title = extractTitleFromLatex(latexString);

    const tmpDir = fs.mkdtempSync(path.join(__dirname, "tmp-"));
    const outputPath = await generatePdfFromLatex(latexString, tmpDir);

    if (!outputPath) {
      return res.status(500).send("An error occurred while generating PDF");
    }

    const pdfBuffer = fs.readFileSync(outputPath);
    const filename = path.basename(outputPath);
    const blob = await put(filename, pdfBuffer, { access: "public" });
    cleanupTempFiles(tmpDir);

    const blobPath = blob.url.split("/").slice(3);
    const customURL = `/storage/${blobPath}`;

    res.json({
      message: "PDF successfully generated and uploaded.",
      title: title,
      url: customURL,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .send(
        "An error occurred while processing the request: " +
          JSON.stringify(error)
      );
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
