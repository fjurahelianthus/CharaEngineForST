// 解析模型 API 设置弹窗
// 支持完整的API连接配置和参数传输开关

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";

const EXT_ID = "CharaEngineForST";

// 默认设置结构
const DEFAULT_SETTINGS = {
  useCustomApi: false,
  apiConnection: {
    provider: 'openai',
    model: '',
    apiKey: '',
    baseURL: '',
    customEndpoint: ''
  },
  parameters: {
    temperature: { enabled: true, value: 0.6 },
    maxTokens: { enabled: true, value: 8192 },
    topP: { enabled: false, value: 1.0 },
    topK: { enabled: false, value: 0 },
    frequencyPenalty: { enabled: false, value: 0 },
    presencePenalty: { enabled: false, value: 0 },
    repetitionPenalty: { enabled: false, value: 1.0 }
  },
  // callDelay, usePresetPrompts, injectWorldInfo 已移至主界面设置
};

/**
 * 打开解析模型 API 设置弹窗
 */
export function openParseApiSettings() {
  const settings = extension_settings[EXT_ID] || {};
  const parseApiSettings = settings.parseApiSettings || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  // 创建弹窗容器
  const modal = document.createElement("div");
  modal.className = "ce-modal-overlay";
  modal.innerHTML = `
    <div class="ce-modal-container" style="max-width: 700px; max-height: 90vh;">
      <div class="ce-modal-header">
        <h3>解析模型 API 设置</h3>
        <button class="ce-modal-close" aria-label="关闭">&times;</button>
      </div>
      <div class="ce-modal-body">
        <div class="ce-parse-api-settings">
        
        <!-- 说明文字 -->
        <div class="ce-setting-section">
          <div class="ce-setting-description">
            <p><strong>注意：</strong>API调用延迟和预设提示词配置已移至主界面的"对话逻辑"部分，方便快速修改。</p>
            <p>此处仅配置解析模型的API连接和采样参数。</p>
          </div>
        </div>

        <!-- 模式选择 -->
        <div class="ce-setting-section">
          <h4>API 配置模式</h4>
          <div class="ce-setting-description">
            <p>解析模型用于分析对话内容并生成状态更新指令。你可以选择使用当前的API设置，或为解析模型单独配置。</p>
          </div>
        </div>

          <div class="ce-setting-section">
            <div class="ce-radio-group">
              <label class="ce-radio-label">
                <input type="radio" name="parse_api_mode" value="inherit" ${!parseApiSettings.useCustomApi ? 'checked' : ''}>
                <span>使用当前 API 设置（继承主对话模型的配置）</span>
              </label>
              <label class="ce-radio-label">
                <input type="radio" name="parse_api_mode" value="custom" ${parseApiSettings.useCustomApi ? 'checked' : ''}>
                <span>使用自定义 API 设置（完全独立配置）</span>
              </label>
            </div>
          </div>

          <!-- 自定义API设置区域 -->
          <div class="ce-setting-section ce-custom-api-settings" style="display: ${parseApiSettings.useCustomApi ? 'block' : 'none'};">
            
            <div class="ce-api-config-layout">
              <!-- 左侧：API连接配置 -->
              <div class="ce-api-config-left">
                <h4>API 连接配置</h4>
                <div class="ce-form-grid" style="grid-template-columns: 1fr;">
              
              <div class="ce-form-group">
                <label for="parse_provider">API 提供商</label>
                <select id="parse_provider" class="text_pole">
                  <option value="current" ${parseApiSettings.apiConnection?.provider === 'current' ? 'selected' : ''}>当前（使用当前API配置）</option>
                  <option value="openai" ${parseApiSettings.apiConnection?.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                  <option value="claude" ${parseApiSettings.apiConnection?.provider === 'claude' ? 'selected' : ''}>Claude (Anthropic)</option>
                  <option value="gemini" ${parseApiSettings.apiConnection?.provider === 'gemini' ? 'selected' : ''}>Gemini (Google)</option>
                  <option value="deepseek" ${parseApiSettings.apiConnection?.provider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                  <option value="groq" ${parseApiSettings.apiConnection?.provider === 'groq' ? 'selected' : ''}>Groq</option>
                  <option value="openrouter" ${parseApiSettings.apiConnection?.provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
                  <option value="custom" ${parseApiSettings.apiConnection?.provider === 'custom' ? 'selected' : ''}>自定义</option>
                </select>
              </div>

              <div class="ce-form-group">
                <label for="parse_model">模型名称</label>
                <input type="text" id="parse_model" class="text_pole" value="${parseApiSettings.apiConnection?.model || ''}"
                  placeholder="例如: gpt-4, claude-3-5-sonnet-20241022">
                <small>留空则使用当前选择的模型</small>
              </div>

              <div class="ce-form-group">
                <label for="parse_api_key">API 密钥</label>
                <input type="password" id="parse_api_key" class="text_pole" value="${parseApiSettings.apiConnection?.apiKey || ''}"
                  placeholder="留空则使用当前API密钥">
                <small>留空则使用当前配置的API密钥</small>
              </div>

              <div class="ce-form-group">
                <label for="parse_base_url">反代地址 / Base URL</label>
                <input type="text" id="parse_base_url" class="text_pole" value="${parseApiSettings.apiConnection?.baseURL || ''}"
                  placeholder="例如: https://api.openai.com/v1">
                <small>留空则使用默认地址或当前反代设置</small>
              </div>

              <div class="ce-form-group">
                <label for="parse_custom_endpoint">自定义端点</label>
                <input type="text" id="parse_custom_endpoint" class="text_pole" value="${parseApiSettings.apiConnection?.customEndpoint || ''}"
                  placeholder="仅在使用自定义提供商时需要">
                </div>
              </div>
            </div>

            <!-- 右侧：参数配置 -->
            <div class="ce-api-config-right">
              <h4>采样参数配置</h4>
            <p style="font-size: 0.85rem; color: #888; margin-bottom: 12px;">
              勾选参数以启用传输。未勾选的参数不会发送给API（适用于禁止某些参数的API渠道）。
            </p>
            
            <div class="ce-param-list">
              ${createParameterControl('temperature', 'Temperature', parseApiSettings.parameters?.temperature, 0, 2, 0.1, '控制输出随机性，推荐0.6')}
              ${createParameterControl('maxTokens', 'Max Tokens', parseApiSettings.parameters?.maxTokens, 512, 32768, 512, '最大输出token数，推荐8192')}
              ${createParameterControl('topP', 'Top P', parseApiSettings.parameters?.topP, 0, 1, 0.05, '核采样参数')}
              ${createParameterControl('topK', 'Top K', parseApiSettings.parameters?.topK, 0, 100, 1, '限制采样token数量')}
              ${createParameterControl('frequencyPenalty', 'Frequency Penalty', parseApiSettings.parameters?.frequencyPenalty, -2, 2, 0.1, '降低重复token概率')}
              ${createParameterControl('presencePenalty', 'Presence Penalty', parseApiSettings.parameters?.presencePenalty, -2, 2, 0.1, '鼓励新话题')}
              ${createParameterControl('repetitionPenalty', 'Repetition Penalty', parseApiSettings.parameters?.repetitionPenalty, 0, 2, 0.05, '惩罚重复内容')}
            </div>

            <div class="ce-preset-buttons">
              <button type="button" class="ce-btn-secondary" id="parse_api_reset">
                重置为推荐值
              </button>
            </div>
            </div>
          </div>
          </div>
        </div>
      </div>
      <div class="ce-modal-footer">
        <button type="button" class="ce-btn-secondary ce-modal-cancel">取消</button>
        <button type="button" class="ce-btn-primary ce-modal-save">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 获取元素引用
  const closeBtn = modal.querySelector(".ce-modal-close");
  const cancelBtn = modal.querySelector(".ce-modal-cancel");
  const saveBtn = modal.querySelector(".ce-modal-save");
  const radioButtons = modal.querySelectorAll('input[name="parse_api_mode"]');
  const customSettingsSection = modal.querySelector(".ce-custom-api-settings");
  const resetBtn = modal.querySelector("#parse_api_reset");

  // 切换自定义设置显示
  function updateCustomSettingsVisibility() {
    const useCustom = modal.querySelector('input[name="parse_api_mode"]:checked').value === 'custom';
    customSettingsSection.style.display = useCustom ? 'block' : 'none';
  }

  radioButtons.forEach(radio => {
    radio.addEventListener('change', updateCustomSettingsVisibility);
  });

  // 参数启用/禁用切换
  modal.querySelectorAll('.ce-param-toggle').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const paramName = e.target.dataset.param;
      const input = modal.querySelector(`#parse_param_${paramName}`);
      if (input) {
        input.disabled = !e.target.checked;
      }
    });
  });

  // 重置为推荐值
  resetBtn.addEventListener('click', () => {
    const defaults = DEFAULT_SETTINGS.parameters;
    for (const [key, config] of Object.entries(defaults)) {
      const checkbox = modal.querySelector(`.ce-param-toggle[data-param="${key}"]`);
      const input = modal.querySelector(`#parse_param_${key}`);
      if (checkbox && input) {
        checkbox.checked = config.enabled;
        input.value = config.value;
        input.disabled = !config.enabled;
      }
    }
  });

  // 关闭弹窗
  function closeModal() {
    modal.remove();
  }

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // 保存设置
  saveBtn.addEventListener("click", () => {
    const useCustom = modal.querySelector('input[name="parse_api_mode"]:checked').value === 'custom';
    
    const newSettings = {
      useCustomApi: useCustom,
      apiConnection: {
        provider: modal.querySelector('#parse_provider').value,
        model: modal.querySelector('#parse_model').value,
        apiKey: modal.querySelector('#parse_api_key').value,
        baseURL: modal.querySelector('#parse_base_url').value,
        customEndpoint: modal.querySelector('#parse_custom_endpoint').value
      },
      parameters: {}
    };

    // 收集参数设置
    const paramNames = ['temperature', 'maxTokens', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty'];
    for (const paramName of paramNames) {
      const checkbox = modal.querySelector(`.ce-param-toggle[data-param="${paramName}"]`);
      const input = modal.querySelector(`#parse_param_${paramName}`);
      if (checkbox && input) {
        newSettings.parameters[paramName] = {
          enabled: checkbox.checked,
          value: parseFloat(input.value) || 0
        };
      }
    }

    // 保存到扩展设置
    if (!extension_settings[EXT_ID]) {
      extension_settings[EXT_ID] = {};
    }
    extension_settings[EXT_ID].parseApiSettings = newSettings;
    saveSettingsDebounced();

    // 显示保存成功提示
    saveBtn.textContent = "✓ 已保存";
    saveBtn.disabled = true;
    
    setTimeout(() => {
      closeModal();
    }, 500);
  });

  // ESC键关闭
  function handleEscape(e) {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);
}

/**
 * 创建参数控制HTML
 */
function createParameterControl(paramName, label, config, min, max, step, description) {
  const enabled = config?.enabled !== false;
  const value = config?.value ?? DEFAULT_SETTINGS.parameters[paramName].value;
  
  return `
    <div class="ce-param-item">
      <div class="ce-param-header">
        <label class="ce-param-checkbox">
          <input type="checkbox" class="ce-param-toggle" data-param="${paramName}" ${enabled ? 'checked' : ''}>
          <span class="ce-param-label">${label}</span>
        </label>
        <input type="number" id="parse_param_${paramName}" class="ce-param-input" 
          min="${min}" max="${max}" step="${step}" value="${value}" ${!enabled ? 'disabled' : ''}>
      </div>
      <small class="ce-param-desc">${description}</small>
    </div>
  `;
}