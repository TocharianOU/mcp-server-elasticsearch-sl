/**
 * Index Analyzer - Smart index analysis and grouping utilities
 * Handles time-series index detection, pattern grouping, and summary generation
 */

interface IndexInfo {
  index: string;
  health?: string;
  status?: string;
  docsCount?: string;
  storeSize?: string;
  priStoreSize?: string;
}

interface TimeSeriesGroup {
  pattern: string;
  count: number;
  indices: IndexInfo[];
  dateRange?: {
    earliest: string;
    latest: string;
  };
  totalDocs: number;
}

interface IndexSummary {
  total_indices: number;
  total_docs: number;
  health_distribution: {
    green: number;
    yellow: number;
    red: number;
  };
  status_distribution: {
    open: number;
    close: number;
  };
  detected_patterns: Array<{
    pattern: string;
    count: number;
    date_range?: string;
    sample_indices: string[];
  }>;
}

/**
 * Detect if an index follows a time-series naming pattern
 */
export function detectTimeSeriesPattern(indexName: string): {
  isTimeSeries: boolean;
  basePattern?: string;
  date?: string;
} {
  const patterns = [
    // logs-2024.01.01, logs-2024.01.01-000001
    { regex: /^(.+?)-(\d{4})\.(\d{2})\.(\d{2})(-\d+)?$/, format: 'YYYY.MM.DD' },
    // logs-2024-01-01, logs-2024-01-01-000001
    { regex: /^(.+?)-(\d{4})-(\d{2})-(\d{2})(-\d+)?$/, format: 'YYYY-MM-DD' },
    // logs-2024.01, logs-2024.01-000001
    { regex: /^(.+?)-(\d{4})\.(\d{2})(-\d+)?$/, format: 'YYYY.MM' },
    // logs-2024-01, logs-2024-01-000001
    { regex: /^(.+?)-(\d{4})-(\d{2})(-\d+)?$/, format: 'YYYY-MM' },
    // logs-2024, logs-2024-000001
    { regex: /^(.+?)-(\d{4})(-\d+)?$/, format: 'YYYY' },
    // .ds-logs-generic-default-2024.01.01-000001 (data streams)
    { regex: /^\.ds-(.+?)-(\d{4})\.(\d{2})\.(\d{2})-\d+$/, format: 'DataStream-YYYY.MM.DD' },
  ];

  for (const { regex, format } of patterns) {
    const match = indexName.match(regex);
    if (match) {
      const basePattern = match[1];
      let date = '';
      
      if (format.includes('YYYY.MM.DD')) {
        date = `${match[2]}.${match[3]}.${match[4]}`;
      } else if (format.includes('YYYY-MM-DD')) {
        date = `${match[2]}-${match[3]}-${match[4]}`;
      } else if (format.includes('YYYY.MM') || format.includes('YYYY-MM')) {
        date = `${match[2]}.${match[3]}`;
      } else if (format === 'YYYY') {
        date = match[2];
      }

      return {
        isTimeSeries: true,
        basePattern: format.includes('DataStream') ? `.ds-${basePattern}` : basePattern,
        date,
      };
    }
  }

  return { isTimeSeries: false };
}

/**
 * Group indices by their base patterns
 */
export function groupIndicesByPattern(indices: IndexInfo[]): Map<string, TimeSeriesGroup> {
  const groups = new Map<string, TimeSeriesGroup>();

  for (const index of indices) {
    const detection = detectTimeSeriesPattern(index.index);
    const key = detection.isTimeSeries && detection.basePattern 
      ? detection.basePattern 
      : 'other';

    if (!groups.has(key)) {
      groups.set(key, {
        pattern: key,
        count: 0,
        indices: [],
        totalDocs: 0,
      });
    }

    const group = groups.get(key)!;
    group.count++;
    group.indices.push(index);
    group.totalDocs += parseInt(index.docsCount || '0', 10);

    // Track date range for time-series indices
    if (detection.isTimeSeries && detection.date) {
      if (!group.dateRange) {
        group.dateRange = { earliest: detection.date, latest: detection.date };
      } else {
        if (detection.date < group.dateRange.earliest) {
          group.dateRange.earliest = detection.date;
        }
        if (detection.date > group.dateRange.latest) {
          group.dateRange.latest = detection.date;
        }
      }
    }
  }

  return groups;
}

/**
 * Generate a summary view for large index sets
 */
export function generateIndexSummary(indices: IndexInfo[]): IndexSummary {
  const summary: IndexSummary = {
    total_indices: indices.length,
    total_docs: 0,
    health_distribution: { green: 0, yellow: 0, red: 0 },
    status_distribution: { open: 0, close: 0 },
    detected_patterns: [],
  };

  // Calculate statistics
  for (const index of indices) {
    summary.total_docs += parseInt(index.docsCount || '0', 10);

    if (index.health === 'green') summary.health_distribution.green++;
    else if (index.health === 'yellow') summary.health_distribution.yellow++;
    else if (index.health === 'red') summary.health_distribution.red++;

    if (index.status === 'open') summary.status_distribution.open++;
    else if (index.status === 'close') summary.status_distribution.close++;
  }

  // Group by patterns
  const groups = groupIndicesByPattern(indices);
  
  for (const [pattern, group] of groups.entries()) {
    const patternInfo: any = {
      pattern: pattern === 'other' ? 'other (non-time-series)' : `${pattern}-*`,
      count: group.count,
      sample_indices: group.indices.slice(0, 3).map(i => i.index),
    };

    if (group.dateRange) {
      patternInfo.date_range = `${group.dateRange.earliest} to ${group.dateRange.latest}`;
    }

    summary.detected_patterns.push(patternInfo);
  }

  // Sort patterns by count (descending)
  summary.detected_patterns.sort((a, b) => b.count - a.count);

  return summary;
}

/**
 * Format summary as human-readable text (Full mode)
 */
export function formatSummaryText(summary: IndexSummary): string {
  let text = `📊 Index Summary (Full)\n`;
  text += `${'='.repeat(60)}\n\n`;
  
  text += `Total Indices: ${summary.total_indices}\n`;
  text += `Total Documents: ${summary.total_docs.toLocaleString()}\n\n`;
  
  text += `Health Status:\n`;
  text += `  🟢 Green:  ${summary.health_distribution.green}\n`;
  text += `  🟡 Yellow: ${summary.health_distribution.yellow}\n`;
  text += `  🔴 Red:    ${summary.health_distribution.red}\n\n`;

  text += `Status:\n`;
  text += `  Open:   ${summary.status_distribution.open}\n`;
  text += `  Closed: ${summary.status_distribution.close}\n\n`;

  if (summary.detected_patterns.length > 0) {
    text += `Detected Patterns:\n`;
    text += `${'─'.repeat(60)}\n`;
    
    for (const pattern of summary.detected_patterns) {
      text += `\n📁 ${pattern.pattern}\n`;
      text += `   Count: ${pattern.count} indices\n`;
      if (pattern.date_range) {
        text += `   Date Range: ${pattern.date_range}\n`;
      }
      text += `   Sample: ${pattern.sample_indices.slice(0, 3).join(', ')}\n`;
      if (pattern.sample_indices.length > 3) {
        text += `           ... and ${pattern.count - 3} more\n`;
      }
    }
  }

  return text;
}

/**
 * Format compact summary (fewer details, top patterns only)
 */
export function formatCompactSummary(summary: IndexSummary, topN: number = 20): string {
  let text = `📊 Index Summary (Compact)\n`;
  text += `${'='.repeat(60)}\n\n`;
  
  // Single line overview
  text += `Total: ${summary.total_indices} indices | `;
  text += `${(summary.total_docs / 1_000_000_000).toFixed(2)}B docs | `;
  text += `Green: ${summary.health_distribution.green} | `;
  text += `Yellow: ${summary.health_distribution.yellow} | `;
  text += `Red: ${summary.health_distribution.red}\n\n`;

  if (summary.detected_patterns.length > 0) {
    text += `Top Patterns (by count):\n`;
    text += `${'─'.repeat(60)}\n`;
    
    const topPatterns = summary.detected_patterns.slice(0, topN);
    
    for (let i = 0; i < topPatterns.length; i++) {
      const pattern = topPatterns[i];
      const sample = pattern.sample_indices[0] || '';
      const shortSample = sample.length > 45 ? sample.substring(0, 42) + '...' : sample;
      
      text += `  ${(i + 1).toString().padStart(2)}. ${pattern.pattern.padEnd(30)} (${pattern.count})`;
      if (pattern.date_range) {
        text += `\n      📅 ${pattern.date_range}`;
      }
      if (shortSample) {
        text += `\n      📄 ${shortSample}`;
      }
      text += `\n`;
    }
    
    if (summary.detected_patterns.length > topN) {
      text += `\n  ... and ${summary.detected_patterns.length - topN} more patterns\n`;
    }
  }

  return text;
}

/**
 * Format minimal summary (stats only, no pattern details)
 */
export function formatMinimalSummary(summary: IndexSummary): string {
  let text = `📊 Index Quick Stats\n`;
  text += `${'='.repeat(60)}\n\n`;
  
  text += `Total Indices: ${summary.total_indices.toLocaleString()}\n`;
  text += `Documents:     ${(summary.total_docs / 1_000_000_000).toFixed(2)} billion\n`;
  text += `Health:        Green: ${summary.health_distribution.green} | `;
  text += `Yellow: ${summary.health_distribution.yellow} | `;
  text += `Red: ${summary.health_distribution.red}\n\n`;

  if (summary.detected_patterns.length > 0) {
    text += `Major Categories:\n`;
    const topCategories = summary.detected_patterns.slice(0, 5);
    
    for (const cat of topCategories) {
      const name = cat.pattern.replace('-*', '').replace('other (non-time-series)', 'Other');
      text += `  • ${name.padEnd(25)} (${cat.count} indices)\n`;
    }
    
    if (summary.detected_patterns.length > 5) {
      const remaining = summary.detected_patterns.slice(5)
        .reduce((sum, p) => sum + p.count, 0);
      text += `  • Other patterns${' '.repeat(11)} (${remaining} indices)\n`;
    }
  }

  text += `\n⚠️  Too many indices to display full details.\n\n`;
  text += `Next Steps:\n`;
  text += `  1. Filter by pattern: pattern="your-pattern-*"\n`;
  text += `  2. Filter by health: health_filter="red" or "yellow"\n`;
  text += `  3. See more details: summary_level="compact"\n`;

  return text;
}

/**
 * Generate suggestions based on index analysis
 */
export function generateSuggestions(
  summary: IndexSummary,
  hasPattern: boolean
): string {
  const suggestions: string[] = [];

  if (!hasPattern && summary.detected_patterns.length > 0) {
    suggestions.push("💡 Use 'pattern' parameter to filter specific index groups:");
    
    for (const p of summary.detected_patterns.slice(0, 3)) {
      if (!p.pattern.includes('other')) {
        suggestions.push(`   - pattern: "${p.pattern.replace('*', '2024.*')}" (example)`);
      }
    }
  }

  if (summary.health_distribution.yellow > 0 || summary.health_distribution.red > 0) {
    suggestions.push("⚠️  Some indices have health issues:");
    if (summary.health_distribution.red > 0) {
      suggestions.push(`   - ${summary.health_distribution.red} red indices need attention`);
      suggestions.push(`   - Use health_filter: "red" to see only problematic indices`);
    }
    if (summary.health_distribution.yellow > 0) {
      suggestions.push(`   - ${summary.health_distribution.yellow} yellow indices may need monitoring`);
    }
  }

  if (summary.total_indices > 1000) {
    suggestions.push("📦 Large number of indices detected:");
    suggestions.push("   - Consider using Index Lifecycle Management (ILM)");
    suggestions.push("   - Use rollover or delete old indices to reduce cluster load");
  }

  return suggestions.length > 0 ? '\n' + suggestions.join('\n') : '';
}
