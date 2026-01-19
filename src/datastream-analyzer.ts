/**
 * Data Stream Analyzer - Intelligent analysis for Elasticsearch data streams
 * Provides health monitoring, rollover tracking, and optimization recommendations
 */

export interface BackingIndex {
  index: string;
  health?: string;
  status?: string;
  docs_count?: number;
  store_size?: string;
  creation_date?: string;
}

export interface DataStreamInfo {
  name: string;
  timestamp_field: string;
  indices_count: number;
  backing_indices: BackingIndex[];
  generation: number;
  status?: string;
  template?: string;
  ilm_policy?: string;
  hidden?: boolean;
}

export interface DataStreamStats {
  total_docs: number;
  total_size_bytes: number;
  total_size_gb: number;
  oldest_index?: string;
  newest_index?: string;
  creation_rate?: number; // docs per hour (estimated)
}

export interface DataStreamHealth {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  recommendations: string[];
  
  // Health metrics
  has_red_indices: boolean;
  has_yellow_indices: boolean;
  excessive_backing_indices: boolean; // > 200
  large_current_index: boolean; // Current index > 50GB
  rollover_issues: boolean;
}

export interface DataStreamSummary {
  name: string;
  stats: DataStreamStats;
  health: DataStreamHealth;
  config: {
    timestamp_field: string;
    indices_count: number;
    generation: number;
    ilm_policy?: string;
    template?: string;
  };
  backing_indices: BackingIndex[];
}

export interface DataStreamComparison {
  streams: string[];
  total_streams: number;
  total_indices: number;
  total_docs: number;
  total_size_gb: number;
  health_distribution: {
    healthy: number;
    warning: number;
    critical: number;
  };
  top_streams_by_size: Array<{ name: string; size_gb: number }>;
  top_streams_by_docs: Array<{ name: string; docs: number }>;
  streams_with_issues: Array<{ name: string; issues: string[] }>;
}

/**
 * Parse size string to bytes
 */
function parseSizeToBytes(sizeStr: string | null | undefined): number {
  if (!sizeStr) return 0;
  
  const match = sizeStr.match(/^([\d.]+)([kmgt]?b)$/i);
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers: Record<string, number> = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024,
    'tb': 1024 * 1024 * 1024 * 1024,
  };
  
  return value * (multipliers[unit] || 1);
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Calculate data stream statistics
 */
export function calculateDataStreamStats(
  backingIndices: BackingIndex[]
): DataStreamStats {
  let totalDocs = 0;
  let totalSizeBytes = 0;
  let oldestIndex: string | undefined;
  let newestIndex: string | undefined;
  let oldestDate = Number.MAX_SAFE_INTEGER;
  let newestDate = 0;

  for (const idx of backingIndices) {
    // Sum documents
    if (idx.docs_count) {
      totalDocs += idx.docs_count;
    }

    // Sum size
    if (idx.store_size) {
      totalSizeBytes += parseSizeToBytes(idx.store_size);
    }

    // Track oldest/newest
    if (idx.creation_date) {
      const date = new Date(idx.creation_date).getTime();
      if (date < oldestDate) {
        oldestDate = date;
        oldestIndex = idx.index;
      }
      if (date > newestDate) {
        newestDate = date;
        newestIndex = idx.index;
      }
    }
  }

  // Estimate creation rate (docs per hour)
  let creationRate: number | undefined;
  if (oldestDate !== Number.MAX_SAFE_INTEGER && newestDate > 0) {
    const ageHours = (newestDate - oldestDate) / (1000 * 60 * 60);
    if (ageHours > 0) {
      creationRate = Math.round(totalDocs / ageHours);
    }
  }

  return {
    total_docs: totalDocs,
    total_size_bytes: totalSizeBytes,
    total_size_gb: totalSizeBytes / (1024 * 1024 * 1024),
    oldest_index: oldestIndex,
    newest_index: newestIndex,
    creation_rate: creationRate,
  };
}

/**
 * Analyze data stream health
 */
export function analyzeDataStreamHealth(
  dsInfo: DataStreamInfo,
  stats: DataStreamStats
): DataStreamHealth {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';

  // Check backing indices health
  let hasRed = false;
  let hasYellow = false;

  for (const idx of dsInfo.backing_indices) {
    if (idx.health === 'red') {
      hasRed = true;
      issues.push(`Red index detected: ${idx.index}`);
    } else if (idx.health === 'yellow') {
      hasYellow = true;
    }
  }

  // Check for excessive backing indices
  const excessiveIndices = dsInfo.indices_count > 200;
  if (excessiveIndices) {
    issues.push(`Excessive backing indices: ${dsInfo.indices_count} (threshold: 200)`);
    recommendations.push('Review ILM policy delete phase or reduce retention period');
  }

  // Check current index size (assume last index is current)
  const currentIndex = dsInfo.backing_indices[dsInfo.backing_indices.length - 1];
  let largeCurrentIndex = false;
  if (currentIndex?.store_size) {
    const sizeGB = parseSizeToBytes(currentIndex.store_size) / (1024 * 1024 * 1024);
    if (sizeGB > 50) {
      largeCurrentIndex = true;
      issues.push(`Current index is large: ${formatBytes(parseSizeToBytes(currentIndex.store_size))}`);
      recommendations.push('Check ILM rollover conditions (max_size, max_docs, max_age)');
    }
  }

  // Check for rollover issues (too few or too many indices for the data volume)
  let rolloverIssues = false;
  if (dsInfo.indices_count < 5 && stats.total_size_gb > 100) {
    rolloverIssues = true;
    issues.push('Indices too large - rollover not occurring frequently enough');
    recommendations.push('Reduce ILM rollover thresholds (max_size: 50gb, max_age: 1d)');
  } else if (dsInfo.indices_count > 100 && stats.total_size_gb < 50) {
    rolloverIssues = true;
    issues.push('Too many small indices - rollover occurring too frequently');
    recommendations.push('Increase ILM rollover thresholds or reduce data retention');
  }

  // Check if ILM policy is configured
  if (!dsInfo.ilm_policy) {
    issues.push('No ILM policy configured');
    recommendations.push('Configure ILM policy for automatic lifecycle management');
  }

  // Determine overall status
  if (hasRed || excessiveIndices) {
    status = 'critical';
  } else if (hasYellow || largeCurrentIndex || rolloverIssues || !dsInfo.ilm_policy) {
    status = 'warning';
  }

  return {
    status,
    issues,
    recommendations,
    has_red_indices: hasRed,
    has_yellow_indices: hasYellow,
    excessive_backing_indices: excessiveIndices,
    large_current_index: largeCurrentIndex,
    rollover_issues: rolloverIssues,
  };
}

/**
 * Generate data stream summary
 */
export function generateDataStreamSummary(
  dsInfo: DataStreamInfo
): DataStreamSummary {
  const stats = calculateDataStreamStats(dsInfo.backing_indices);
  const health = analyzeDataStreamHealth(dsInfo, stats);

  return {
    name: dsInfo.name,
    stats,
    health,
    config: {
      timestamp_field: dsInfo.timestamp_field,
      indices_count: dsInfo.indices_count,
      generation: dsInfo.generation,
      ilm_policy: dsInfo.ilm_policy,
      template: dsInfo.template,
    },
    backing_indices: dsInfo.backing_indices,
  };
}

/**
 * Format data stream summary in minimal mode
 */
export function formatMinimal(summary: DataStreamSummary): string {
  const { name, stats, health, config } = summary;
  
  const healthIcon = 
    health.status === 'healthy' ? '✓' :
    health.status === 'warning' ? '⚠' : '✗';
  
  let text = `${healthIcon} ${name}\n`;
  text += `   Indices: ${config.indices_count} | `;
  text += `Docs: ${stats.total_docs.toLocaleString()} | `;
  text += `Size: ${stats.total_size_gb.toFixed(2)} GB\n`;
  
  if (config.ilm_policy) {
    text += `   ILM: ${config.ilm_policy}\n`;
  }
  
  if (health.issues.length > 0) {
    text += `   Issues: ${health.issues.slice(0, 2).join('; ')}`;
    if (health.issues.length > 2) {
      text += ` (+${health.issues.length - 2} more)`;
    }
    text += '\n';
  }
  
  return text;
}

/**
 * Format data stream summary in compact mode
 */
export function formatCompact(summary: DataStreamSummary): string {
  const { name, stats, health, config, backing_indices } = summary;
  
  let text = `${'='.repeat(70)}\n`;
  text += `Data Stream: ${name}\n`;
  text += `${'='.repeat(70)}\n\n`;
  
  // Status
  const statusEmoji = 
    health.status === 'healthy' ? '✓ Healthy' :
    health.status === 'warning' ? '⚠ Warning' : '✗ Critical';
  text += `Status: ${statusEmoji}\n\n`;
  
  // Configuration
  text += `Configuration:\n`;
  text += `  Timestamp Field:  ${config.timestamp_field}\n`;
  text += `  Backing Indices:  ${config.indices_count}\n`;
  text += `  Generation:       ${config.generation}\n`;
  text += `  ILM Policy:       ${config.ilm_policy || 'None'}\n`;
  text += `  Template:         ${config.template || 'N/A'}\n\n`;
  
  // Statistics
  text += `Statistics:\n`;
  text += `  Total Documents:  ${stats.total_docs.toLocaleString()}\n`;
  text += `  Total Size:       ${stats.total_size_gb.toFixed(2)} GB\n`;
  
  if (stats.creation_rate) {
    text += `  Ingestion Rate:   ~${stats.creation_rate.toLocaleString()} docs/hour\n`;
  }
  
  if (stats.oldest_index) {
    text += `  Oldest Index:     ${stats.oldest_index}\n`;
  }
  if (stats.newest_index) {
    text += `  Newest Index:     ${stats.newest_index}\n`;
  }
  text += '\n';
  
  // Recent backing indices (show last 10)
  text += `Recent Backing Indices (last 10):\n`;
  const recentIndices = backing_indices.slice(-10).reverse();
  for (const idx of recentIndices) {
    const healthIcon = 
      idx.health === 'green' ? '🟢' :
      idx.health === 'yellow' ? '🟡' : '🔴';
    
    text += `  ${healthIcon} ${idx.index}`;
    if (idx.docs_count !== undefined) {
      text += ` | ${idx.docs_count.toLocaleString()} docs`;
    }
    if (idx.store_size) {
      text += ` | ${idx.store_size}`;
    }
    text += '\n';
  }
  
  if (backing_indices.length > 10) {
    text += `  ... and ${backing_indices.length - 10} more indices\n`;
  }
  text += '\n';
  
  // Health issues
  if (health.issues.length > 0) {
    text += `Issues:\n`;
    for (const issue of health.issues) {
      text += `  ✗ ${issue}\n`;
    }
    text += '\n';
  }
  
  // Recommendations
  if (health.recommendations.length > 0) {
    text += `Recommendations:\n`;
    for (const rec of health.recommendations) {
      text += `  → ${rec}\n`;
    }
  }
  
  return text;
}

/**
 * Generate comparison summary for multiple data streams
 */
export function compareDataStreams(
  summaries: DataStreamSummary[]
): DataStreamComparison {
  let totalIndices = 0;
  let totalDocs = 0;
  let totalSizeGB = 0;
  
  const healthDistribution = { healthy: 0, warning: 0, critical: 0 };
  const streamsBySize: Array<{ name: string; size_gb: number }> = [];
  const streamsByDocs: Array<{ name: string; docs: number }> = [];
  const streamsWithIssues: Array<{ name: string; issues: string[] }> = [];
  
  for (const summary of summaries) {
    totalIndices += summary.config.indices_count;
    totalDocs += summary.stats.total_docs;
    totalSizeGB += summary.stats.total_size_gb;
    
    healthDistribution[summary.health.status]++;
    
    streamsBySize.push({
      name: summary.name,
      size_gb: summary.stats.total_size_gb,
    });
    
    streamsByDocs.push({
      name: summary.name,
      docs: summary.stats.total_docs,
    });
    
    if (summary.health.issues.length > 0) {
      streamsWithIssues.push({
        name: summary.name,
        issues: summary.health.issues,
      });
    }
  }
  
  // Sort by size and docs
  streamsBySize.sort((a, b) => b.size_gb - a.size_gb);
  streamsByDocs.sort((a, b) => b.docs - a.docs);
  
  return {
    streams: summaries.map(s => s.name),
    total_streams: summaries.length,
    total_indices: totalIndices,
    total_docs: totalDocs,
    total_size_gb: totalSizeGB,
    health_distribution: healthDistribution,
    top_streams_by_size: streamsBySize.slice(0, 10),
    top_streams_by_docs: streamsByDocs.slice(0, 10),
    streams_with_issues: streamsWithIssues,
  };
}

/**
 * Format comparison result
 */
export function formatComparison(comparison: DataStreamComparison): string {
  let text = `Data Streams Overview\n`;
  text += `${'='.repeat(70)}\n\n`;
  
  text += `Total Streams:   ${comparison.total_streams}\n`;
  text += `Total Indices:   ${comparison.total_indices.toLocaleString()}\n`;
  text += `Total Documents: ${comparison.total_docs.toLocaleString()}\n`;
  text += `Total Size:      ${comparison.total_size_gb.toFixed(2)} GB\n\n`;
  
  // Health distribution
  text += `Health Distribution:\n`;
  text += `  ✓ Healthy:  ${comparison.health_distribution.healthy}\n`;
  text += `  ⚠ Warning:  ${comparison.health_distribution.warning}\n`;
  text += `  ✗ Critical: ${comparison.health_distribution.critical}\n\n`;
  
  // Top by size
  if (comparison.top_streams_by_size.length > 0) {
    text += `Largest Streams:\n`;
    for (let i = 0; i < Math.min(5, comparison.top_streams_by_size.length); i++) {
      const stream = comparison.top_streams_by_size[i];
      text += `  ${i + 1}. ${stream.name} - ${stream.size_gb.toFixed(2)} GB\n`;
    }
    text += '\n';
  }
  
  // Top by docs
  if (comparison.top_streams_by_docs.length > 0) {
    text += `Most Documents:\n`;
    for (let i = 0; i < Math.min(5, comparison.top_streams_by_docs.length); i++) {
      const stream = comparison.top_streams_by_docs[i];
      text += `  ${i + 1}. ${stream.name} - ${stream.docs.toLocaleString()} docs\n`;
    }
    text += '\n';
  }
  
  // Streams with issues
  if (comparison.streams_with_issues.length > 0) {
    text += `Streams Requiring Attention (${comparison.streams_with_issues.length}):\n`;
    for (const stream of comparison.streams_with_issues.slice(0, 5)) {
      text += `\n  ✗ ${stream.name}:\n`;
      for (const issue of stream.issues.slice(0, 3)) {
        text += `    - ${issue}\n`;
      }
    }
    
    if (comparison.streams_with_issues.length > 5) {
      text += `\n  ... and ${comparison.streams_with_issues.length - 5} more streams with issues\n`;
    }
  }
  
  return text;
}
