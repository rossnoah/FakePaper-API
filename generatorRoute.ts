// src/generatorRoute.ts

import express, { Request, Response } from "express";
import axios from "axios";
import { buildPrompt, cleanLatex, generateLatex } from "./generator"; // Adjust the import path as needed
import { AUTH_TOKEN, EXTERNAL_SERVER } from ".";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

interface GenerateRequestBody {
  topic: string;
  isPremium: boolean;
}

router.use(express.json());

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { topic, isPremium } = req.body as GenerateRequestBody;

    if (typeof topic !== "string" || typeof isPremium !== "boolean") {
      return res.status(400).send("Invalid request");
    }

    if (!topic) {
      return res.status(400).send("Missing topic");
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

    const latex = cleanLatex(response);

    // Send a POST request to worker.fakepaper.app/latex
    const workerResponse = await axios.post(`${EXTERNAL_SERVER}/latex`, latex, {
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
    });

    if (workerResponse.status !== 200) {
      return res.status(500).send("An error occurred in the worker");
    }

    res.json(workerResponse.data);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .send("An error occurred getting the LaTeX generation response");
  }
});

export default router;
