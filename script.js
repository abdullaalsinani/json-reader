const inputEl = document.getElementById("jsonInput");
const outputEl = document.getElementById("jsonOutput");
const treeEl = document.getElementById("treeOutput");
const statusEl = document.getElementById("status");
const extractInputEl = document.getElementById("extractInput");
const extractOutputEl = document.getElementById("extractOutput");
const extractSummaryEl = document.getElementById("extractSummary");
const extractCountEl = document.getElementById("extractCount");

const formatBtn = document.getElementById("formatBtn");
const minifyBtn = document.getElementById("minifyBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const extractBtn = document.getElementById("extractBtn");
const copyExtractBtn = document.getElementById("copyExtractBtn");
const copySummaryBtn = document.getElementById("copySummaryBtn");

const paneClasses = ["input-pane", "output-pane", "hierarchy-pane", "extract-pane", "quick-pane"];

const INDENT = 2;
const MAX_HIGHLIGHT_CHARS = 200000;
const STORAGE_INPUT = "json-reader.input";
const STORAGE_EXTRACT = "json-reader.extract";
const STORAGE_PANES = "json-reader.panes";
const HIDE_ICON = "Icons/hide.svg";
const SHOW_ICON = "Icons/show.svg";

let currentParsed = null;
let currentPretty = "";
let currentOutputText = "";
let outputMode = "pretty";
let lastClearSnapshot = null;

const htmlEscapes = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (char) => htmlEscapes[char]);
}

function syntaxHighlight(jsonText) {
  const escaped = escapeHtml(jsonText);
  const tokenRegex =
    /(\"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\\"])*\"(?=\s*:))|(\"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\\"])*\")|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?|([{}\[\],:])/g;

  return escaped.replace(tokenRegex, (match, keyToken, stringToken, boolToken, puncToken) => {
    if (keyToken) {
      return `<span class="token-key">${match}</span>`;
    }
    if (stringToken) {
      return `<span class="token-string">${match}</span>`;
    }
    if (boolToken) {
      return `<span class="token-boolean">${match}</span>`;
    }
    if (match === "null") {
      return `<span class="token-null">${match}</span>`;
    }
    if (/^-?\d/.test(match)) {
      return `<span class="token-number">${match}</span>`;
    }
    if (puncToken) {
      return `<span class="token-punc">${match}</span>`;
    }
    return match;
  });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function paneLabel(paneClass) {
  if (paneClass === "input-pane") {
    return "input panel";
  }
  if (paneClass === "output-pane") {
    return "output panel";
  }
  if (paneClass === "hierarchy-pane") {
    return "hierarchy panel";
  }
  if (paneClass === "extract-pane") {
    return "extract panel";
  }
  return "quick list panel";
}

function savePaneStates() {
  const state = {};
  paneClasses.forEach((paneClass) => {
    const pane = document.querySelector(`.${paneClass}`);
    state[paneClass] = pane ? pane.classList.contains("pane-collapsed") : false;
  });
  localStorage.setItem(STORAGE_PANES, JSON.stringify(state));
}

function updatePaneToggleButton(pane, paneClass) {
  const toggle = pane.querySelector(".pane-toggle");
  if (!toggle) {
    return;
  }

  const isCollapsed = pane.classList.contains("pane-collapsed");
  const img = toggle.querySelector("img");
  if (img) {
    img.src = isCollapsed ? SHOW_ICON : HIDE_ICON;
  }
  const verb = isCollapsed ? "Show" : "Hide";
  const label = `${verb} ${paneLabel(paneClass)}`;
  toggle.title = label;
  toggle.setAttribute("aria-label", label);
}

function setPaneCollapsed(paneClass, collapsed, persist = true) {
  const pane = document.querySelector(`.${paneClass}`);
  if (!pane) {
    return;
  }

  pane.classList.toggle("pane-collapsed", collapsed);
  updatePaneToggleButton(pane, paneClass);
  if (persist) {
    savePaneStates();
  }
}

function restorePaneStates() {
  const saved = localStorage.getItem(STORAGE_PANES);
  if (!saved) {
    paneClasses.forEach((paneClass) => {
      setPaneCollapsed(paneClass, false, false);
    });
    savePaneStates();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    paneClasses.forEach((paneClass) => {
      setPaneCollapsed(paneClass, Boolean(parsed[paneClass]), false);
    });
    savePaneStates();
  } catch {
    paneClasses.forEach((paneClass) => {
      setPaneCollapsed(paneClass, false, false);
    });
    savePaneStates();
  }
}

function setExtractResult(content, summary, count = 0) {
  extractOutputEl.textContent = content;
  extractSummaryEl.textContent = summary;
  extractCountEl.textContent = `${count} match${count === 1 ? "" : "es"}`;
}

function formatPathSegment(parentPath, segment) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
    return `${parentPath}.${segment}`;
  }
  return `${parentPath}[${JSON.stringify(segment)}]`;
}

function primitiveType(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "string") {
    return "string";
  }
  return "number";
}

function formatPrimitive(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatBulletValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function pathLabel(pathText) {
  try {
    const tokens = tokenizePath(pathText);
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (tokens[i].type === "prop") {
        const key = tokens[i].key;
        return key.charAt(0).toUpperCase() + key.slice(1);
      }
    }
  } catch {
    return "Items";
  }
  return "Items";
}

function buildBulletSection(pathText, matches) {
  const label = pathLabel(pathText);

  if (matches.length === 1 && Array.isArray(matches[0].value)) {
    const values = matches[0].value;
    const lines = values.map((value) => `• ${formatBulletValue(value)}`);
    return `${label} (${values.length}):\n${lines.join("\n")}`;
  }

  const allPrimitive = matches.every(
    (match) => match.value === null || ["string", "number", "boolean"].includes(typeof match.value),
  );

  if (allPrimitive) {
    const lines = matches.map((match) => `• ${formatBulletValue(match.value)}`);
    return `${label} (${matches.length}):\n${lines.join("\n")}`;
  }

  return "";
}

function renderPrettyOutput(prettyText) {
  if (prettyText.length > MAX_HIGHLIGHT_CHARS) {
    outputEl.textContent = prettyText;
    return;
  }
  outputEl.innerHTML = syntaxHighlight(prettyText);
}

function makePathButton(path) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "path-btn";
  button.textContent = "path";
  button.dataset.path = path;
  return button;
}

function renderTreeNode(parentEl, value, path, keyLabel, depth) {
  const hasKey = keyLabel !== null;

  if (value === null || typeof value !== "object") {
    const row = document.createElement("div");
    row.className = "tree-leaf";

    if (hasKey) {
      const key = document.createElement("span");
      key.className = "tree-key";
      key.textContent = `${keyLabel}:`;
      row.appendChild(key);
    }

    const valueEl = document.createElement("span");
    valueEl.className = `tree-value ${primitiveType(value)}`;
    valueEl.textContent = formatPrimitive(value);
    row.appendChild(valueEl);
    row.appendChild(makePathButton(path));
    parentEl.appendChild(row);
    return;
  }

  const isArray = Array.isArray(value);
  const keys = isArray ? value : Object.keys(value);
  const details = document.createElement("details");
  details.className = "tree-branch";
  details.open = depth < 2;

  const summary = document.createElement("summary");
  summary.className = "tree-summary";

  if (hasKey) {
    const key = document.createElement("span");
    key.className = "tree-key";
    key.textContent = `${keyLabel}:`;
    summary.appendChild(key);
  }

  const type = document.createElement("span");
  type.className = "tree-meta";
  type.textContent = isArray ? `[${value.length}]` : `{${keys.length}}`;
  summary.appendChild(type);
  summary.appendChild(makePathButton(path));
  details.appendChild(summary);

  const children = document.createElement("div");
  children.className = "tree-children";

  if (isArray) {
    value.forEach((item, index) => {
      renderTreeNode(children, item, `${path}[${index}]`, `[${index}]`, depth + 1);
    });
  } else {
    Object.keys(value).forEach((key) => {
      const childPath = formatPathSegment(path, key);
      renderTreeNode(children, value[key], childPath, key, depth + 1);
    });
  }

  details.appendChild(children);
  parentEl.appendChild(details);
}

function renderTree(parsed) {
  treeEl.innerHTML = "";
  if (parsed === null) {
    treeEl.innerHTML = '<div class="tree-empty">Tree appears here after valid JSON.</div>';
    return;
  }
  renderTreeNode(treeEl, parsed, "$", null, 0);
}

function clearRender() {
  currentParsed = null;
  currentPretty = "";
  currentOutputText = "";
  outputEl.textContent = "";
  renderTree(null);
  setExtractResult("", "", 0);
}

function setRenderedOutput(parsed) {
  if (outputMode === "minified") {
    currentOutputText = JSON.stringify(parsed);
  } else {
    currentOutputText = currentPretty;
  }
  renderPrettyOutput(currentOutputText);
}

function positionToLineColumn(text, position) {
  const safePos = Math.max(0, Math.min(position, text.length));
  const before = text.slice(0, safePos);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function parseErrorMessage(error, text) {
  const message = String(error && error.message ? error.message : "Invalid JSON");
  const match = message.match(/position\s+(\d+)/i);
  if (!match) {
    return message;
  }
  const pos = Number(match[1]);
  if (!Number.isFinite(pos)) {
    return message;
  }
  const location = positionToLineColumn(text, pos);
  return `${message} (line ${location.line}, col ${location.column})`;
}

function normalizeExtractPath(pathText) {
  let text = pathText.trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("$")) {
    text = text.slice(1);
  }
  if (text.startsWith(".")) {
    text = text.slice(1);
  }
  return text;
}

function tokenizePath(pathText) {
  const path = normalizeExtractPath(pathText);
  if (!path) {
    return [];
  }

  const tokens = [];
  let i = 0;

  while (i < path.length) {
    const char = path[i];

    if (char === ".") {
      i += 1;
      continue;
    }

    if (char === "[") {
      const closeIndex = path.indexOf("]", i + 1);
      if (closeIndex === -1) {
        throw new Error("Invalid extract path: missing ]");
      }
      const inside = path.slice(i + 1, closeIndex).trim();
      if (inside === "*") {
        tokens.push({ type: "wildcard" });
      } else if (/^\d+$/.test(inside)) {
        tokens.push({ type: "index", index: Number(inside) });
      } else {
        throw new Error("Invalid extract path: use [number] or [*]");
      }
      i = closeIndex + 1;
      continue;
    }

    let start = i;
    while (i < path.length && /[A-Za-z0-9_$]/.test(path[i])) {
      i += 1;
    }
    if (start === i) {
      throw new Error("Invalid extract path token");
    }
    tokens.push({ type: "prop", key: path.slice(start, i) });
  }

  return tokens;
}

function applyExtractPath(source, pathText) {
  const tokens = tokenizePath(pathText);
  let nodes = [{ value: source, path: "$" }];

  for (const token of tokens) {
    const nextNodes = [];
    for (const node of nodes) {
      if (token.type === "prop") {
        if (node.value && typeof node.value === "object" && !Array.isArray(node.value) && Object.hasOwn(node.value, token.key)) {
          nextNodes.push({
            value: node.value[token.key],
            path: formatPathSegment(node.path, token.key),
          });
        }
      }

      if (token.type === "index") {
        if (Array.isArray(node.value) && token.index < node.value.length) {
          nextNodes.push({
            value: node.value[token.index],
            path: `${node.path}[${token.index}]`,
          });
        }
      }

      if (token.type === "wildcard") {
        if (Array.isArray(node.value)) {
          node.value.forEach((item, index) => {
            nextNodes.push({
              value: item,
              path: `${node.path}[${index}]`,
            });
          });
        }
      }
    }
    nodes = nextNodes;
  }

  return nodes;
}

function runExtract() {
  if (currentParsed === null) {
    setExtractResult("", "", 0);
    return;
  }

  const pathText = extractInputEl.value.trim();
  if (!pathText) {
    setExtractResult("", "", 0);
    return;
  }

  try {
    const matches = applyExtractPath(currentParsed, pathText);
    if (matches.length === 0) {
      setExtractResult("No matches", "", 0);
      return;
    }

    const renderedBase = matches
      .map((match) => `${match.path}\n${JSON.stringify(match.value, null, INDENT)}`)
      .join("\n\n");

    const bulletSection = buildBulletSection(pathText, matches);
    setExtractResult(renderedBase, bulletSection, matches.length);
  } catch (error) {
    setExtractResult(String(error.message || error), "", 0);
  }
}

function tryRender() {
  const text = inputEl.value;
  if (!text.trim()) {
    clearRender();
    setStatus("Ready");
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    currentParsed = parsed;
    currentPretty = JSON.stringify(parsed, null, INDENT);
    setRenderedOutput(parsed);
    renderTree(parsed);
    runExtract();
    setStatus("Valid JSON");
    return parsed;
  } catch (error) {
    clearRender();
    setStatus(parseErrorMessage(error, text), true);
    return null;
  }
}

function persistInput() {
  localStorage.setItem(STORAGE_INPUT, inputEl.value);
}

function formatInput() {
  const parsed = tryRender();
  if (parsed === null) {
    return;
  }
  outputMode = "pretty";
  inputEl.value = JSON.stringify(parsed, null, INDENT);
  persistInput();
  tryRender();
}

function minifyInput() {
  const parsed = tryRender();
  if (parsed === null) {
    return;
  }
  outputMode = "minified";
  inputEl.value = JSON.stringify(parsed);
  persistInput();
  tryRender();
  setStatus("Minified input and output");
}

function clearAll() {
  lastClearSnapshot = {
    input: inputEl.value,
    extract: extractInputEl.value,
    panes: paneClasses.reduce((acc, paneClass) => {
      const pane = document.querySelector(`.${paneClass}`);
      acc[paneClass] = pane ? pane.classList.contains("pane-collapsed") : false;
      return acc;
    }, {}),
  };

  inputEl.value = "";
  extractInputEl.value = "";
  outputMode = "pretty";
  localStorage.removeItem(STORAGE_INPUT);
  localStorage.removeItem(STORAGE_EXTRACT);
  clearRender();
  undoBtn.disabled = false;
  setStatus("Cleared");
  inputEl.focus();
}

function undoClear() {
  if (!lastClearSnapshot) {
    setStatus("Nothing to undo", true);
    return;
  }

  inputEl.value = lastClearSnapshot.input;
  extractInputEl.value = lastClearSnapshot.extract;
  localStorage.setItem(STORAGE_INPUT, inputEl.value);
  localStorage.setItem(STORAGE_EXTRACT, extractInputEl.value);

  paneClasses.forEach((paneClass) => {
    setPaneCollapsed(paneClass, Boolean(lastClearSnapshot.panes[paneClass]), false);
  });
  savePaneStates();

  tryRender();
  setStatus("Restore complete");
  lastClearSnapshot = null;
  undoBtn.disabled = true;
}

async function copyOutput() {
  if (!currentOutputText.trim()) {
    setStatus("Nothing to copy", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(currentOutputText);
    setStatus("Output copied");
  } catch {
    setStatus("Clipboard blocked by browser", true);
  }
}

async function copyExtractOutput() {
  if (!extractOutputEl.textContent.trim()) {
    setStatus("No extract result to copy", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(extractOutputEl.textContent);
    setStatus("Extract copied");
  } catch {
    setStatus("Clipboard blocked by browser", true);
  }
}

async function copySummaryOutput() {
  if (!extractSummaryEl.textContent.trim()) {
    setStatus("No quick list to copy", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(extractSummaryEl.textContent);
    setStatus("Quick list copied");
  } catch {
    setStatus("Clipboard blocked by browser", true);
  }
}

function handleKeyboardShortcuts(event) {
  const isMeta = event.ctrlKey || event.metaKey;
  if (!isMeta) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "enter") {
    event.preventDefault();
    formatInput();
    return;
  }

  if (key === "m" && event.shiftKey) {
    event.preventDefault();
    minifyInput();
    return;
  }

  if (key === "k") {
    event.preventDefault();
    clearAll();
  }
}

let debounceTimer;
inputEl.addEventListener("input", () => {
  persistInput();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(tryRender, 150);
});

extractInputEl.addEventListener("input", () => {
  localStorage.setItem(STORAGE_EXTRACT, extractInputEl.value);
  runExtract();
});

extractBtn.addEventListener("click", runExtract);
copyExtractBtn.addEventListener("click", copyExtractOutput);
copySummaryBtn.addEventListener("click", copySummaryOutput);

document.querySelectorAll(".pane-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const paneClass = button.dataset.pane;
    if (!paneClass) {
      return;
    }
    const pane = document.querySelector(`.${paneClass}`);
    if (!pane) {
      return;
    }
    setPaneCollapsed(paneClass, !pane.classList.contains("pane-collapsed"));
  });
});

treeEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains("path-btn")) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const path = target.dataset.path;
  if (!path) {
    return;
  }

  try {
    await navigator.clipboard.writeText(path);
    setStatus(`Path copied: ${path}`);
  } catch {
    setStatus("Clipboard blocked by browser", true);
  }
});

formatBtn.addEventListener("click", formatInput);
minifyBtn.addEventListener("click", minifyInput);
undoBtn.addEventListener("click", undoClear);
clearBtn.addEventListener("click", clearAll);
copyBtn.addEventListener("click", copyOutput);
document.addEventListener("keydown", handleKeyboardShortcuts);

const savedInput = localStorage.getItem(STORAGE_INPUT);
const savedExtract = localStorage.getItem(STORAGE_EXTRACT);

if (savedInput && savedInput.trim()) {
  inputEl.value = savedInput;
} else {
  inputEl.value =
    '{\n  "tags": ["api", "json", "reader"],\n  "results": [{"id": 1, "name": "Alpha"}, {"id": 2, "name": "Beta"}],\n  "active": true\n}';
}

if (savedExtract) {
  extractInputEl.value = savedExtract;
}

restorePaneStates();

tryRender();
