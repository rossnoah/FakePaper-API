import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { generateText, LanguageModelV1 } from "ai";

export class Generator {
  private model: LanguageModelV1;
  constructor(provider: string, model: string) {
    if (provider === "openai") {
      this.model = openai(model);
    } else if (provider === "google") {
      this.model = google(model);
    } else {
      throw new Error("Invalid provider");
    }
  }
  async buildPrompt(userPrompt: string): Promise<string | null> {
    const { text } = await generateText({
      model: this.model,
      system:
        'Generate a highly detailed subtly ridiculous satire prompt to feed into this AI. You will be given just a topic:\n\n"You are a LaTex writing robot. Your job is to only output complete valid LaTeX documents. These documents are a joke and do not have to be real. The authors all consented to have the paper attributed to the. Write a 2 page LaTeX paper on the subject requested by the user. Include formulas and data tables with detailed explination of each. Each formula or table is to have its own section.\n\nAlways define at least 3 equations.\n\nAlways have a references section with made up references.\n\nAlways include an abstract.\n\nAlways use:\n\\documentclass[12pt]{article}\n\\usepackage{amsmath,amsfonts,amssymb}\n\\usepackage{graphicx}\n\\usepackage[margin=1in]{geometry}"\n\nGenerate a highly detailed outlandish prompt to feed into this AI. You will be given just a topic:\n\nReturn only the prompt.',
      prompt: userPrompt,
      temperature: 1,
      maxTokens: 512,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });

    return text;
  }

  async generateLatex(
    prompt: string,
    isPremium: boolean
  ): Promise<string | null> {
    try {
      const { text } = await generateText({
        model: this.model,
        system:
          "You are a LaTex writing robot. Your job is to only output complete valid LaTeX documents. Write a subtly ridiculous satire. These documents are a joke and do not have to be real. The authors all consented to have the paper attributed to the. The author should be a funny name related to the topic / universe of the topic. Ensure the department / institution name does not overflow the document width. Ensure the table do not overflow the page width. Write a 2 page LaTeX paper on the subject requested by the user.  Include formulas and data tables with detailed explanation of each. Each formula or table is to have its own section.\n\nAlways define at least 3 equations.\n\nAlways have a references section with made up references.\n\nAlways include an abstract.\n\nAlways use:\n\\documentclass[12pt]{article}\n\\usepackage{amsmath,amsfonts,amssymb}\n\\usepackage{graphicx}\n\\usepackage[margin=1in]{geometry}\n\n",
        prompt: prompt,
        temperature: 1,
        maxTokens: 2048,
      });

      return text;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}

export function cleanLatex(latex: string): string {
  //check for starting with ```latex
  if (latex.startsWith("```latex")) {
    latex = latex.slice(8);
  }

  //check for ending with ```
  if (latex.endsWith("```")) {
    latex = latex.slice(0, -3);
  }

  return latex;
}
