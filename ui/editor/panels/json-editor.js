// JSON编辑器面板
// 提供JSON格式的配置编辑功能，支持正常换行显示

import { logDebug } from "../utils/dom.js";

/**
 * 初始化JSON编辑器面板
 * @param {HTMLElement} panel
 */
export function initJsonEditorPanel(panel) {
  panel.innerHTML = `
    <div class="ce-panel-section">
      <div class="ce-section-header">
        <h3>JSON配置编辑器</h3>
        <div class="ce-small-hint">
          在此处直接编辑JSON格式的配置。保存时会自动转换为表单数据。
        </div>
      </div>
      <div class="ce-section-body">
        <div style="margin-bottom: 15px; display: flex; gap: 10px; align-items: center;">
          <button class="ce-btn ce-btn-secondary" data-json-action="format" title="格式化JSON">
            <i class="fa-solid fa-indent"></i> 格式化
          </button>
          <button class="ce-btn ce-btn-secondary" data-json-action="sync-from-form" title="从表单同步到JSON">
            <i class="fa-solid fa-sync"></i> 从表单同步
          </button>
          <button class="ce-btn ce-btn-secondary" data-json-action="sync-to-form" title="从JSON同步到表单">
            <i class="fa-solid fa-sync-alt"></i> 同步到表单
          </button>
          <div class="ce-small-hint" style="margin-left: auto;" data-json-status></div>
        </div>
        <div style="position: relative;">
          <textarea 
            data-json-editor
            spellcheck="false"
            style="width: 100%; min-height: 500px; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; 
                   font-size: 13px; line-height: 1.5; padding: 12px; 
                   border: 1px solid var(--SmartThemeBorderColor, #444); 
                   border-radius: 4px; background: var(--SmartThemeBlurTintColor, #1a1a1a);
                   color: var(--SmartThemeBodyColor, #e9e9e9); resize: vertical;
                   white-space: pre; overflow-wrap: normal; overflow-x: auto;"
            placeholder="JSON配置将在此显示..."
          ></textarea>
          <div data-json-error style="margin-top: 10px; padding: 10px; 
               background: rgba(220, 53, 69, 0.15); border: 1px solid rgba(220, 53, 69, 0.5); 
               border-radius: 4px; color: #dc3545; display: none;">
          </div>
        </div>
      </div>
    </div>
  `;

  // 绑定按钮事件
  const formatBtn = panel.querySelector('[data-json-action="format"]');
  const syncFromFormBtn = panel.querySelector('[data-json-action="sync-from-form"]');
  const syncToFormBtn = panel.querySelector('[data-json-action="sync-to-form"]');
  const textarea = panel.querySelector('[data-json-editor]');
  const errorBox = panel.querySelector('[data-json-error]');
  const statusEl = panel.querySelector('[data-json-status]');

  if (formatBtn) {
    formatBtn.addEventListener("click", () => {
      formatJson(textarea, errorBox, statusEl);
    });
  }

  if (syncFromFormBtn) {
    syncFromFormBtn.addEventListener("click", () => {
      // 这个功能由外部调用 renderJsonEditor 实现
      const event = new CustomEvent("ce-json-sync-from-form");
      panel.dispatchEvent(event);
    });
  }

  if (syncToFormBtn) {
    syncToFormBtn.addEventListener("click", () => {
      syncJsonToForm(panel, textarea, errorBox, statusEl);
    });
  }

  // 输入时清除错误提示
  if (textarea) {
    textarea.addEventListener("input", () => {
      if (errorBox) {
        errorBox.style.display = "none";
      }
      if (statusEl) {
        statusEl.textContent = "";
      }
    });
  }

  logDebug("JSON编辑器面板已初始化");
}

/**
 * 渲染JSON编辑器内容
 * @param {HTMLElement} panel
 * @param {any} config - 配置对象
 */
export function renderJsonEditor(panel, config) {
  const textarea = panel.querySelector('[data-json-editor]');
  const errorBox = panel.querySelector('[data-json-error]');
  const statusEl = panel.querySelector('[data-json-status]');

  if (!textarea) return;

  try {
    // 将配置转换为格式化的JSON，然后将\n转换为实际换行
    const jsonStr = JSON.stringify(config, null, 2);
    const displayStr = convertEscapedNewlinesToReal(jsonStr);
    textarea.value = displayStr;

    if (errorBox) {
      errorBox.style.display = "none";
    }
    if (statusEl) {
      statusEl.textContent = "已同步";
      statusEl.style.color = "#28a745";
      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 2000);
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = `无法序列化配置: ${err.message}`;
      errorBox.style.display = "block";
    }
    logDebug("JSON序列化失败:", err);
  }
}

/**
 * 从JSON编辑器收集配置
 * @param {HTMLElement} panel
 * @returns {any|null} 返回解析后的配置对象，失败返回null
 */
export function collectJsonConfig(panel) {
  const textarea = panel.querySelector('[data-json-editor]');
  const errorBox = panel.querySelector('[data-json-error]');

  if (!textarea) return null;

  try {
    const displayStr = textarea.value.trim();
    if (!displayStr) {
      return {
        parameters: [],
        promptTypes: [],
        prompts: [],
        entities: [],
        initialState: {},
        options: {}
      };
    }

    // 将实际换行转换回\n再解析
    const jsonStr = convertRealNewlinesToEscaped(displayStr);
    const config = JSON.parse(jsonStr);
    
    if (errorBox) {
      errorBox.style.display = "none";
    }

    return config;
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = `JSON解析错误: ${err.message}`;
      errorBox.style.display = "block";
    }
    logDebug("JSON解析失败:", err);
    return null;
  }
}

/**
 * 格式化JSON
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} errorBox
 * @param {HTMLElement} statusEl
 */
function formatJson(textarea, errorBox, statusEl) {
  if (!textarea) return;

  try {
    const displayStr = textarea.value.trim();
    if (!displayStr) {
      if (statusEl) {
        statusEl.textContent = "内容为空";
        statusEl.style.color = "#ffc107";
      }
      return;
    }

    // 将实际换行转换回\n，解析，再格式化，再转换回实际换行
    const jsonStr = convertRealNewlinesToEscaped(displayStr);
    const config = JSON.parse(jsonStr);
    const formatted = JSON.stringify(config, null, 2);
    const displayFormatted = convertEscapedNewlinesToReal(formatted);
    textarea.value = displayFormatted;

    if (errorBox) {
      errorBox.style.display = "none";
    }
    if (statusEl) {
      statusEl.textContent = "已格式化";
      statusEl.style.color = "#28a745";
      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 2000);
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = `格式化失败: ${err.message}`;
      errorBox.style.display = "block";
    }
    if (statusEl) {
      statusEl.textContent = "格式化失败";
      statusEl.style.color = "#dc3545";
    }
  }
}

/**
 * 将JSON同步到表单
 * @param {HTMLElement} panel
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} errorBox
 * @param {HTMLElement} statusEl
 */
function syncJsonToForm(panel, textarea, errorBox, statusEl) {
  if (!textarea) return;

  try {
    const displayStr = textarea.value.trim();
    if (!displayStr) {
      if (statusEl) {
        statusEl.textContent = "内容为空";
        statusEl.style.color = "#ffc107";
      }
      return;
    }

    // 将实际换行转换回\n再解析
    const jsonStr = convertRealNewlinesToEscaped(displayStr);
    const config = JSON.parse(jsonStr);

    if (errorBox) {
      errorBox.style.display = "none";
    }

    // 触发自定义事件，由外部处理同步逻辑
    const event = new CustomEvent("ce-json-sync-to-form", {
      detail: { config }
    });
    panel.dispatchEvent(event);

    if (statusEl) {
      statusEl.textContent = "已同步到表单";
      statusEl.style.color = "#28a745";
      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 2000);
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = `同步失败: ${err.message}`;
      errorBox.style.display = "block";
    }
    if (statusEl) {
      statusEl.textContent = "同步失败";
      statusEl.style.color = "#dc3545";
    }
  }
}

/**
 * 将JSON字符串中的转义换行符(\n)转换为实际换行符
 * 只转换字符串值内部的\n，不影响JSON结构
 * @param {string} jsonStr
 * @returns {string}
 */
function convertEscapedNewlinesToReal(jsonStr) {
  // 使用正则表达式匹配JSON字符串值（被双引号包裹的内容）
  // 并将其中的\\n替换为实际换行符
  return jsonStr.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
    // 在字符串内部将\\n替换为实际换行
    return match.replace(/\\n/g, '\n');
  });
}

/**
 * 将实际换行符转换回JSON转义的\n
 * 只转换字符串值内部的换行，保持JSON结构的换行不变
 * @param {string} displayStr
 * @returns {string}
 */
function convertRealNewlinesToEscaped(displayStr) {
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < displayStr.length; i++) {
    const char = displayStr[i];
    const prevChar = i > 0 ? displayStr[i - 1] : '';
    
    // 处理转义字符
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }
    
    // 检测字符串边界（双引号）
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
      result += char;
      continue;
    }
    
    // 在字符串内部，将实际换行转换为\n
    if (inString && char === '\n') {
      result += '\\n';
      continue;
    }
    
    result += char;
  }
  
  return result;
}