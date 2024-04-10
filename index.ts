import dotenv from "dotenv";
import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { put } from "@vercel/blob";
import generatorRoute from "./generatorRoute";
import cors from "cors";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

export const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is not set in .env file");
  process.exit(1);
}

export const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set in .env file");
  process.exit(1);
}

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set in .env file");
  process.exit(1);
}

export const EXTERNAL_SERVER = process.env.EXTERNAL_SERVER;
if (!EXTERNAL_SERVER) {
  console.error("EXTERNAL_SERVER is not set in .env file");
  process.exit(1);
}

app.use(cors());

app.get("/", (req: Request, res: Response) => {
  res.send("LaTeX to PDF API is running!");
});

app.use("/api", generatorRoute);

// middleware to confirm AUTH_TOKEN as bearer token
app.use((req: Request, res: Response, next) => {
  const token = req.headers.authorization;
  if (token === `Bearer ${AUTH_TOKEN}`) {
    next();
  } else {
    res.status(401).send("Unauthorized");
  }
});

app.use(bodyParser.text({ type: "text/plain" }));

app.post("/latex", async (req: Request, res: Response) => {
  const latexContent = req.body;

  if (!latexContent) {
    res.status(400).send("No LaTeX content provided.");
    return;
  }

  //extract the title from the latexContent
  //\title{The Comedy of Errors: Why Emacs Reigns Supreme Over Vim and Neovim}

  const titleRegex = /\\title{([^}]*)}/;

  const titleMatch = latexContent.match(titleRegex);
  let title = titleMatch ? titleMatch[1] : "";
  title = title.replace("//", " ");

  const uuid = uuidv4();

  const tmpDir = fs.mkdtempSync(path.join(__dirname, "tmp-"));
  const inputPath = path.join(tmpDir, `${uuid}.tex`);
  const outputPath = path.join(tmpDir, `${uuid}.pdf`);

  fs.writeFileSync(inputPath, latexContent);

  const latex = spawn("pdflatex", ["-output-directory", tmpDir, inputPath]);

  latex.on("exit", async (code) => {
    if (code !== 0) {
      cleanupTempFiles(tmpDir);
      res.status(500).send("Failed to compile LaTeX document.");
      return;
    }

    try {
      //   console.log("Uploading PDF to Vercel Blob...");
      //   console.log("outputPath:", outputPath);
      const pdfBuffer = fs.readFileSync(outputPath);
      //   console.log("PDF size:", pdfBuffer.length);
      const filename = path.basename(outputPath);
      //   console.log("PDF generated:", outputPath);
      const blob = await put(filename, pdfBuffer, {
        access: "public",
      });

      console.log("PDF uploaded to Vercel Blob:", blob.url);

      cleanupTempFiles(tmpDir);
      res.json({
        message: "PDF successfully generated and uploaded.",
        title: title,
        url: blob.url,
      });
    } catch (error) {
      cleanupTempFiles(tmpDir);
      res.status(500).send("Failed to upload PDF to Vercel Blob.");
    }
  });
});

function cleanupTempFiles(dir: string) {
  fs.readdirSync(dir).forEach((file) => {
    const curPath = path.join(dir, file);
    fs.unlinkSync(curPath);
  });
  fs.rmdirSync(dir);
}

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
