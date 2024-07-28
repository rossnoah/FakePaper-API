import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import { buildPrompt, cleanLatex, generateLatex } from "./generator"; // Adjust the import path as needed
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { put } from "@vercel/blob";
import { spawn } from "child_process";
import OpenAI from "openai";
import { serve } from "@hono/node-server";

dotenv.config();

const app = new Hono();

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
  apiKey: OPENAI_API_KEY, // This can be omitted if it's the same as the key name
});

// Middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Authorization", "Content-Type"],
  })
); // Enable CORS for all routes

app.get("/", (c: Context) => c.text("LaTeX to PDF API is running!"));

app.get("/api/generate", async (c: Context) =>
  c.text("You must POST to /api/generate", 400)
);

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

app.post("/api/generate", async (c: Context) => {
  try {
    const body = await c.req.json();
    if (!validateRequestBody(body)) {
      return c.text("Invalid request", 400);
    }

    const { topic, isPremium } = body;

    if (isPremium) {
      return c.text("Premium requests are no longer supported");
    }

    const generatedPrompt = await buildPrompt(topic);
    if (!generatedPrompt) {
      return c.text("An error occurred while building the prompt", 500);
    }

    const response = await generateLatex(generatedPrompt, isPremium);
    if (!response) {
      return c.text("An error occurred while generating LaTeX string", 500);
    }

    const latexString = cleanLatex(response);
    const title = extractTitleFromLatex(latexString);

    const tmpDir = fs.mkdtempSync(path.join(__dirname, "tmp-"));
    const outputPath = await generatePdfFromLatex(latexString, tmpDir);

    if (!outputPath) {
      return c.text("An error occurred while generating PDF", 500);
    }

    const pdfBuffer = fs.readFileSync(outputPath);
    const filename = path.basename(outputPath);
    const blob = await put(filename, pdfBuffer, { access: "public" });
    cleanupTempFiles(tmpDir);

    const blobPath = blob.url.split("/").slice(3);
    const customURL = SITE_URL + `/storage/${blobPath}`;

    return c.json({
      message: "PDF successfully generated and uploaded.",
      title: title,
      url: customURL,
    });
  } catch (error) {
    console.error(error);
    return c.text(
      "An error occurred while processing the request: " +
        JSON.stringify(error),
      500
    );
  }
});

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on port http://localhost:${PORT}`);

function cleanupTempFiles(dir: string) {
  fs.readdirSync(dir).forEach((file) => {
    const curPath = path.join(dir, file);
    fs.unlinkSync(curPath);
  });
  fs.rmdirSync(dir);
}
