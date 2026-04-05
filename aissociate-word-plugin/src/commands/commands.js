/* global Office, Word */

const AISSOCIATE_BASE_URL = "https://aissociate.at";
const AISSOCIATE_ASK_ENDPOINT = "/api/public/v1/chat/ask";
const DEFAULT_API_KEY =
  "ck:2a4fb1fc-fdd8-477d-b353-602573944fdb:46a20ebd-abad-4a7d-b1ed-ec4ab8a535ac";

Office.onReady(() => {
  Office.actions.associate("askAboutSelection", askAboutSelection);
});

async function askAboutSelection(event) {
  const apiKey =
    localStorage.getItem("aissociate_api_key") || DEFAULT_API_KEY;

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

      const body = {
        question:
          `Legal text:\n"""\n${selectedText}\n"""\n\n` +
          "Provide a concise legal analysis: key risks, obligations, and notable clauses.",
        law: null,
        sub_law: null,
        file_context: [],
        file_query_type: "general",
      };

      const response = await fetch(
        AISSOCIATE_BASE_URL + AISSOCIATE_ASK_ENDPOINT,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      // Collect streamed SSE response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);
              // Only accumulate actual message text
              if (data.type === "message" && data.text) {
                fullResponse += data.text;
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      }

      if (!fullResponse && buffer) {
        try {
          const data = JSON.parse(buffer);
          fullResponse = data.text || buffer;
        } catch {
          fullResponse = buffer;
        }
      }

      if (fullResponse && selection.insertComment) {
        selection.insertComment(`[AI:ssociate] ${fullResponse}`);
        await context.sync();
      }

      event.completed();
    });
  } catch {
    event.completed();
  }
}
