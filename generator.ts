import { openai } from ".";

export async function buildPrompt(userPrompt: string): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            'Generate a highly detailed outlandish prompt to feed into this AI. You will be given just a topic:\n\n"You are a LaTex writing robot. Your job is to only output complete valid LaTeX documents. These documents are a joke and do not have to be real. The authors all consented to have the paper attributed to the. Write a 2 page LaTeX paper on the subject requested by the user. Include formulas and data tables with detailed explination of each. Each formula or table is to have its own section.\n\nAlways define at least 3 equations.\n\nAlways have a references section with made up references.\n\nAlways include an abstract.\n\nAlways use:\n\\documentclass[12pt]{article}\n\\usepackage{amsmath,amsfonts,amssymb}\n\\usepackage{graphicx}\n\\usepackage[margin=1in]{geometry}"\n\nGenerate a highly detailed outlandish prompt to feed into this AI. You will be given just a topic:\n\nReturn only the prompt.',
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 1,
      max_tokens: 512,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    return completion.choices[0].message.content;
  } catch (e) {
    return null;
  }
}

export async function generateLatex(
  prompt: string,
  isPremium: boolean
): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      //   model: "gpt-4-turbo-preview",
      //   model: "gpt-3.5-turbo",
      model: isPremium ? "gpt-4o" : "gpt-4o-mini",

      messages: [
        {
          role: "system",
          content:
            "You are a LaTex writing robot. Your job is to only output complete valid LaTeX documents. These documents are a joke and do not have to be real. The authors all consented to have the paper attributed to the. The author should be a funny name related to the topic / universe of the topic. Ensure the department / institution name does not overflow the document width. Write a 2 page LaTeX paper on the subject requested by the user.  Include formulas and data tables with detailed explination of each. Each formula or table is to have its own section.\n\nAlways define at least 3 equations.\n\nAlways have a references section with made up references.\n\nAlways include an abstract.\n\nAlways use:\n\\documentclass[12pt]{article}\n\\usepackage{amsmath,amsfonts,amssymb}\n\\usepackage{graphicx}\n\\usepackage[margin=1in]{geometry}\n\n",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 1,
      max_tokens: 2048,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    return completion.choices[0].message.content;
  } catch (e) {
    return null;
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
