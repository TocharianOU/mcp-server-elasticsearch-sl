/**
 * Shard Analyzer - Elasticsearch shard health analysis and optimization recommendations
 * Phase 1: Core health checks and token optimization
 */

interface ShardInfo {
  index?: string;
  shard?: string;
  prirep?: string; // 'p' for primary, 'r' for replica
  state?: string;
  docs?: string | null;
  store?: string | null;
  ip?: string | null;
  node?: string | null;
}

interface ShardHealthMetrics {
  total_shards: number;
  primary_shards: number;
  replica_shards: number;
  
  // State distribution
  states: {
    started: number;
    initializing: number;
    relocating: number;
    unassigned: number;
  };
  
  // Size health
  size_health: {
    optimal: number;      // 10-50GB
    large: number;        // 50-100GB
    oversized: number;    // >100GB
    small: number;        // <1GB
    unknown: number;      // no size data
  };
  
  // Document count health
  docs_health: {
    healthy: number;      // <100M
    warning: number;      // 100M-200M
    critical: number;     // >200M
    unknown: number;      // no doc count
  };
  
  // Problem shards
  problem_shards: {
    unassigned: ShardInfo[];
    oversized: ShardInfo[];
    over_documented: ShardInfo[];
    initializing_long: ShardInfo[];
  };
  
  // Index-level issues
  index_issues: {
    over_sharded: Array<{ index: string; shard_count: number; total_size_gb: number }>;
    unbalanced: Array<{ index: string; reason: string }>;
  };
  
  // Hot shard detection (Phase 2.2)
  hot_shards: {
    size_imbalanced: Array<{
      index: string;
      shard: string;
      size_gb: number;
      avg_size_gb: number;
      ratio: number;
    }>;
    node_overloaded: Array<{
      node: string;
      shard_count: number;
      avg_count: number;
    }>;
  };
  
  // Replica strategy analysis (Phase 2.3)
  replica_analysis: {
    by_replica_count: {
      zero: number;    // no replicas (risky!)
      one: number;     // 1 replica (recommended)
      two_plus: number; // 2+ replicas (may be excessive)
    };
    same_node_issues: Array<{
      index: string;
      shard: string;
      issue: string;
    }>;
    total_replica_overhead_gb: number;
  };
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
 * Parse document count string to number
 */
function parseDocsToNumber(docsStr: string | null | undefined): number {
  if (!docsStr) return 0;
  return parseInt(docsStr, 10) || 0;
}

/**
 * Analyze shard health
 */
export function analyzeShardHealth(
  shards: ShardInfo[],
  sizeThresholdGB: number = 50,
  docsThresholdM: number = 200
): ShardHealthMetrics {
  const metrics: ShardHealthMetrics = {
    total_shards: shards.length,
    primary_shards: 0,
    replica_shards: 0,
    states: { started: 0, initializing: 0, relocating: 0, unassigned: 0 },
    size_health: { optimal: 0, large: 0, oversized: 0, small: 0, unknown: 0 },
    docs_health: { healthy: 0, warning: 0, critical: 0, unknown: 0 },
    problem_shards: {
      unassigned: [],
      oversized: [],
      over_documented: [],
      initializing_long: [],
    },
    index_issues: {
      over_sharded: [],
      unbalanced: [],
    },
    hot_shards: {
      size_imbalanced: [],
      node_overloaded: [],
    },
    replica_analysis: {
      by_replica_count: { zero: 0, one: 0, two_plus: 0 },
      same_node_issues: [],
      total_replica_overhead_gb: 0,
    },
  };

  const indexStats = new Map<string, { shards: number; totalSize: number; maxDocs: number }>();
  const nodeShardCount = new Map<string, number>();
  const indexShardSizes = new Map<string, number[]>();

  for (const shard of shards) {
    // Skip if missing essential data
    if (!shard.index || !shard.shard) continue;
    
    // Count primary vs replica
    if (shard.prirep === 'p') {
      metrics.primary_shards++;
    } else {
      metrics.replica_shards++;
    }

    // State analysis
    const state = shard.state?.toLowerCase() || '';
    if (state === 'started') metrics.states.started++;
    else if (state === 'initializing') metrics.states.initializing++;
    else if (state === 'relocating') metrics.states.relocating++;
    else if (state === 'unassigned') {
      metrics.states.unassigned++;
      metrics.problem_shards.unassigned.push(shard);
    }

    // Only analyze started primary shards for size/docs (replicas will match)
    if (shard.prirep === 'p' && state === 'started') {
      const sizeBytes = parseSizeToBytes(shard.store);
      const sizeGB = sizeBytes / (1024 * 1024 * 1024);
      const docs = parseDocsToNumber(shard.docs);

      // Size health
      if (sizeBytes === 0) {
        metrics.size_health.unknown++;
      } else if (sizeGB > 100) {
        metrics.size_health.oversized++;
        metrics.problem_shards.oversized.push(shard);
      } else if (sizeGB > sizeThresholdGB) {
        metrics.size_health.large++;
      } else if (sizeGB >= 10) {
        metrics.size_health.optimal++;
      } else {
        metrics.size_health.small++;
      }

      // Docs health
      if (docs === 0) {
        metrics.docs_health.unknown++;
      } else if (docs > docsThresholdM * 1_000_000) {
        metrics.docs_health.critical++;
        metrics.problem_shards.over_documented.push(shard);
      } else if (docs > 100_000_000) {
        metrics.docs_health.warning++;
      } else {
        metrics.docs_health.healthy++;
      }

      // Collect index stats
      if (!indexStats.has(shard.index)) {
        indexStats.set(shard.index, { shards: 0, totalSize: 0, maxDocs: 0 });
      }
      const stats = indexStats.get(shard.index)!;
      stats.shards++;
      stats.totalSize += sizeGB;
      stats.maxDocs = Math.max(stats.maxDocs, docs);
      
      // Track shard sizes per index for hotspot detection
      if (!indexShardSizes.has(shard.index)) {
        indexShardSizes.set(shard.index, []);
      }
      indexShardSizes.get(shard.index)!.push(sizeGB);
    }
    
    // Count shards per node
    if (shard.node && state === 'started') {
      nodeShardCount.set(shard.node, (nodeShardCount.get(shard.node) || 0) + 1);
    }
  }

  // Detect over-sharding (many small shards)
  for (const [index, stats] of indexStats.entries()) {
    const avgShardSize = stats.totalSize / stats.shards;
    if (stats.shards >= 5 && avgShardSize < 1) {
      metrics.index_issues.over_sharded.push({
        index,
        shard_count: stats.shards,
        total_size_gb: stats.totalSize,
      });
    }
  }

  // Phase 2.2: Detect hot shards (size imbalance within same index)
  metrics.hot_shards = {
    size_imbalanced: [],
    node_overloaded: [],
  };

  for (const [index, sizes] of indexShardSizes.entries()) {
    if (sizes.length < 2) continue; // Need at least 2 shards to compare
    
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const maxSize = Math.max(...sizes);
    
    // If max shard is 3x larger than average, it's a hotspot
    if (maxSize > avgSize * 3 && avgSize > 1) {
      // Find which shard is the hot one
      for (const shard of shards) {
        if (shard.index === index && shard.prirep === 'p') {
          const shardSize = parseSizeToBytes(shard.store) / (1024 ** 3);
          if (shardSize > avgSize * 2.5) {
            metrics.hot_shards.size_imbalanced.push({
              index,
              shard: shard.shard || '?',
              size_gb: shardSize,
              avg_size_gb: avgSize,
              ratio: shardSize / avgSize,
            });
          }
        }
      }
    }
  }

  // Detect overloaded nodes (nodes with significantly more shards than average)
  if (nodeShardCount.size > 0) {
    const avgShardsPerNode = Array.from(nodeShardCount.values()).reduce((a, b) => a + b, 0) / nodeShardCount.size;
    
    for (const [node, count] of nodeShardCount.entries()) {
      if (count > avgShardsPerNode * 1.5 && count > 50) {
        metrics.hot_shards.node_overloaded.push({
          node,
          shard_count: count,
          avg_count: avgShardsPerNode,
        });
      }
    }
  }

  // Phase 2.3: Analyze replica strategy
  metrics.replica_analysis = {
    by_replica_count: { zero: 0, one: 0, two_plus: 0 },
    same_node_issues: [],
    total_replica_overhead_gb: 0,
  };

  // Count replicas per index and detect same-node placement issues
  const indexReplicaConfig = new Map<string, { replicas: number; primaryNodes: Set<string>; replicaNodes: Set<string> }>();

  for (const shard of shards) {
    if (!shard.index || !shard.state || shard.state !== 'STARTED') continue;
    
    if (!indexReplicaConfig.has(shard.index)) {
      indexReplicaConfig.set(shard.index, {
        replicas: 0,
        primaryNodes: new Set(),
        replicaNodes: new Set(),
      });
    }
    
    const config = indexReplicaConfig.get(shard.index)!;
    
    if (shard.prirep === 'p' && shard.node) {
      config.primaryNodes.add(shard.node);
    } else if (shard.prirep === 'r' && shard.node) {
      config.replicaNodes.add(shard.node);
      config.replicas++;
      
      // Calculate replica overhead
      const replicaSize = parseSizeToBytes(shard.store) / (1024 ** 3);
      metrics.replica_analysis.total_replica_overhead_gb += replicaSize;
    }
  }

  // Analyze replica counts and detect same-node issues
  for (const [index, config] of indexReplicaConfig.entries()) {
    // Estimate replica count per shard
    const primaryCount = config.primaryNodes.size || 1;
    const replicasPerShard = config.replicas / primaryCount;
    
    if (replicasPerShard < 0.5) {
      metrics.replica_analysis.by_replica_count.zero++;
    } else if (replicasPerShard < 1.5) {
      metrics.replica_analysis.by_replica_count.one++;
    } else {
      metrics.replica_analysis.by_replica_count.two_plus++;
    }
    
    // Check for same-node placement (primary and replica on same node)
    const overlap = new Set([...config.primaryNodes].filter(n => config.replicaNodes.has(n)));
    if (overlap.size > 0) {
      metrics.replica_analysis.same_node_issues.push({
        index,
        shard: '(multiple)',
        issue: `Primary and replica on same node(s): ${Array.from(overlap).join(', ')}`,
      });
    }
  }

  return metrics;
}

/**
 * Format summary analysis
 */
export function formatShardSummary(metrics: ShardHealthMetrics): string {
  let text = `📊 Shard Health Summary\n`;
  text += `${'='.repeat(60)}\n\n`;

  // Overview
  text += `Total Shards:     ${metrics.total_shards.toLocaleString()} `;
  text += `(primary: ${metrics.primary_shards.toLocaleString()} | `;
  text += `replica: ${metrics.replica_shards.toLocaleString()})\n`;

  // Status
  const healthEmoji = metrics.states.unassigned === 0 ? '🟢' : '🔴';
  text += `Status:           ${healthEmoji} Started: ${metrics.states.started.toLocaleString()}`;
  if (metrics.states.unassigned > 0) {
    text += ` | 🔴 Unassigned: ${metrics.states.unassigned}`;
  }
  if (metrics.states.initializing > 0) {
    text += ` | 🟡 Initializing: ${metrics.states.initializing}`;
  }
  if (metrics.states.relocating > 0) {
    text += ` | 🔄 Relocating: ${metrics.states.relocating}`;
  }
  text += `\n\n`;

  // Size health (only for primary shards)
  text += `Size Health (Primary Shards):\n`;
  const totalAnalyzed = metrics.size_health.optimal + metrics.size_health.large + 
                       metrics.size_health.oversized + metrics.size_health.small;
  
  if (totalAnalyzed > 0) {
    const optimalPct = ((metrics.size_health.optimal / totalAnalyzed) * 100).toFixed(1);
    text += `  🟢 Optimal (10-50GB):      ${metrics.size_health.optimal.toLocaleString()} shards (${optimalPct}%)\n`;
    
    if (metrics.size_health.large > 0) {
      const largePct = ((metrics.size_health.large / totalAnalyzed) * 100).toFixed(1);
      text += `  🟡 Large (50-100GB):       ${metrics.size_health.large.toLocaleString()} shards (${largePct}%)\n`;
    }
    
    if (metrics.size_health.oversized > 0) {
      const oversizedPct = ((metrics.size_health.oversized / totalAnalyzed) * 100).toFixed(1);
      text += `  🔴 Oversized (>100GB):     ${metrics.size_health.oversized.toLocaleString()} shards (${oversizedPct}%) ⚠️\n`;
    }
    
    if (metrics.size_health.small > 0) {
      const smallPct = ((metrics.size_health.small / totalAnalyzed) * 100).toFixed(1);
      text += `  ⚪ Small (<10GB):          ${metrics.size_health.small.toLocaleString()} shards (${smallPct}%)\n`;
    }
  }
  text += `\n`;

  // Document health
  text += `Document Health (Primary Shards):\n`;
  const totalDocs = metrics.docs_health.healthy + metrics.docs_health.warning + metrics.docs_health.critical;
  
  if (totalDocs > 0) {
    const healthyPct = ((metrics.docs_health.healthy / totalDocs) * 100).toFixed(1);
    text += `  🟢 Healthy (<100M):        ${metrics.docs_health.healthy.toLocaleString()} shards (${healthyPct}%)\n`;
    
    if (metrics.docs_health.warning > 0) {
      const warningPct = ((metrics.docs_health.warning / totalDocs) * 100).toFixed(1);
      text += `  🟡 Warning (100-200M):     ${metrics.docs_health.warning.toLocaleString()} shards (${warningPct}%)\n`;
    }
    
    if (metrics.docs_health.critical > 0) {
      const criticalPct = ((metrics.docs_health.critical / totalDocs) * 100).toFixed(1);
      text += `  🔴 Critical (>200M):       ${metrics.docs_health.critical.toLocaleString()} shards (${criticalPct}%) ⚠️\n`;
    }
  }
  text += `\n`;

  // Problem summary
  const totalProblems = metrics.problem_shards.unassigned.length +
                       metrics.problem_shards.oversized.length +
                       metrics.problem_shards.over_documented.length +
                       metrics.index_issues.over_sharded.length;

  if (totalProblems > 0) {
    text += `Problem Summary:\n`;
    if (metrics.problem_shards.unassigned.length > 0) {
      const affectedIndices = new Set(metrics.problem_shards.unassigned.map(s => s.index)).size;
      text += `  ├─ ${metrics.problem_shards.unassigned.length} unassigned shards (${affectedIndices} indices) 🔴\n`;
    }
    if (metrics.problem_shards.oversized.length > 0) {
      text += `  ├─ ${metrics.problem_shards.oversized.length} oversized shards (>100GB) 🔴\n`;
    }
    if (metrics.problem_shards.over_documented.length > 0) {
      text += `  ├─ ${metrics.problem_shards.over_documented.length} over-documented shards (>200M docs) 🔴\n`;
    }
    if (metrics.index_issues.over_sharded.length > 0) {
      text += `  ├─ ${metrics.index_issues.over_sharded.length} indices with potential over-sharding 🟡\n`;
    }
    if (metrics.hot_shards.size_imbalanced.length > 0) {
      text += `  ├─ ${metrics.hot_shards.size_imbalanced.length} hot shards (size imbalanced) 🔥\n`;
    }
    if (metrics.hot_shards.node_overloaded.length > 0) {
      text += `  ├─ ${metrics.hot_shards.node_overloaded.length} overloaded nodes 🔥\n`;
    }
    if (metrics.replica_analysis.same_node_issues.length > 0) {
      text += `  └─ ${metrics.replica_analysis.same_node_issues.length} indices with replica placement issues 🟡\n`;
    }
    text += `\n`;
  }

  // Phase 2.3: Replica strategy summary
  text += `Replica Strategy:\n`;
  const totalIndices = metrics.replica_analysis.by_replica_count.zero +
                      metrics.replica_analysis.by_replica_count.one +
                      metrics.replica_analysis.by_replica_count.two_plus;
  
  if (totalIndices > 0) {
    if (metrics.replica_analysis.by_replica_count.zero > 0) {
      const pct = ((metrics.replica_analysis.by_replica_count.zero / totalIndices) * 100).toFixed(1);
      text += `  ⚠️  No replicas:   ${metrics.replica_analysis.by_replica_count.zero} indices (${pct}%)\n`;
    }
    if (metrics.replica_analysis.by_replica_count.one > 0) {
      const pct = ((metrics.replica_analysis.by_replica_count.one / totalIndices) * 100).toFixed(1);
      text += `  ✅ 1 replica:     ${metrics.replica_analysis.by_replica_count.one} indices (${pct}%)\n`;
    }
    if (metrics.replica_analysis.by_replica_count.two_plus > 0) {
      const pct = ((metrics.replica_analysis.by_replica_count.two_plus / totalIndices) * 100).toFixed(1);
      text += `  🟡 2+ replicas:   ${metrics.replica_analysis.by_replica_count.two_plus} indices (${pct}%)\n`;
    }
    text += `  Total replica overhead: ${metrics.replica_analysis.total_replica_overhead_gb.toFixed(2)} GB\n`;
  }
  text += `\n`;

  return text;
}

/**
 * Format detailed problems
 */
export function formatShardProblems(metrics: ShardHealthMetrics): string {
  let text = `📊 Shard Problems Detailed Analysis\n`;
  text += `${'='.repeat(60)}\n\n`;

  let hasProblems = false;

  // Unassigned shards
  if (metrics.problem_shards.unassigned.length > 0) {
    hasProblems = true;
    text += `🔴 CRITICAL: Unassigned Shards (${metrics.problem_shards.unassigned.length} total)\n`;
    text += `${'─'.repeat(60)}\n`;
    
    // Group by index
    const byIndex = new Map<string, ShardInfo[]>();
    for (const shard of metrics.problem_shards.unassigned) {
      if (!shard.index) continue;
      if (!byIndex.has(shard.index)) {
        byIndex.set(shard.index, []);
      }
      byIndex.get(shard.index)!.push(shard);
    }
    
    let count = 0;
    for (const [index, shards] of byIndex.entries()) {
      if (count >= 10) {
        text += `\n... and ${byIndex.size - 10} more indices with unassigned shards\n`;
        break;
      }
      const shardNums = shards.map(s => s.shard).join(', ');
      const types = shards.map(s => s.prirep).join(',');
      text += `\nIndex: ${index}\n`;
      text += `  • Shards: [${shardNums}] (${types === 'p' ? 'primary' : 'replicas'})\n`;
      text += `  • Count: ${shards.length}\n`;
      count++;
    }
    text += `\n`;
  }

  // Oversized shards
  if (metrics.problem_shards.oversized.length > 0) {
    hasProblems = true;
    text += `🔴 CRITICAL: Oversized Shards (>100GB)\n`;
    text += `${'─'.repeat(60)}\n`;
    
    const sorted = [...metrics.problem_shards.oversized]
      .sort((a, b) => parseSizeToBytes(b.store) - parseSizeToBytes(a.store))
      .slice(0, 10);
    
    for (const shard of sorted) {
      const sizeGB = (parseSizeToBytes(shard.store) / (1024 ** 3)).toFixed(2);
      const docs = parseDocsToNumber(shard.docs);
      text += `\n${shard.index}[${shard.shard}]\n`;
      text += `  • Size: ${sizeGB} GB\n`;
      text += `  • Docs: ${docs.toLocaleString()}\n`;
      text += `  • Node: ${shard.node || 'N/A'}\n`;
    }
    
    if (metrics.problem_shards.oversized.length > 10) {
      text += `\n... and ${metrics.problem_shards.oversized.length - 10} more oversized shards\n`;
    }
    text += `\n`;
  }

  // Over-documented shards
  if (metrics.problem_shards.over_documented.length > 0) {
    hasProblems = true;
    text += `🔴 CRITICAL: Over-Documented Shards (>200M docs)\n`;
    text += `${'─'.repeat(60)}\n`;
    
    const sorted = [...metrics.problem_shards.over_documented]
      .sort((a, b) => parseDocsToNumber(b.docs) - parseDocsToNumber(a.docs))
      .slice(0, 10);
    
    for (const shard of sorted) {
      const docs = parseDocsToNumber(shard.docs);
      const sizeGB = (parseSizeToBytes(shard.store) / (1024 ** 3)).toFixed(2);
      text += `\n${shard.index}[${shard.shard}]\n`;
      text += `  • Docs: ${(docs / 1_000_000).toFixed(1)}M\n`;
      text += `  • Size: ${sizeGB} GB\n`;
      text += `  • Node: ${shard.node || 'N/A'}\n`;
    }
    
    if (metrics.problem_shards.over_documented.length > 10) {
      text += `\n... and ${metrics.problem_shards.over_documented.length - 10} more over-documented shards\n`;
    }
    text += `\n`;
  }

  // Over-sharded indices
  if (metrics.index_issues.over_sharded.length > 0) {
    hasProblems = true;
    text += `🟡 WARNING: Over-Sharded Indices\n`;
    text += `${'─'.repeat(60)}\n`;
    
    const sorted = [...metrics.index_issues.over_sharded]
      .sort((a, b) => b.shard_count - a.shard_count)
      .slice(0, 10);
    
    for (const issue of sorted) {
      const avgSize = (issue.total_size_gb / issue.shard_count).toFixed(2);
      text += `\n${issue.index}\n`;
      text += `  • Shard Count: ${issue.shard_count}\n`;
      text += `  • Total Size: ${issue.total_size_gb.toFixed(2)} GB\n`;
      text += `  • Avg Per Shard: ${avgSize} GB (too small!)\n`;
    }
    
    if (metrics.index_issues.over_sharded.length > 10) {
      text += `\n... and ${metrics.index_issues.over_sharded.length - 10} more over-sharded indices\n`;
    }
    text += `\n`;
  }

  // Phase 2.2: Hot shards
  if (metrics.hot_shards.size_imbalanced.length > 0) {
    hasProblems = true;
    text += `🔥 WARNING: Hot Shards (Size Imbalanced)\n`;
    text += `${'─'.repeat(60)}\n`;
    
    const sorted = [...metrics.hot_shards.size_imbalanced]
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 10);
    
    for (const hot of sorted) {
      text += `\n${hot.index}[${hot.shard}]\n`;
      text += `  • Size: ${hot.size_gb.toFixed(2)} GB (${hot.ratio.toFixed(1)}x larger than avg)\n`;
      text += `  • Avg shard size: ${hot.avg_size_gb.toFixed(2)} GB\n`;
      text += `  • Impact: Performance bottleneck, uneven load\n`;
    }
    
    if (metrics.hot_shards.size_imbalanced.length > 10) {
      text += `\n... and ${metrics.hot_shards.size_imbalanced.length - 10} more hot shards\n`;
    }
    text += `\n`;
  }

  if (metrics.hot_shards.node_overloaded.length > 0) {
    hasProblems = true;
    text += `🔥 WARNING: Overloaded Nodes\n`;
    text += `${'─'.repeat(60)}\n`;
    
    const sorted = [...metrics.hot_shards.node_overloaded]
      .sort((a, b) => b.shard_count - a.shard_count)
      .slice(0, 5);
    
    for (const node of sorted) {
      const ratio = (node.shard_count / node.avg_count).toFixed(1);
      text += `\n${node.node}\n`;
      text += `  • Shards: ${node.shard_count} (${ratio}x more than avg ${node.avg_count.toFixed(0)})\n`;
      text += `  • Impact: Node resource strain, uneven cluster load\n`;
    }
    text += `\n`;
  }

  // Phase 2.3: Replica issues
  if (metrics.replica_analysis.same_node_issues.length > 0) {
    hasProblems = true;
    text += `🟡 WARNING: Replica Placement Issues\n`;
    text += `${'─'.repeat(60)}\n`;
    
    for (const issue of metrics.replica_analysis.same_node_issues.slice(0, 5)) {
      text += `\n${issue.index}\n`;
      text += `  • ${issue.issue}\n`;
      text += `  • Impact: No redundancy if node fails\n`;
    }
    
    if (metrics.replica_analysis.same_node_issues.length > 5) {
      text += `\n... and ${metrics.replica_analysis.same_node_issues.length - 5} more indices\n`;
    }
    text += `\n`;
  }

  if (!hasProblems) {
    text += `🎉 No critical problems detected!\n\n`;
    text += `Your cluster's shard configuration looks healthy.\n`;
  }

  return text;
}

/**
 * Generate optimization recommendations
 */
export function generateShardRecommendations(metrics: ShardHealthMetrics): string {
  let text = `\n🔧 Optimization Recommendations:\n`;
  text += `${'─'.repeat(60)}\n`;

  const recommendations: string[] = [];

  // Unassigned shards
  if (metrics.problem_shards.unassigned.length > 0) {
    const affectedIndices = new Set(metrics.problem_shards.unassigned.map(s => s.index));
    recommendations.push(
      `[HIGH] Fix ${metrics.problem_shards.unassigned.length} Unassigned Shards\n` +
      `   Affected: ${affectedIndices.size} indices\n` +
      `   Action: Check cluster allocation explain\n` +
      `   Command: GET _cluster/allocation/explain`
    );
  }

  // Oversized shards
  if (metrics.problem_shards.oversized.length > 0) {
    recommendations.push(
      `[HIGH] Split ${metrics.problem_shards.oversized.length} Oversized Shards (>100GB)\n` +
      `   Impact: Performance bottleneck, slow queries\n` +
      `   Action: Consider splitting indices by time (daily/weekly)\n` +
      `   Tip: Use Rollover API for time-series data`
    );
  }

  // Over-documented shards
  if (metrics.problem_shards.over_documented.length > 0) {
    recommendations.push(
      `[HIGH] Rebalance ${metrics.problem_shards.over_documented.length} Over-Documented Shards (>200M docs)\n` +
      `   Impact: Reduced query performance, merge overhead\n` +
      `   Action: Increase shard count or split by time period\n` +
      `   Target: Keep doc count under 200M per shard`
    );
  }

  // Over-sharding
  if (metrics.index_issues.over_sharded.length > 0) {
    const totalWasted = metrics.index_issues.over_sharded.reduce((sum, i) => sum + i.shard_count - 1, 0);
    recommendations.push(
      `[MEDIUM] Reduce Over-Sharding in ${metrics.index_issues.over_sharded.length} Indices\n` +
      `   Impact: Wasting cluster resources\n` +
      `   Action: Shrink to 1-2 shards using Shrink API\n` +
      `   Est. Savings: ~${totalWasted} shards, reduced memory overhead`
    );
  }

  // Large shards warning
  if (metrics.size_health.large > 0) {
    recommendations.push(
      `[LOW] Monitor ${metrics.size_health.large} Large Shards (50-100GB)\n` +
      `   Status: Approaching size limit\n` +
      `   Action: Plan for future reindexing or splitting\n` +
      `   Note: Keep shards under 50GB for optimal performance`
    );
  }

  // Phase 2.2: Hot shard recommendations
  if (metrics.hot_shards.size_imbalanced.length > 0) {
    recommendations.push(
      `[HIGH] Rebalance ${metrics.hot_shards.size_imbalanced.length} Hot Shards\n` +
      `   Impact: Performance bottleneck, slow queries on hot shards\n` +
      `   Action: Reindex with better shard key or increase shard count\n` +
      `   Tip: Consider using routing keys to distribute data evenly`
    );
  }

  if (metrics.hot_shards.node_overloaded.length > 0) {
    recommendations.push(
      `[MEDIUM] Rebalance ${metrics.hot_shards.node_overloaded.length} Overloaded Nodes\n` +
      `   Impact: Uneven resource usage, potential node failure risk\n` +
      `   Action: Use cluster reroute API to move shards\n` +
      `   Command: POST /_cluster/reroute`
    );
  }

  // Phase 2.3: Replica strategy recommendations
  if (metrics.replica_analysis.by_replica_count.zero > 0) {
    recommendations.push(
      `[HIGH] ${metrics.replica_analysis.by_replica_count.zero} Indices Without Replicas\n` +
      `   Impact: No redundancy - data loss if node fails!\n` +
      `   Action: Add at least 1 replica for production indices\n` +
      `   Command: PUT /<index>/_settings {"number_of_replicas": 1}`
    );
  }

  if (metrics.replica_analysis.by_replica_count.two_plus > 10) {
    const estimatedSavings = (metrics.replica_analysis.total_replica_overhead_gb * 0.3).toFixed(0);
    recommendations.push(
      `[LOW] ${metrics.replica_analysis.by_replica_count.two_plus} Indices with 2+ Replicas\n` +
      `   Impact: Excess disk usage (~${estimatedSavings}GB could be saved)\n` +
      `   Action: Review if 2+ replicas are necessary\n` +
      `   Note: Most indices work well with 1 replica`
    );
  }

  if (metrics.replica_analysis.same_node_issues.length > 0) {
    recommendations.push(
      `[CRITICAL] ${metrics.replica_analysis.same_node_issues.length} Indices with Same-Node Replica Placement\n` +
      `   Impact: No fault tolerance - defeats purpose of replicas!\n` +
      `   Action: Check cluster routing allocation settings\n` +
      `   Command: GET _cluster/settings?include_defaults=true&filter_path=**.routing.allocation`
    );
  }

  if (recommendations.length === 0) {
    text += `\n✅ No optimization needed - cluster is well-configured!\n`;
  } else {
    for (let i = 0; i < recommendations.length; i++) {
      text += `\n${i + 1}. ${recommendations[i]}\n`;
    }
  }

  return text;
}
