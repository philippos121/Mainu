/* global Office, Word */

Office.onReady(() => {
  Office.actions.associate("askAboutSelection", askAboutSelection);
});

async function askAboutSelection(event) {
  const apiUrl = localStorage.getItem("aissociate_api_url") || "";
  const apiKey = localStorage.getItem("aissociate_api_key") || "";

  if (!apiUrl || !apiKey) {
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

      const question =
        "Analyze this legal text and provide a brief summary of key legal implications, risks, and notable clauses.";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          question,
          context: selectedText,
          source: "word-plugin-ribbon",
          options: { language: "auto", detail_level: "concise" },
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      const answer =
        data.answer || data.response || data.text || "No response received.";

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
