/* global Office, Word */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────
  let currentSelection = "";
  let currentResponse = "";
  let history = [];

  // ── DOM refs ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Init ───────────────────────────────────────────────────────────
  Office.onReady(({ host }) => {
    if (host === Office.HostType.Word) {
      init();
    }
  });

  function init() {
    loadSettings();
    loadHistory();
    bindEvents();
    refreshSelection();
  }

  // ── Settings ───────────────────────────────────────────────────────
  function loadSettings() {
    $("api-url").value = localStorage.getItem("aissociate_api_url") || "";
    $("api-key").value = localStorage.getItem("aissociate_api_key") || "";
    $("language-select").value = localStorage.getItem("aissociate_language") || "auto";
  }

  function saveSettings() {
    const url = $("api-url").value.trim();
    const key = $("api-key").value.trim();
    const lang = $("language-select").value;

    if (!url) {
      showStatus("settings-status", "Please enter an API endpoint.", "error");
      return;
    }
    if (!key) {
      showStatus("settings-status", "Please enter an API key.", "error");
      return;
    }

    localStorage.setItem("aissociate_api_url", url);
    localStorage.setItem("aissociate_api_key", key);
    localStorage.setItem("aissociate_language", lang);
    showStatus("settings-status", "Settings saved.", "success");
    updateAskButton();
  }

  // ── Events ─────────────────────────────────────────────────────────
  function bindEvents() {
    // Settings toggle
    $("settings-toggle").addEventListener("click", () => {
      const panel = $("settings-panel");
      const expanded = !panel.classList.contains("collapsed");
      panel.classList.toggle("collapsed");
      $("settings-toggle").setAttribute("aria-expanded", !expanded);
    });

    $("save-settings").addEventListener("click", saveSettings);

    // Key visibility toggle
    $("toggle-key-visibility").addEventListener("click", () => {
      const input = $("api-key");
      input.type = input.type === "password" ? "text" : "password";
    });

    // Grab selection
    $("grab-selection-btn").addEventListener("click", refreshSelection);

    // Ask button
    $("ask-btn").addEventListener("click", askQuestion);

    // Insert as comment
    $("insert-comment-btn").addEventListener("click", insertComment);

    // Copy response
    $("copy-response-btn").addEventListener("click", copyResponse);

    // Clear history
    $("clear-history-btn").addEventListener("click", clearHistory);

    // Enable ask button when typing
    $("question-input").addEventListener("input", updateAskButton);
  }

  // ── Selection ──────────────────────────────────────────────────────
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
            currentSelection.length > 500
              ? currentSelection.substring(0, 500) + "..."
              : currentSelection;
          preview.innerHTML = `<div class="selected-text">${escapeHtml(truncated)}</div>`;
        } else {
          preview.innerHTML = '<p class="placeholder">Select text in your document to get started.</p>';
        }
        updateAskButton();
      });
    } catch {
      $("selection-preview").innerHTML =
        '<p class="placeholder">Could not read selection. Try again.</p>';
    }
  }

  // ── Ask AI ─────────────────────────────────────────────────────────
  async function askQuestion() {
    const apiUrl = localStorage.getItem("aissociate_api_url");
    const apiKey = localStorage.getItem("aissociate_api_key");
    const language = localStorage.getItem("aissociate_language") || "auto";

    if (!apiUrl || !apiKey) {
      // Auto-expand settings
      $("settings-panel").classList.remove("collapsed");
      showStatus("settings-status", "Please configure API settings first.", "error");
      return;
    }

    // Re-grab selection in case it changed
    await refreshSelection();

    if (!currentSelection) {
      showStatus("comment-status", "Please select text in your document first.", "error");
      return;
    }

    const question = $("question-input").value.trim();
    if (!question) return;

    setLoading(true);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          question: question,
          context: currentSelection,
          source: "word-plugin",
          options: {
            language: language,
            detail_level: "detailed",
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `API error ${response.status}${errorBody ? ": " + errorBody : ""}`
        );
      }

      const data = await response.json();
      currentResponse = data.answer || data.response || data.text || JSON.stringify(data, null, 2);

      // Show response
      $("response-content").textContent = currentResponse;
      $("response-panel").classList.remove("hidden");
      $("comment-status").classList.add("hidden");

      // Add to history
      addToHistory(question, currentResponse);
    } catch (err) {
      $("response-content").textContent = "Error: " + err.message;
      $("response-panel").classList.remove("hidden");
      currentResponse = "";
    } finally {
      setLoading(false);
    }
  }

  // ── Insert comment ─────────────────────────────────────────────────
  async function insertComment() {
    if (!currentResponse) return;

    try {
      await Word.run(async (context) => {
        const selection = context.document.getSelection();
        selection.load("text");
        await context.sync();

        const commentText = `[AI:ssociate] ${currentResponse}`;

        // Word JS API 1.4+ supports insertComment
        if (selection.insertComment) {
          selection.insertComment(commentText);
          await context.sync();
          showStatus("comment-status", "Comment inserted successfully.", "success");
        } else {
          // Fallback: copy to clipboard with instruction
          await navigator.clipboard.writeText(commentText);
          showStatus(
            "comment-status",
            "Your Word version doesn't support programmatic comments. Response copied to clipboard — paste it as a comment manually (Ctrl+Alt+M).",
            "error"
          );
        }
      });
    } catch (err) {
      showStatus("comment-status", "Failed to insert comment: " + err.message, "error");
    }
  }

  // ── Copy ───────────────────────────────────────────────────────────
  async function copyResponse() {
    if (!currentResponse) return;
    try {
      await navigator.clipboard.writeText(currentResponse);
      const btn = $("copy-response-btn");
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = currentResponse;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  // ── History ────────────────────────────────────────────────────────
  function loadHistory() {
    try {
      history = JSON.parse(localStorage.getItem("aissociate_history") || "[]");
    } catch {
      history = [];
    }
    renderHistory();
  }

  function addToHistory(question, answer) {
    history.unshift({
      question,
      answer,
      timestamp: new Date().toISOString(),
    });
    // Keep last 50
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem("aissociate_history", JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const list = $("history-list");
    const panel = $("history-panel");

    if (history.length === 0) {
      panel.classList.add("hidden");
      return;
    }

    panel.classList.remove("hidden");
    list.innerHTML = history
      .map(
        (item, i) =>
          `<li data-index="${i}">
            <div class="history-q">${escapeHtml(item.question)}</div>
            <div class="history-a">${escapeHtml(item.answer)}</div>
          </li>`
      )
      .join("");

    // Click to restore
    list.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        const idx = parseInt(li.dataset.index, 10);
        const item = history[idx];
        if (item) {
          $("question-input").value = item.question;
          currentResponse = item.answer;
          $("response-content").textContent = item.answer;
          $("response-panel").classList.remove("hidden");
        }
      });
    });
  }

  function clearHistory() {
    history = [];
    localStorage.removeItem("aissociate_history");
    renderHistory();
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function updateAskButton() {
    const hasSettings =
      localStorage.getItem("aissociate_api_url") &&
      localStorage.getItem("aissociate_api_key");
    const hasQuestion = $("question-input").value.trim().length > 0;
    $("ask-btn").disabled = !(hasSettings && hasQuestion);
  }

  function setLoading(loading) {
    $("ask-btn").disabled = loading;
    $("ask-btn-text").textContent = loading ? "Thinking..." : "Ask AI:ssociate";
    $("ask-spinner").classList.toggle("hidden", !loading);
    $("question-input").disabled = loading;
  }

  function showStatus(elementId, message, type) {
    const el = $(elementId);
    el.textContent = message;
    el.className = `status-msg ${type}`;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 5000);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
