/* global Office, Word */

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const LEGAL_SYSTEM_PROMPT =
  "You are AI:ssociate, an expert legal AI assistant. " +
  "Provide concise legal analysis suitable for a Word comment (no markdown). " +
  "Identify key risks, obligations, and notable clauses.";

Office.onReady(() => {
  Office.actions.associate("askAboutSelection", askAboutSelection);
});

async function askAboutSelection(event) {
  const apiKey = localStorage.getItem("aissociate_api_key") || "";
  const apiUrl = localStorage.getItem("aissociate_api_url") || OPENAI_ENDPOINT;
  const model = localStorage.getItem("aissociate_model") || "gpt-4o";

  if (!apiKey) {
    event.completed();
    return;
  }

  try {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load("text");
      await context.sync();

      const selectedText = selection.text.trim();
      if (!selectedText) {
        event.completed();
        return;
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: LEGAL_SYSTEM_PROMPT },
            {
              role: "user",
              content:
                `Legal text:\n"""\n${selectedText}\n"""\n\n` +
                "Provide a concise legal analysis: key risks, obligations, and notable clauses.",
            },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      const answer =
        data?.choices?.[0]?.message?.content?.trim() || "No response received.";

      if (selection.insertComment) {
        selection.insertComment(`[AI:ssociate] ${answer}`);
        await context.sync();
      }

      event.completed();
    });
  } catch {
    event.completed();
  }
}
