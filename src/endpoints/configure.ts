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
      `<div class="section-header"><span class="icon">📡</span> ${r.resolverName}</div>`,
      ...fields.map(renderField),
    ];
  });
  const globalFields = [
    `<div class="section-header"><span class="icon">⚙️</span> <span data-i18n="section.global">Globální nastavení</span></div>`,
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
    return `<div class="field"><label for="${field.key}" data-i18n="label.sort.order">Řazení výsledků</label>
<select name="${field.key}" id="${field.key}">
  <option value="default" data-i18n="sort.default">Výchozí</option>
  <option value="size" data-i18n="sort.size">Podle velikosti (největší)</option>
  <option value="quality" data-i18n="sort.quality">Podle kvality (nejlepší)</option>
</select></div>`;
  }

  // disableGlobalSearch -> checkbox
  if (field.key === "disableGlobalSearch") {
    return `<div class="checkbox-row"><input type="checkbox" name="disableGlobalSearch" id="disableGlobalSearch" value="true"><span class="label-text" data-i18n="label.disableGlobal">Skrýt výsledky z globálního vyhledávání</span></div>`;
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
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0d0a; color: #e0e0e0; display: flex; justify-content: center; padding: 30px 15px; }
  .container { background: #221310; padding: 0; border-radius: 12px; width: 100%; max-width: 500px; box-shadow: 0 8px 32px rgba(0,0,0,0.6); overflow: hidden; }
  .header { background: linear-gradient(135deg, #2f1210 0%, #1f0d0a 100%); padding: 24px; text-align: center; border-bottom: 1px solid #452a20; }
  .header h2 { font-size: 22px; font-weight: 700; background: linear-gradient(135deg, #e63946, #ff6b6b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .header p { font-size: 13px; color: #888; margin-top: 4px; }

  .section { border-bottom: 1px solid #452a20; }
  .section:last-child { border-bottom: none; }
  .section-header { display: flex; align-items: center; gap: 10px; padding: 16px 20px 8px; font-size: 13px; font-weight: 600; color: #e63946; text-transform: uppercase; letter-spacing: 0.5px; }
  .section-header .icon { font-size: 18px; }

  .field { padding: 8px 20px; }
  .field label { display: block; font-size: 12px; font-weight: 600; color: #aaa; margin-bottom: 4px; }
  .field input, .field select { width: 100%; padding: 10px 12px; background: #1a0d0b; border: 1px solid #452a20; color: #e0e0e0; border-radius: 8px; font-size: 14px; outline: none; transition: border 0.2s; }
  .field input:focus, .field select:focus { border-color: #e63946; }
  .field select { cursor: pointer; appearance: auto; }

  .checkbox-row { display: flex; align-items: center; gap: 10px; padding: 6px 20px; cursor: pointer; }
  .checkbox-row:hover { background: rgba(230,57,70,0.05); }
  .checkbox-row input[type="checkbox"] { width: 18px; height: 18px; accent-color: #e63946; cursor: pointer; }
  .checkbox-row .label-text { font-size: 14px; color: #ccc; }
  .checkbox-row .label-desc { font-size: 11px; color: #666; margin-left: auto; }

  .btn-primary { width: calc(100% - 40px); margin: 16px 20px; padding: 12px; background: linear-gradient(135deg, #e63946, #c1121f); color: white; border: none; font-size: 15px; font-weight: 600; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(230,57,70,0.4); }

  #result-box { display: none; margin: 0 20px 20px; padding: 20px; background: rgba(230,57,70,0.06); border: 1px solid #e63946; border-radius: 10px; text-align: center; }
  #result-box p { font-size: 12px; color: #e63946; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  #generated-url { width: 100%; font-size: 12px; font-family: 'Courier New', monospace; padding: 10px; margin-bottom: 14px; background: #1a0d0b; color: #e0e0e0; border: 1px solid #452a20; border-radius: 8px; word-break: break-all; resize: none; height: 52px; outline: none; transition: border 0.2s; }
  #generated-url:focus { border-color: #e63946; }
  .btn-sm { padding: 8px 16px; border: 1px solid #452a20; border-radius: 8px; font-size: 13px; cursor: pointer; margin: 3px; transition: all 0.2s; }
  .btn-copy { background: #1a0d0b; color: #ccc; }
  .btn-copy:hover { background: rgba(230,57,70,0.2); border-color: #e63946; color: #fff; }
  .btn-install { background: linear-gradient(135deg, #e63946, #c1121f); color: white; border: none; }
  .btn-install:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(230,57,70,0.4); }
  .lang-btn { background:none; border:1px solid #452a20; border-radius:6px; padding:4px 10px; font-size:13px; color:#ccc; cursor:pointer; transition:all 0.2s; }
  .lang-btn:hover { border-color: #e63946; }
  .lang-btn.active { border-color: #e63946; background: rgba(230,57,70,0.2); color:#f5d0cc; }
</style>
</head>
<body>
<script>
const I18N = {
  cs: {
    "title": "CZ Streams",
    "subtitle": "Nastavení zdrojů a vyhledávání",
    "section.global": "Globální nastavení",
    "label.sort.order": "Řazení výsledků",
    "sort.default": "Výchozí",
    "sort.size": "Podle velikosti (největší)",
    "sort.quality": "Podle kvality (nejlepší)",
    "label.disableGlobal": "Skrýt výsledky z globálního vyhledávání",
    "button.save": "Uložit a pokračovat",
    "result.title": "🔗 Tento odkaz přidej do Stremia",
    "btn.copy": "📋 Kopírovat",
    "btn.install": "⚡ Instalovat do Stremia",
  },
  en: {
    "title": "CZ Streams",
    "subtitle": "Configure your sources and search preferences",
    "section.global": "Global Settings",
    "label.sort.order": "Sort Order",
    "sort.default": "Default",
    "sort.size": "By size (largest)",
    "sort.quality": "By quality (best)",
    "label.disableGlobal": "Hide results from global search",
    "button.save": "Save & Continue",
    "result.title": "🔗 Add this link to Stremio",
    "btn.copy": "📋 Copy",
    "btn.install": "⚡ Install in Stremio",
  }
};
var CURR_LANG = "cs";
function setLang(lang) {
  if (!I18N[lang]) return;
  CURR_LANG = lang;
  document.querySelectorAll("[data-i18n]").forEach(function(el) {
    var key = el.getAttribute("data-i18n");
    if (I18N[lang][key]) el.textContent = I18N[lang][key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
    var key = el.getAttribute("data-i18n-placeholder");
    if (I18N[lang][key]) el.placeholder = I18N[lang][key];
  });
  document.querySelectorAll("[data-i18n-value]").forEach(function(el) {
    var key = el.getAttribute("data-i18n-value");
    if (I18N[lang][key]) el.value = I18N[lang][key];
  });
  document.querySelectorAll('.lang-btn').forEach(function(btn) {
    var lb = btn.getAttribute('data-lang-btn');
    btn.classList.toggle('active', lb === lang);
  });
}
</script>
<div class="container">
  <div class="header">
    <div style="display:flex;align-items:stretch;justify-content:space-between;gap:12px;">
      <div style="flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:36px;">
        <button class="lang-btn active" data-lang-btn="cs" onclick="setLang('cs')" style="display:block;width:100%;">🇨🇿</button>
        <button class="lang-btn" data-lang-btn="en" onclick="setLang('en')" style="display:block;width:100%;">🇬🇧</button>
      </div>
      <div style="flex:1;text-align:center;display:flex;flex-direction:column;justify-content:center;">
        <h2 data-i18n="title">CZ Streams</h2>
        <p data-i18n="subtitle" style="font-size:13px;color:#888;margin-top:4px;">Nastavení zdrojů a vyhledávání</p>
      </div>
      <div style="flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;min-width:36px;">
        <a href="https://github.com/Judzim/cz-streams" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;color:#888;transition:color 0.2s;margin-left:-2px;" title="GitHub">
          <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        </a>
        <a href="https://ko-fi.com/judzim" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;transition:opacity 0.2s;" title="Ko-fi">
          <img src="/ko-fi-logo.jpg" alt="Ko-fi" style="width:95%;height:95%;object-fit:contain;border-radius:3px;">
        </a>
      </div>
    </div>
  </div>

  <div class="section">
    ${fieldsHtml}

    <button type="button" class="btn-primary" onclick="saveConfig()" data-i18n="button.save">Uložit a pokračovat</button>

    <div id="result-box">
      <p data-i18n="result.title">🔗 Tento odkaz přidej do Stremia</p>
      <textarea id="generated-url" readonly></textarea>
      <button class="btn-sm btn-copy" onclick="copyUrl()" data-i18n="btn.copy">📋 Kopírovat</button>
      <a id="installLink" href="#" class="btn-sm btn-install" style="display:inline-block;text-decoration:none;color:white;" data-i18n="btn.install">⚡ Instalovat do Stremia</a>
    </div>
  </div>
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
    if (input.type === 'checkbox') continue;
    if (input.value.trim()) {
      data[input.name] = input.value.trim();
    }
  }

  const baseUrl = window.location.origin;
  const params = new URLSearchParams();
  for (const key in data) {
    if (data[key]) params.set(key, data[key]);
  }
  const installUrl = baseUrl + '/manifest.json?' + params.toString();

  try {
    localStorage.setItem('cz-streams-config', JSON.stringify(data));
  } catch(e) {}

  document.getElementById('generated-url').value = installUrl;
  document.getElementById('installLink').href = 'stremio://' + installUrl;
  document.getElementById('result-box').style.display = 'block';
  document.getElementById('result-box').scrollIntoView({ behavior: 'smooth' });
}

function copyUrl() {
  const url = document.getElementById('generated-url');
  url.select();
  try {
    document.execCommand('copy');
  } catch(e) {}
  url.blur();
}

// Pre-fill from URL params if present
(function() {
  const params = new URLSearchParams(window.location.search);
  if (params.size > 0) {
    for (const [key, value] of params) {
      const input = document.querySelector('[name="'+key+'"]');
      if (input) {
        if (input.type === 'checkbox') {
          input.checked = value === 'true';
        } else {
          input.value = value;
        }
      }
      const select = document.querySelector('select[name="'+key+'"]');
      if (select) {
        select.value = value;
      }
    }
  }
})();
</script>
</body>
</html>`;

export default function handler(_req: Request, res: Response) {
  const fieldsHtml = renderFields();
  // Wrap fields in a form
  const fullHtml = HTML(`<form method="GET" id="configForm" style="padding:0;">${fieldsHtml}</form>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fullHtml);
}
