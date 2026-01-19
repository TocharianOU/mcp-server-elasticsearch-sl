import { encoding_for_model, TiktokenModel } from "tiktoken";

export interface TokenCheckResult {
  allowed: boolean;
  tokens: number;
  error?: string;
}

/**
 * Calculate the number of tokens in a text using tiktoken
 * @param text The text to calculate tokens for
 * @param model The model to use for token calculation (default: gpt-4)
 * @returns The number of tokens
 */
export function calculateTokens(text: string, model: TiktokenModel = "gpt-4"): number {
  try {
    const encoding = encoding_for_model(model);
    const tokens = encoding.encode(text);
    const tokenCount = tokens.length;
    encoding.free();
    return tokenCount;
  } catch (error) {
    console.error("Error calculating tokens:", error);
    // Fallback to rough estimation if tiktoken fails: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * Check if the result exceeds the token limit
 * @param result The result object to check
 * @param maxTokens Maximum allowed tokens
 * @param breakRule If true, bypass the token limit
 * @returns TokenCheckResult with allowed status and token count
 */
export function checkTokenLimit(
  result: any,
  maxTokens: number,
  breakRule: boolean = false
): TokenCheckResult {
  // If break rule is enabled, always allow
  if (breakRule) {
    return {
      allowed: true,
      tokens: 0, // Don't calculate if we're bypassing
    };
  }

  // Serialize the result to JSON to calculate tokens
  const resultText = JSON.stringify(result);
  const tokens = calculateTokens(resultText);

  if (tokens > maxTokens) {
    return {
      allowed: false,
      tokens,
      error: `Token limit exceeded: result contains ${tokens} tokens, limit is ${maxTokens}.

Suggestions:
1. Reduce the size/limit parameters in your query
2. Narrow down the time range or date filters
3. Add more specific query filters to reduce result set
4. Use aggregations instead of raw documents when possible
5. If absolutely necessary, retry with break_token_rule: true

Note: Frequent use of break_token_rule may cause context overflow and degraded AI performance.`,
    };
  }

  return {
    allowed: true,
    tokens,
  };
}
