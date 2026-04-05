/* global Office, Word */

(function () {
  "use strict";

  // ── AIssociate API config ─────────────────────────────────────────
  const AISSOCIATE_BASE_URL = "https://aissociate.at";
  const AISSOCIATE_ASK_ENDPOINT = "/api/public/v1/chat/ask";
  const DEFAULT_API_KEY =
    "ck:2a4fb1fc-fdd8-477d-b353-602573944fdb:46a20ebd-abad-4a7d-b1ed-ec4ab8a535ac";

  // ── State ─────────────────────────────────────────────────────────
  let currentSelection = "";
  let threadId = null;
  let isStreaming = false;

  // ── DOM refs ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Init ──────────────────────────────────────────────────────────
  Office.onReady(({ host }) => {
    if (host === Office.HostType.Word) {
      init();
    }
  });

  function init() {
    loadSettings();
    bindEvents();
    refreshSelection();
  }

  // ── Settings ──────────────────────────────────────────────────────
  function loadSettings() {
    $("api-key-input").value =
      localStorage.getItem("aissociate_api_key") || DEFAULT_API_KEY;
    $("language-select").value =
      localStorage.getItem("aissociate_language") || "auto";
  }

  function saveSettings() {
    const key = $("api-key-input").value.trim() || DEFAULT_API_KEY;
    const lang = $("language-select").value;
    localStorage.setItem("aissociate_api_key", key);
    localStorage.setItem("aissociate_language", lang);
    showStatus("settings-status", "Saved!", "success");
    $("settings-overlay").classList.add("hidden");
    updateSendButton();
  }

  function getApiKey() {
    return localStorage.getItem("aissociate_api_key") || DEFAULT_API_KEY;
  }

  // ── Events ────────────────────────────────────────────────────────
  function bindEvents() {
    // Settings
    $("settings-toggle").addEventListener("click", () => {
      $("settings-overlay").classList.remove("hidden");
    });
    $("settings-close").addEventListener("click", () => {
      $("settings-overlay").classList.add("hidden");
    });
    $("save-settings").addEventListener("click", saveSettings);
    $("toggle-key-vis").addEventListener("click", () => {
      const input = $("api-key-input");
      input.type = input.type === "password" ? "text" : "password";
    });

    // Selection
    $("grab-selection-btn").addEventListener("click", refreshSelection);

    // Chat input
    $("question-input").addEventListener("input", updateSendButton);
    $("question-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    $("send-btn").addEventListener("click", sendMessage);
  }

  // ── Selection ─────────────────────────────────────────────────────
  async function refreshSelection() {
    try {
      await Word.run(async (context) => {
        const selection = context.document.getSelection();
        selection.load("text");
        await context.sync();

        currentSelection = selection.text.trim();
        const preview = $("selection-preview");

        if (currentSelection) {
          const truncated =
            currentSelection.length > 300
              ? currentSelection.substring(0, 300) + "..."
              : currentSelection;
          preview.innerHTML = `<div class="selected-text">${escapeHtml(truncated)}</div>`;
        } else {
          preview.innerHTML =
            '<p class="placeholder">Highlight text in your document to get started.</p>';
        }
        updateSendButton();
      });
    } catch {
      $("selection-preview").innerHTML =
        '<p class="placeholder">Could not read selection.</p>';
    }
  }

  // ── Send message ──────────────────────────────────────────────────
  async function sendMessage() {
    if (isStreaming) return;

    const question = $("question-input").value.trim();
    if (!question) return;

    await refreshSelection();

    const legalArea = $("legal-area-select").value || null;
    const scope = $("scope-select").value || null;
    const language = localStorage.getItem("aissociate_language") || "auto";

    // Build the full question with context
    let fullQuestion = question;
    if (currentSelection) {
      const langNote =
        language !== "auto"
          ? ` Please respond in ${({ en: "English", de: "German", fr: "French" })[language] || language}.`
          : "";
      fullQuestion =
        `Regarding this legal text:\n"""\n${currentSelection}\n"""\n\n${question}${langNote}`;
    }

    // Add user message to chat
    addChatMessage("user", question);
    $("question-input").value = "";
    updateSendButton();

    // Create assistant message placeholder
    const assistantBubble = addChatMessage("assistant", "");
    const contentEl = assistantBubble.querySelector(".msg-text");
    const actionsEl = assistantBubble.querySelector(".msg-actions");

    isStreaming = true;
    setSendLoading(true);

    let fullResponse = "";

    try {
      const apiKey = getApiKey();
      const body = {
        question: fullQuestion,
        law: legalArea || null,
        sub_law: scope || null,
        file_context: [],
        file_query_type: "general",
      };
      if (threadId) body.thread_id = threadId;

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
        const errText = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${errText || "Request failed"}`);
      }

      // Parse SSE stream
      // Format: "id: ...\nevent: message|error\ndata: {json}\n\n"
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEventType = "message";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Track SSE event type
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const data = JSON.parse(dataStr);

              if (currentEventType === "error") {
                throw new Error(data.text || "API error");
              }

              // Extract thread_id from qa_metadata
              if (data.type === "qa_metadata" && data.meta?.qa_metadata?.thread_id) {
                threadId = data.meta.qa_metadata.thread_id;
              }

              // Only accumulate actual message text (type "message")
              if (data.type === "message" && data.text) {
                fullResponse += data.text;
                contentEl.textContent = fullResponse;
                scrollChatToBottom();
              }
            } catch (parseErr) {
              // Re-throw API errors
              if (parseErr.message && parseErr.message !== "API error") {
                if (currentEventType === "error") throw parseErr;
              }
            }

            // Reset event type after processing data
            currentEventType = "message";
          }
        }
      }

      // Handle any remaining buffer content
      if (!fullResponse && buffer) {
        try {
          const data = JSON.parse(buffer);
          fullResponse = data.text || buffer;
        } catch {
          fullResponse = buffer;
        }
        contentEl.textContent = fullResponse;
      }

      if (!fullResponse) {
        contentEl.textContent = "No response received.";
      } else {
        // Show approve/reject actions
        actionsEl.classList.remove("hidden");
        setupActions(actionsEl, fullResponse);
      }
    } catch (err) {
      contentEl.textContent = "Error: " + err.message;
      assistantBubble.classList.add("msg-error");
    } finally {
      isStreaming = false;
      setSendLoading(false);
      scrollChatToBottom();
    }
  }

  // ── Chat UI helpers ───────────────────────────────────────────────
  function addChatMessage(role, text) {
    const messages = $("chat-messages");

    // Remove welcome message if present
    const welcome = messages.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    const bubble = document.createElement("div");
    bubble.className = `msg msg-${role}`;

    if (role === "user") {
      bubble.innerHTML = `<div class="msg-content"><div class="msg-text">${escapeHtml(text)}</div></div>`;
    } else {
      bubble.innerHTML = `
        <div class="msg-content">
          <div class="msg-label">AI:ssociate</div>
          <div class="msg-text">${escapeHtml(text)}</div>
          <div class="msg-actions hidden">
            <button class="action-btn approve-btn" title="Apply suggestion to document">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Apply
            </button>
            <button class="action-btn reject-btn" title="Dismiss suggestion">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              Dismiss
            </button>
          </div>
        </div>`;
    }

    messages.appendChild(bubble);
    scrollChatToBottom();
    return bubble;
  }

  function setupActions(actionsEl, responseText) {
    const approveBtn = actionsEl.querySelector(".approve-btn");
    const rejectBtn = actionsEl.querySelector(".reject-btn");

    approveBtn.addEventListener("click", async () => {
      try {
        await applyToDocument(responseText);
        actionsEl.innerHTML =
          '<span class="action-status success">Applied to document</span>';
      } catch (err) {
        actionsEl.innerHTML =
          `<span class="action-status error">Failed: ${escapeHtml(err.message)}</span>`;
      }
    });

    rejectBtn.addEventListener("click", () => {
      actionsEl.innerHTML =
        '<span class="action-status dismissed">Dismissed</span>';
    });
  }

  async function applyToDocument(text) {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load("text");
      await context.sync();

      // Replace the selected text with the AI suggestion
      selection.insertText(text, Word.InsertLocation.replace);
      await context.sync();
    });
    // Refresh selection to show new text
    await refreshSelection();
  }

  function scrollChatToBottom() {
    const container = $("chat-messages");
    container.scrollTop = container.scrollHeight;
  }

  // ── UI state helpers ──────────────────────────────────────────────
  function updateSendButton() {
    const hasQuestion = $("question-input").value.trim().length > 0;
    $("send-btn").disabled = !hasQuestion || isStreaming;
  }

  function setSendLoading(loading) {
    $("send-btn").disabled = loading;
    $("question-input").disabled = loading;
    if (loading) {
      $("send-btn").classList.add("loading");
    } else {
      $("send-btn").classList.remove("loading");
    }
  }

  function showStatus(elementId, message, type) {
    const el = $(elementId);
    el.textContent = message;
    el.className = `status-msg ${type}`;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 4000);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
