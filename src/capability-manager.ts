/**
 * Capability Manager - Determine feature availability based on ES version
 */

import type { ESVersionInfo } from './version-detector.js';
import { ES5Adapter } from './adapters/es5-adapter.js';
import { ES6Adapter } from './adapters/es6-adapter.js';
import { ES7Adapter } from './adapters/es7-adapter.js';
import { ES8Adapter } from './adapters/es8-adapter.js';
import { ES9Adapter } from './adapters/es9-adapter.js';

export class CapabilityManager {
  constructor(private version: ESVersionInfo) {}

  /**
   * Get version info
   */
  getVersion(): ESVersionInfo {
    return this.version;
  }

  /**
   * Compare version with a minimum required version
   */
  private meetsVersion(minMajor: number, minMinor: number = 0): boolean {
    if (this.version.major > minMajor) return true;
    if (this.version.major < minMajor) return false;
    return this.version.minor >= minMinor;
  }

  /**
   * Feature: Data Streams (ES 7.9+)
   */
  supportsDataStreams(): boolean {
    return this.meetsVersion(7, 9);
  }

  /**
   * Feature: Searchable Snapshots (ES 7.10+)
   */
  supportsSearchableSnapshots(): boolean {
    return this.meetsVersion(7, 10);
  }

  /**
   * Feature: Runtime Fields (ES 7.11+)
   */
  supportsRuntimeFields(): boolean {
    return this.meetsVersion(7, 11);
  }

  /**
   * Feature: Point in Time API (ES 7.10+)
   */
  supportsPointInTime(): boolean {
    return this.meetsVersion(7, 10);
  }

  /**
   * Feature: SQL API (ES 6.3+)
   */
  supportsSQL(): boolean {
    return this.meetsVersion(6, 3);
  }

  /**
   * Feature: Cross-cluster search (ES 5.3+)
   */
  supportsCrossClusterSearch(): boolean {
    return this.meetsVersion(5, 3);
  }

  /**
   * Feature: Mapping types (removed in ES 7.0)
   */
  hasMappingTypes(): boolean {
    return this.version.major < 7;
  }

  /**
   * Feature: ILM (Index Lifecycle Management) (ES 6.6+)
   */
  supportsILM(): boolean {
    return this.meetsVersion(6, 6);
  }

  /**
   * Feature: Rollup Jobs (ES 6.3+, deprecated in 8.11)
   */
  supportsRollupJobs(): boolean {
    if (this.version.major >= 9) return false;
    if (this.version.major === 8 && this.version.minor >= 11) return false;
    return this.meetsVersion(6, 3);
  }

  /**
   * Get field names for cat.indices API
   * Field names changed between versions
   */
  getCatIndicesHeaders(): string {
    if (this.version.major < 6) {
      // ES 5.x uses different field names
      return 'index,health,status,docs,size';
    }
    // ES 6.x+ uses dot notation
    return 'index,health,status,docs.count,store.size,pri.store.size';
  }

  /**
   * Get all supported tools
   */
  getSupportedTools(): string[] {
    const tools: string[] = [
      'list_indices',
      'get_mappings',
      'es_search',
      'execute_es_api',
      'get_shards',
    ];

    if (this.supportsDataStreams()) {
      tools.push('list_data_streams');
    }

    return tools;
  }

  /**
   * Get unsupported tools with reasons
   */
  getUnsupportedTools(): Array<{ tool: string; reason: string; minVersion: string }> {
    const unsupported: Array<{ tool: string; reason: string; minVersion: string }> = [];

    if (!this.supportsDataStreams()) {
      unsupported.push({
        tool: 'list_data_streams',
        reason: 'Data Streams not available',
        minVersion: '7.9.0',
      });
    }

    return unsupported;
  }

  /**
   * Get compatibility warnings
   */
  getWarnings(): string[] {
    const warnings: string[] = [];

    if (this.version.major === 5) {
      warnings.push('ES 5.x is EOL and may have limited support');
      warnings.push('Consider upgrading to ES 7.17 LTS or ES 8.x');
    }

    if (this.version.major === 6) {
      warnings.push('ES 6.x is EOL and may have limited support');
      warnings.push('Some advanced features require ES 7.x+');
    }

    if (this.hasMappingTypes()) {
      warnings.push('This ES version uses mapping types (deprecated in ES 6, removed in ES 7)');
    }

    if (!this.supportsDataStreams()) {
      warnings.push('Data Streams feature not available (requires ES 7.9+)');
    }

    return warnings;
  }

  /**
   * Get version-specific adapter
   */
  getAdapter(): typeof ES5Adapter | typeof ES6Adapter | typeof ES7Adapter | typeof ES8Adapter | typeof ES9Adapter | null {
    if (this.version.major === 5) {
      return ES5Adapter;
    } else if (this.version.major === 6) {
      return ES6Adapter;
    } else if (this.version.major === 7) {
      return ES7Adapter;
    } else if (this.version.major === 8) {
      return ES8Adapter;
    } else if (this.version.major === 9) {
      return ES9Adapter;
    }
    return null;
  }

  /**
   * Get version-specific recommendations
   */
  getRecommendations(): string[] {
    if (this.version.major === 5) {
      return ES5Adapter.getRecommendations(this.version);
    } else if (this.version.major === 6) {
      return ES6Adapter.getRecommendations(this.version);
    } else if (this.version.major === 7) {
      return ES7Adapter.getRecommendations(this.version);
    } else if (this.version.major === 8) {
      return ES8Adapter.getRecommendations(this.version);
    } else if (this.version.major === 9) {
      return ES9Adapter.getRecommendations(this.version);
    }
    return [];
  }

  /**
   * Get version-specific compatibility warnings
   */
  getVersionWarnings(): string[] {
    if (this.version.major === 5) {
      return ES5Adapter.getCompatibilityWarnings();
    } else if (this.version.major === 6) {
      return ES6Adapter.getCompatibilityWarnings();
    } else if (this.version.major === 7) {
      return ES7Adapter.getCompatibilityWarnings(this.version);
    } else if (this.version.major === 8) {
      return ES8Adapter.getCompatibilityWarnings(this.version);
    } else if (this.version.major === 9) {
      return ES9Adapter.getCompatibilityWarnings(this.version);
    }
    return [];
  }

  /**
   * Normalize cat.indices response based on version
   */
  normalizeCatIndices(response: any[]): any[] {
    if (this.version.major === 5) {
      return ES5Adapter.normalizeCatIndices(response);
    } else if (this.version.major === 6) {
      return ES6Adapter.normalizeCatIndices(response);
    } else if (this.version.major === 7) {
      return ES7Adapter.normalizeCatIndices(response);
    } else if (this.version.major === 8) {
      return ES8Adapter.normalizeCatIndices(response);
    } else if (this.version.major === 9) {
      return ES9Adapter.normalizeCatIndices(response);
    }
    return response;
  }

  /**
   * Normalize mappings response based on version
   */
  normalizeMappings(response: any): any {
    if (this.version.major === 5) {
      return ES5Adapter.normalizeMappings(response);
    } else if (this.version.major === 6) {
      return ES6Adapter.normalizeMappings(response);
    } else if (this.version.major === 7) {
      return ES7Adapter.normalizeMappings(response);
    } else if (this.version.major === 8) {
      return ES8Adapter.normalizeMappings(response);
    } else if (this.version.major === 9) {
      return ES9Adapter.normalizeMappings(response);
    }
    return response;
  }

  /**
   * Get feature summary
   */
  getFeatureSummary(): string {
    const features = [
      { name: 'Data Streams', supported: this.supportsDataStreams() },
      { name: 'ILM', supported: this.supportsILM() },
      { name: 'Searchable Snapshots', supported: this.supportsSearchableSnapshots() },
      { name: 'Runtime Fields', supported: this.supportsRuntimeFields() },
      { name: 'Point in Time', supported: this.supportsPointInTime() },
      { name: 'SQL API', supported: this.supportsSQL() },
      { name: 'Cross-cluster Search', supported: this.supportsCrossClusterSearch() },
    ];

    let summary = `Elasticsearch ${this.version.full} Capabilities:\n`;
    summary += `${'='.repeat(50)}\n`;

    for (const feature of features) {
      const status = feature.supported ? '✓' : '✗';
      summary += `  ${status} ${feature.name}\n`;
    }

    // Add version-specific warnings
    const versionWarnings = this.getVersionWarnings();
    if (versionWarnings.length > 0) {
      summary += `\n⚠️  Version-Specific Warnings:\n`;
      for (const warning of versionWarnings) {
        summary += `  • ${warning}\n`;
      }
    }

    // Add general warnings
    const warnings = this.getWarnings();
    if (warnings.length > 0) {
      summary += `\n⚠️  General Warnings:\n`;
      for (const warning of warnings) {
        summary += `  • ${warning}\n`;
      }
    }

    // Add recommendations
    const recommendations = this.getRecommendations();
    if (recommendations.length > 0) {
      summary += `\n💡 Recommendations:\n`;
      for (const rec of recommendations) {
        summary += `  • ${rec}\n`;
      }
    }

    return summary;
  }
}
