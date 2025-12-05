// 独立RAG注入器
// 将独立RAG检索结果格式化并注入到提示中

import { performIndependentRagRetrieval } from './independent-rag-retriever.js';

/**
 * 执行独立RAG并返回格式化的提示文本
 * @param {string} userInput - 用户输入
 * @param {string} lastAiReply - AI上一条回复
 * @param {Object} loreConfig - loreConfig对象
 * @returns {Promise<string>}
 */
export async function injectIndependentRag(userInput, lastAiReply, loreConfig) {
  if (!loreConfig) {
    return '';
  }

  try {
    // 执行检索
    const retrievalResult = await performIndependentRagRetrieval(
      userInput,
      lastAiReply,
      loreConfig
    );

    if (!retrievalResult.results || retrievalResult.results.length === 0) {
      console.log('[Independent RAG Injector] 没有检索到相关内容');
      return '';
    }

    // 格式化为提示文本
    const promptText = formatIndependentRagResults(retrievalResult.results);

    // 输出统计信息
    const stats = retrievalResult.stats;
    console.log(`[Independent RAG Injector] 注入${stats.totalResults}个片段 (用户:${stats.userResults}, AI:${stats.aiResults}), 约${stats.totalTokens} tokens`);

    return promptText;

  } catch (err) {
    console.error('[Independent RAG Injector] 注入失败:', err);
    return '';
  }
}

/**
 * 格式化独立RAG结果
 * @param {Array<Object>} results
 * @returns {string}
 */
function formatIndependentRagResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return '';
  }

  const lines = [];
  lines.push('【相关背景信息】');
  lines.push('');

  // 按来源类型分组
  const userResults = results.filter(r => r.sourceType === 'user');
  const aiResults = results.filter(r => r.sourceType === 'ai');

  // 输出用户输入相关的结果
  if (userResults.length > 0) {
    lines.push('## 与当前对话相关的背景');
    lines.push('');
    for (const result of userResults) {
      const chunk = result.chunk;
      if (!chunk) continue;

      const docTitle = chunk.metadata?.docTitle || '未知文档';
      const text = chunk.text || '';
      const score = result.similarity || result.keywordScore || result.fusionScore || 0;

      lines.push(`### ${docTitle} (相关度: ${score.toFixed(3)})`);
      lines.push(text);
      lines.push('');
    }
  }

  // 输出AI回复相关的结果
  if (aiResults.length > 0) {
    lines.push('## 与上文提及内容相关的背景');
    lines.push('');
    for (const result of aiResults) {
      const chunk = result.chunk;
      if (!chunk) continue;

      const docTitle = chunk.metadata?.docTitle || '未知文档';
      const text = chunk.text || '';
      const score = result.similarity || result.keywordScore || result.fusionScore || 0;

      lines.push(`### ${docTitle} (相关度: ${score.toFixed(3)})`);
      lines.push(text);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 生成独立RAG提示块的摘要（用于调试）
 * @param {string} promptText - 提示文本
 * @returns {Object}
 */
export function summarizeIndependentRagPrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return {
      isEmpty: true,
      charCount: 0,
      lineCount: 0,
      sectionCount: 0
    };
  }

  const lines = promptText.split('\n');
  const sections = (promptText.match(/###/g) || []).length;

  return {
    isEmpty: false,
    charCount: promptText.length,
    lineCount: lines.length,
    sectionCount: sections
  };
}

/**
 * 验证独立RAG提示文本的格式
 * @param {string} promptText - 提示文本
 * @returns {Object} 验证结果 {valid: boolean, warnings: string[]}
 */
export function validateIndependentRagPrompt(promptText) {
  const warnings = [];

  if (!promptText || typeof promptText !== 'string') {
    return { valid: true, warnings: ['提示文本为空'] };
  }

  // 检查是否包含标题
  if (!promptText.includes('【相关背景信息】')) {
    warnings.push('缺少标题标记');
  }

  // 检查是否有实际内容
  const contentLines = promptText.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('【');
  });

  if (contentLines.length === 0) {
    warnings.push('没有实际内容');
  }

  // 检查长度
  if (promptText.length > 10000) {
    warnings.push(`提示文本过长 (${promptText.length} 字符)，可能超出Token预算`);
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}