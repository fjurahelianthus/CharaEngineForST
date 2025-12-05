// 流程编排模块：主拦截器逻辑
// - 只负责流程编排，不包含具体实现
// - 清晰的步骤划分和错误处理
// - 所有业务逻辑委托给专门模块

import { extension_settings } from "../../../../extensions.js";
import { getContext } from "../../../../extensions.js";
import { buildParsePromptInput, callParseModel } from "../integration/parse-caller.js";
import { buildPromptInjectionBlock } from "../integration/prompt-builder.js";
import { getConfigForCurrentCharacter } from "../integration/card-storage.js";
import {
  setChangeSetForIndex,
  getChangeSetForIndex,
  rebuildEngineStateUpTo,
  applyCeInitFromGreeting,
  setCheckpoint
} from "../integration/chat-state-storage.js";
import { parseModelOutput } from "../integration/state-parser.js";
import { applyChangeSet } from "../core/engine-state.js";

const EXT_ID = "CharacterEngine";

/**
 * generate_interceptor 入口
 * - 检查是否已有 ChangeSet，如果没有且应该解析，则调用解析模型
 * - 解析完成后立即存储到 changeSetsByIndex[targetIndex]
 * - 使用「最新 EngineState + 角色卡参数/提示定义」构造提示组合，并注入到 chat 作为系统说明
 *
 * @param {Array} chat - 即将用于构造提示的消息数组（可修改）
 * @param {number} contextSize - 当前上下文 token 数估计
 * @param {(stopAll?: boolean) => void} abort - 终止本次生成的函数
 * @param {string} type - 生成类型（quiet/regenerate/impersonate/...）
 */
export async function ceGenerateInterceptor(chat, contextSize, abort, type) {
  const settings = extension_settings[EXT_ID] || {};
  
  if (!settings.enabled) {
    return;
  }

  try {
    const ctx = getContext?.() || {};
    const targetIndex = chat.length - 1;

    // 步骤 0: 处理 greeting 中的 <CE_Init> ... ce.set(...) ... </CE_Init>
    applyCeInitFromGreeting(chat);

    // 步骤 1: 检查是否已有 ChangeSet（会自动验证内容哈希和分支）
    let parseChangeSet = getChangeSetForIndex(targetIndex);
    
    // 步骤 2: 判断是否需要解析
    // 定义明确不需要解析的类型（黑名单策略）
    const SKIP_PARSE_TYPES = new Set(['quiet', 'impersonate']);
    const hasValidCache = !!parseChangeSet;
    
    // 解析条件：没有有效缓存 且 不在跳过列表中
    const shouldParse = !hasValidCache && (!type || !SKIP_PARSE_TYPES.has(type));
    
    logDebug(`缓存检查结果：`, {
      targetIndex,
      hasCache: hasValidCache,
      type: type || 'normal',
      shouldParse,
      reason: hasValidCache ? '有有效缓存' : '缓存失效或不存在'
    });
    
    if (settings.useEarlyParse !== false && shouldParse) {
      // 重建到上一楼层的状态（不包含当前楼层）
      const currentStateBeforeParse = targetIndex > 0
        ? rebuildEngineStateUpTo(targetIndex - 1)
        : rebuildEngineStateUpTo(targetIndex);
      
      parseChangeSet = await performEarlyParse(chat, currentStateBeforeParse);
      
      if (parseChangeSet) {
        // 立即存储到 changeSetsByIndex
        await setChangeSetForIndex(targetIndex, parseChangeSet);
        logDebug(`ChangeSet 已存储到索引 ${targetIndex}`);
      }
    } else if (parseChangeSet) {
      logDebug(`复用已存储的 ChangeSet（索引 ${targetIndex}）`);
    } else {
      logDebug(`跳过解析（type=${type}），且无已存储的 ChangeSet`);
    }

    // 步骤 3: 构建当前状态（包含本轮 ChangeSet）
    const engineState = buildCurrentEngineState(chat, parseChangeSet);

    // 步骤 3.5: 独立RAG检索（如果启用）
    const charConfig = getConfigForCurrentCharacter();
    const independentRagBlock = await buildIndependentRagBlock(chat, charConfig);

    // 步骤 4: 构造并注入提示（支持异步RAG）
    const injectionText = await buildPromptInjectionBlock(engineState);

    // 合并独立RAG和常规提示
    const finalInjectionText = [independentRagBlock, injectionText]
      .filter(Boolean)
      .join('\n\n');

    if (finalInjectionText) {
      injectPromptToChat(chat, finalInjectionText);
    }

    // 步骤 5: 更新 checkpoint（如果有新的 ChangeSet）
    if (parseChangeSet) {
      await setCheckpoint(targetIndex, engineState);
      logDebug(`checkpoint 已更新到索引 ${targetIndex}`);
    }

    logDebug("拦截 generate 调用", { contextSize, type, messageCount: chat?.length, targetIndex });
  } catch (err) {
    handleInterceptorError(err);
  }
}

/**
 * 执行提前解析调用
 * @param {Array} chat
 * @param {import("../core/engine-state.js").EngineState} [currentState] - 当前引擎状态
 * @returns {Promise<Object|null>}
 */
async function performEarlyParse(chat, currentState = null) {
  const parseInput = buildParsePromptInput(chat, currentState);
  if (!parseInput) {
    logDebug("performEarlyParse: buildParsePromptInput 返回 null");
    return null;
  }

  const parsedText = await callParseModel(parseInput);
  if (!parsedText) {
    logDebug("performEarlyParse: callParseModel 返回空");
    return null;
  }

  // 使用新的智能解析器
  const parseResult = parseModelOutput(parsedText);
  
  // 详细的调试输出
  logDebug("━━━━━━━━━━ 解析模型输出 ━━━━━━━━━━");
  logDebug("【原始文本】\n", parseResult.rawText);
  logDebug("【解析方法】", parseResult.parseMethod);
  
  if (parseResult.warnings && parseResult.warnings.length > 0) {
    logDebug("【解析警告】", parseResult.warnings);
  }
  
  if (parseResult.debugInfo && Object.keys(parseResult.debugInfo).length > 0) {
    logDebug("【调试信息】", parseResult.debugInfo);
  }
  
  if (parseResult.changeSet) {
    logDebug("【解析结果】ChangeSet:", {
      hasStateDelta: !!parseResult.stateDelta,
      hasSceneDelta: !!parseResult.sceneDelta,
      hasWorldIntent: !!parseResult.worldIntent,
      variableCount: parseResult.stateDelta?.variables?.length || 0
    });
  } else {
    logDebug("【解析结果】未能提取有效的 ChangeSet");
  }
  logDebug("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  if (parseResult.changeSet && (parseResult.stateDelta || parseResult.sceneDelta || parseResult.worldIntent)) {
    return parseResult.changeSet;
  }

  return null;
}

/**
 * 构建当前轮次的 EngineState
 * @param {Array} chat
 * @param {Object|null} parseChangeSet
 * @returns {import("../core/engine-state.js").EngineState}
 */
function buildCurrentEngineState(chat, parseChangeSet) {
  const targetIndex = chat.length - 1;
  let engineState = rebuildEngineStateUpTo(targetIndex);
  
  if (parseChangeSet) {
    // 获取参数定义以支持符号化操作
    const charConfig = getConfigForCurrentCharacter();
    const parameterDefs = Array.isArray(charConfig.parameters) ? charConfig.parameters : [];
    engineState = applyChangeSet(engineState, parseChangeSet, parameterDefs);
  }
  
  return engineState;
}

/**
 * 将提示注入块插入到 chat 中
 * @param {Array} chat
 * @param {string} injectionText
 */
function injectPromptToChat(chat, injectionText) {
  const systemNote = {
    is_user: false,
    name: "角色引擎",
    send_date: Date.now(),
    mes: injectionText
  };
  const insertIndex = Math.max(chat.length - 1, 0);
  chat.splice(insertIndex, 0, systemNote);
}

/**
 * 处理拦截器错误
 * @param {Error} err
 */
function handleInterceptorError(err) {
  // 对用户主动停止的中断错误不刷错误日志，直接放行
  const msg = (err && (err.message || String(err))) || "";
  if (msg.includes("Clicked stop button")) {
    logDebug("检测到用户点击停止按钮，中止本轮角色引擎处理");
    return;
  }

  // 其它异常：不阻断主流程，直接放行
  // eslint-disable-next-line no-console
  console.error("[CharacterEngine] 拦截 generate 时发生错误，将不修改本轮提示", err);

/**
 * 构建独立RAG块
 * @param {Array} chat - 聊天消息数组
 * @param {Object} charConfig - 角色配置
 * @returns {Promise<string>}
 */
async function buildIndependentRagBlock(chat, charConfig) {
  // 检查全局开关是否启用独立RAG
  const settings = extension_settings[EXT_ID] || {};
  if (!settings.useIndependentRag) {
    return '';
  }

  // 检查是否有loreConfig
  const loreConfig = charConfig?.loreConfig;
  if (!loreConfig) {
    return '';
  }

  try {
    // 获取用户输入（最后一条消息）
    const lastMessage = chat[chat.length - 1];
    const userInput = lastMessage?.mes || '';

    // 获取AI上一条回复（倒数第二条消息，且必须是AI的消息）
    let lastAiReply = '';
    for (let i = chat.length - 2; i >= 0; i--) {
      const msg = chat[i];
      if (msg && !msg.is_user) {
        lastAiReply = msg.mes || '';
        break;
      }
    }

    logDebug('[Independent RAG] 准备检索', {
      userInputLength: userInput.length,
      lastAiReplyLength: lastAiReply.length
    });

    // 动态导入独立RAG模块
    const ragModule = await import('../rag/integration/independent-rag-injector.js');
    const independentRagText = await ragModule.injectIndependentRag(
      userInput,
      lastAiReply,
      loreConfig
    );

    return independentRagText;
  } catch (err) {
    console.error('[Interceptor] 独立RAG注入失败:', err);
    return '';
  }
}
}

/**
 * 调试日志输出
 * @param {...any} args
 */
function logDebug(...args) {
  // eslint-disable-next-line no-console
  console.debug("[CharacterEngine]", ...args);
}