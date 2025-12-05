// 独立RAG检索器
// 不依赖解析模型，直接基于用户输入和AI回复进行检索

import { extension_settings } from "../../../../../extensions.js";
import { getLoreCollections } from './lore-storage.js';
import { searchInCollections } from '../core/retrieval/similarity.js';
import { keywordSearchInCollections } from '../core/retrieval/keyword-search.js';
import { hybridFusion, buildChunksMap } from '../core/retrieval/fusion.js';
import { mergeQueryResults } from '../core/retrieval/ranker.js';
import { modelCacheManager } from '../core/vectorization/model-manager.js';

/**
 * 获取独立RAG配置
 * @param {Object} loreConfig - loreConfig对象
 * @returns {Object} 独立RAG配置
 */
function getIndependentRagConfig(loreConfig) {
  const independentRagConfig = loreConfig?.retrievalConfig?.independentRag || {};
  
  // ⭐ enabled 状态从插件设置读取，其他参数从 loreConfig 读取
  const settings = extension_settings.CharaEngineForST || {};
  
  // 返回配置，如果字段不存在则使用默认值
  return {
    enabled: settings.useIndependentRag === true,  // 从插件设置读取
    userInputWeight: independentRagConfig.userInputWeight || 1.0,
    aiReplyWeight: independentRagConfig.aiReplyWeight || 0.8,
    maxUserQueries: independentRagConfig.maxUserQueries || 3,
    maxAiQueries: independentRagConfig.maxAiQueries || 2,
    topKPerQuery: independentRagConfig.topKPerQuery || 3,
    totalTokenBudget: independentRagConfig.totalTokenBudget || loreConfig?.retrievalConfig?.tokenBudget || 2000,
    semanticSplitMethod: independentRagConfig.semanticSplitMethod || 'smart',
    deduplicateThreshold: independentRagConfig.deduplicateThreshold || 0.9
  };
}

/**
 * 执行独立RAG检索
 * @param {string} userInput - 用户输入
 * @param {string} lastAiReply - AI上一条回复
 * @param {Object} loreConfig - loreConfig对象
 * @returns {Promise<Object>} 检索结果
 */
export async function performIndependentRagRetrieval(userInput, lastAiReply, loreConfig) {
  if (!loreConfig) {
    return createEmptyResult();
  }

  try {
    // ⭐ 从配置读取恒定RAG设置
    const config = getIndependentRagConfig(loreConfig);
    
    // 如果未启用恒定RAG，返回空结果
    if (!config.enabled) {
      console.log('[Independent RAG] 恒定RAG未启用');
      return createEmptyResult();
    }
    const collections = getLoreCollections(loreConfig);
    
    if (collections.length === 0) {
      console.warn('[Independent RAG] 没有可用的集合');
      return createEmptyResult();
    }

    console.log('[Independent RAG] 开始独立RAG检索');

    // 1. 从用户输入提取查询
    const userQueries = await extractQueriesFromText(
      userInput,
      config.maxUserQueries,
      config.semanticSplitMethod
    );

    // 2. 从AI回复提取查询
    const aiQueries = lastAiReply ? await extractQueriesFromText(
      lastAiReply,
      config.maxAiQueries,
      config.semanticSplitMethod
    ) : [];

    console.log(`[Independent RAG] 提取查询: 用户${userQueries.length}条, AI${aiQueries.length}条`);
    
    // 如果没有提取到任何查询，返回空结果
    if (userQueries.length === 0 && aiQueries.length === 0) {
      console.log('[Independent RAG] 没有提取到有效查询');
      return createEmptyResult();
    }

    // 3. 执行检索
    const userResults = await retrieveForQueries(
      userQueries,
      collections,
      loreConfig,
      config.userInputWeight,
      config.topKPerQuery
    );

    const aiResults = await retrieveForQueries(
      aiQueries,
      collections,
      loreConfig,
      config.aiReplyWeight,
      config.topKPerQuery
    );

    // 4. 合并和去重
    const mergedResults = mergeAndDeduplicateResults(
      userResults,
      aiResults,
      config.deduplicateThreshold,
      config.totalTokenBudget
    );

    console.log(`[Independent RAG] 检索完成，共${mergedResults.length}个结果`);

    return {
      results: mergedResults,
      stats: generateStats(mergedResults, userQueries.length, aiQueries.length)
    };

  } catch (err) {
    console.error('[Independent RAG] 检索失败:', err);
    return {
      ...createEmptyResult(),
      error: err.message
    };
  }
}

/**
 * 从文本中提取查询
 * @param {string} text - 输入文本
 * @param {number} maxQueries - 最大查询数
 * @param {string} method - 拆分方法
 * @returns {Promise<Array<string>>}
 */
async function extractQueriesFromText(text, maxQueries, method) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  let queries = [];

  switch (method) {
    case 'sentence':
      // 按句子拆分
      queries = splitBySentence(trimmed);
      break;
    case 'paragraph':
      // 按段落拆分
      queries = splitByParagraph(trimmed);
      break;
    case 'smart':
      // 智能拆分（结合句子和语义）
      queries = await smartSplit(trimmed);
      break;
    case 'whole':
    default:
      // 默认：整体作为一个查询
      queries = [trimmed];
  }

  // 过滤空查询和过短查询
  queries = queries
    .map(q => q.trim())
    .filter(q => q.length >= 5);

  // 限制数量
  return queries.slice(0, maxQueries);
}

/**
 * 按句子拆分
 * @param {string} text
 * @returns {Array<string>}
 */
function splitBySentence(text) {
  // 中英文句子分隔符
  const sentences = text.split(/[。！？!?.]+/).filter(s => s.trim());
  return sentences;
}

/**
 * 按段落拆分
 * @param {string} text
 * @returns {Array<string>}
 */
function splitByParagraph(text) {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  return paragraphs;
}

/**
 * 智能拆分（结合句子和语义重要性）
 * @param {string} text
 * @returns {Promise<Array<string>>}
 */
async function smartSplit(text) {
  // 先按句子拆分
  const sentences = splitBySentence(text);
  
  // 过滤掉过短的句子
  const filtered = sentences.filter(s => s.length >= 10);
  
  // 如果句子数量较少，直接返回
  if (filtered.length <= 3) {
    return filtered;
  }
  
  // 否则，选择较长的句子（可能包含更多信息）
  const sorted = filtered.sort((a, b) => b.length - a.length);
  return sorted.slice(0, 3);
}

/**
 * 估算文本的Token数量（粗略估算）
 * @param {string} text - 文本内容
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  
  // 粗略估算：中文约1.5字符/token，英文约4字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 对查询列表执行检索
 * @param {Array<string>} queries
 * @param {Array<Object>} collections
 * @param {Object} loreConfig
 * @param {number} weight
 * @param {number} topK
 * @returns {Promise<Array<Object>>}
 */
async function retrieveForQueries(queries, collections, loreConfig, weight, topK) {
  if (!queries || queries.length === 0) {
    return [];
  }

  const retrievalConfig = loreConfig.retrievalConfig || {};
  const mode = retrievalConfig.mode || 'hybrid';
  const allResults = [];

  for (const query of queries) {
    let queryResults = [];

    if (mode === 'vector_only') {
      // 纯向量检索
      const queryVector = await vectorizeQuery(query, loreConfig.vectorization);
      queryResults = searchInCollections(
        queryVector,
        collections,
        null,
        topK,
        retrievalConfig.vectorSearch?.similarityThreshold || 0.6
      );
    } else if (mode === 'keyword_only') {
      // 纯关键字检索
      queryResults = keywordSearchInCollections(
        query,
        collections,
        null,
        { ...retrievalConfig.keywordSearch, topK }
      );
    } else {
      // 混合检索
      const queryVector = await vectorizeQuery(query, loreConfig.vectorization);
      const vectorResults = searchInCollections(
        queryVector,
        collections,
        null,
        topK,
        retrievalConfig.vectorSearch?.similarityThreshold || 0.6
      );

      const keywordResults = keywordSearchInCollections(
        query,
        collections,
        null,
        { ...retrievalConfig.keywordSearch, topK }
      );

      const chunksMap = buildChunksMap(collections);
      queryResults = hybridFusion(
        vectorResults,
        keywordResults,
        chunksMap,
        retrievalConfig.fusion || { method: 'rrf', rrf: { k: 60 } }
      );
    }

    // 添加权重和来源标记，并计算token数
    const weightedResults = queryResults.map(r => {
      const text = r.chunk?.text || '';
      const tokens = estimateTokenCount(text);
      return {
        ...r,
        weight,
        sourceQuery: query,
        sourceType: weight >= 1.0 ? 'user' : 'ai',
        estimatedTokens: tokens
      };
    });

    allResults.push(...weightedResults);
  }

  return allResults;
}

/**
 * 合并和去重结果
 * @param {Array<Object>} userResults
 * @param {Array<Object>} aiResults
 * @param {number} threshold
 * @param {number} tokenBudget
 * @returns {Array<Object>}
 */
function mergeAndDeduplicateResults(userResults, aiResults, threshold, tokenBudget) {
  // 合并所有结果
  const allResults = [...userResults, ...aiResults];

  if (allResults.length === 0) {
    return [];
  }

  // 按分数排序（考虑权重）
  allResults.sort((a, b) => {
    const scoreA = (a.similarity || a.keywordScore || a.fusionScore || 0) * (a.weight || 1);
    const scoreB = (b.similarity || b.keywordScore || b.fusionScore || 0) * (b.weight || 1);
    return scoreB - scoreA;
  });

  // 去重：基于chunk ID和相似度
  const deduped = [];
  const seenChunkIds = new Set();

  for (const result of allResults) {
    const chunkId = result.chunk?.id;
    if (!chunkId) continue;

    // 如果已经见过这个chunk，检查是否应该替换
    if (seenChunkIds.has(chunkId)) {
      continue;
    }

    seenChunkIds.add(chunkId);
    deduped.push(result);
  }

  // Token预算管理
  let totalTokens = 0;
  const final = [];

  for (const result of deduped) {
    const tokens = result.estimatedTokens || 0;
    if (totalTokens + tokens > tokenBudget) {
      break;
    }
    totalTokens += tokens;
    final.push(result);
  }

  return final;
}

/**
 * 向量化查询
 * @param {string} query
 * @param {Object} vectorizationConfig
 * @returns {Promise<Float32Array>}
 */
async function vectorizeQuery(query, vectorizationConfig) {
  const modelId = vectorizationConfig?.localModel?.modelId || 'Xenova/all-MiniLM-L6-v2';
  const extractor = await modelCacheManager.loadModel(modelId);
  const output = await extractor(query, { pooling: 'mean', normalize: true });
  
  const vector = output.data;
  if (vector instanceof Float32Array) {
    return vector;
  } else if (Array.isArray(vector)) {
    return new Float32Array(vector);
  } else {
    return new Float32Array(Array.from(vector));
  }
}

/**
 * 创建空结果
 * @returns {Object}
 */
function createEmptyResult() {
  return {
    results: [],
    stats: {
      totalResults: 0,
      totalTokens: 0,
      userQueries: 0,
      aiQueries: 0
    }
  };
}

/**
 * 生成统计信息
 * @param {Array<Object>} results
 * @param {number} userQueryCount
 * @param {number} aiQueryCount
 * @returns {Object}
 */
function generateStats(results, userQueryCount, aiQueryCount) {
  const totalTokens = results.reduce((sum, r) => sum + (r.estimatedTokens || 0), 0);
  const userResults = results.filter(r => r.sourceType === 'user').length;
  const aiResults = results.filter(r => r.sourceType === 'ai').length;

  return {
    totalResults: results.length,
    totalTokens,
    userQueries: userQueryCount,
    aiQueries: aiQueryCount,
    userResults,
    aiResults
  };
}