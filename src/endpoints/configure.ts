import { type Request, type Response } from "express";
import { getAllResolvers } from "../utils/resolvers.ts";
import type { ConfigField } from "../userConfig/userConfig.ts";

const globalConfig: ConfigField[] = [
  {
    key: "sortOrder",
    type: "text" as const,
    title: "Zoradenie výsledkov",
    default: "default",
  },
  {
    key: "disableGlobalSearch",
    type: "text" as const,
    title: "Skryť z globálneho vyhľadávania (false/true)",
    default: "false",
  },
];

function renderFields(): string {
  const allResolvers = getAllResolvers();
  const resolverFields = allResolvers.flatMap((r) => {
    const fields = r.getConfigFields();
    if (fields.length === 0) return [];
    return [
      `<div class="section-title">${r.resolverName}</div>`,
      ...fields.map(renderField),
    ];
  });
  const globalFields = [
    `<div class="section-title">Globální nastavení</div>`,
    ...globalConfig.map(renderField),
  ];

  return [...resolverFields, ...globalFields].join("\n");
}

function renderField(field: ConfigField): string {
  const label = `<label for="${field.key}">${field.title}</label>`;

  if (field.type === "password") {
    return `<div class="field">${label}<input type="password" name="${field.key}" id="${field.key}" placeholder="${field.title}" spellcheck="false"></div>`;
  }

  // sortOrder -> select
  if (field.key === "sortOrder") {
    return `<div class="field"><label for="${field.key}">Řazení výsledků</label>
<select name="${field.key}" id="${field.key}">
  <option value="default">Výchozí</option>
  <option value="size">Podle velikosti (největší)</option>
  <option value="quality">Podle kvality (nejlepší)</option>
</select></div>`;
  }

  // disableGlobalSearch -> checkbox
  if (field.key === "disableGlobalSearch") {
    return `<div class="field checkbox-wrap"><input type="checkbox" name="disableGlobalSearch" id="disableGlobalSearch" value="true"><label for="disableGlobalSearch">Skrýt výsledky z globálního vyhledávání</label></div>`;
  }

  // select type — render as dropdown
  if (field.type === "select" && field.options?.length) {
    const options = field.options
      .map(
        (opt) =>
          `<option value="${opt.key}"${
            opt.key === field.default ? " selected" : ""
          }>${opt.value}</option>`,
      )
      .join("\n      ");
    return `<div class="field"><label for="${field.key}">${field.title}</label>\n<select name="${field.key}" id="${field.key}">\n      ${options}\n    </select></div>`;
  }

  // text type — render as text input
  return `<div class="field">${label}<input type="text" name="${field.key}" id="${field.key}" placeholder="${field.default || field.title}" spellcheck="false"></div>`;
}

const HTML = (fieldsHtml: string) => `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CZ Streams — Nastavení</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f0f1a;
    color: #e0e0e0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  .card {
    background: #1a1a2e;
    border-radius: 16px;
    padding: 32px;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 8px;
    color: #fff;
  }
  p.sub {
    font-size: 14px;
    color: #888;
    margin-bottom: 24px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6c63ff;
    margin-top: 20px;
    margin-bottom: 10px;
  }
  .section-title:first-child {
    margin-top: 0;
  }
  .field {
    margin-bottom: 16px;
  }
  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 5px;
    color: #aaa;
  }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #333;
    border-radius: 10px;
    background: #12122a;
    color: #e0e0e0;
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s;
  }
  input[type="text"]:focus, input[type="password"]:focus {
    border-color: #6c63ff;
  }
  .checkbox-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
  }
  .checkbox-wrap input[type="checkbox"] {
    width: 20px;
    height: 20px;
    accent-color: #6c63ff;
  }
  .checkbox-wrap label {
    margin: 0;
    cursor: pointer;
  }
  button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 10px;
    background: #6c63ff;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    margin-top: 20px;
  }
  button:hover { background: #5b52e0; }
  .hint {
    font-size: 12px;
    color: #666;
    margin-top: 4px;
  }
</style>
</head>
<body>
<div class="card">
  <h1>⚙️ CZ Streams</h1>
  <p class="sub">Nastavení zdrojů a vyhledávání</p>

  <form method="GET" id="configForm">
    ${fieldsHtml}

    <button type="button" onclick="saveConfig()">Uložit a pokračovat</button>
  </form>
</div>

<script>
function saveConfig() {
  const form = document.getElementById('configForm');
  const data = {};
  const selects = form.querySelectorAll('select');
  for (const sel of selects) {
    data[sel.name] = sel.value;
  }
  const inputs = form.querySelectorAll('input');
  // Checkbox handling for disableGlobalSearch
  const cb = document.querySelector('[name="disableGlobalSearch"]');
  if (cb && cb.type === 'checkbox') {
    data['disableGlobalSearch'] = cb.checked ? 'true' : 'false';
  }
  for (const input of inputs) {
    if (input.type === 'checkbox') continue; // already handled
    if (input.value.trim()) {
      data[input.name] = input.value.trim();
    }
  }

  try {
    localStorage.setItem('cz-streams-config', JSON.stringify(data));
  } catch(e) {}
  window.location.href = 'stremio://';
}
</script>
</body>
</html>`;

export default function handler(_req: Request, res: Response) {
  const fieldsHtml = renderFields();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML(fieldsHtml));
}
