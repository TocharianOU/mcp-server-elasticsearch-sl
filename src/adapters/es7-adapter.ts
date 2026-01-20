/**
 * ES 7.x Adapter - Handle ES 7 specific API differences
 */

export class ES7Adapter {
  /**
   * Normalize cat.indices response for ES 7.x
   * ES 7.x response format is mostly standard
   */
  static normalizeCatIndices(response: any[] | any): any[] {
    // Handle both array and object responses
    const indices = Array.isArray(response) ? response : (response.body || []);
    
    // ES 7.x already uses standard format, minimal normalization needed
    return indices.map((index: any) => ({
      ...index,
      // Ensure consistent field names (already in dot notation)
      'docs.count': index['docs.count'] || '0',
      'store.size': index['store.size'] || '0b',
      'pri.store.size': index['pri.store.size'] || '0b',
    }));
  }

  /**
   * Normalize mappings response for ES 7.x
   * ES 7.x removed mapping types - uses direct properties
   */
  static normalizeMappings(response: any): any {
    // ES 7.x format: { index: { mappings: { properties: {...} } } }
    // Already in standard format, no normalization needed
    return response;
  }

  /**
   * Prepare search request for ES 7.x
   * ES 7.x removed the 'type' parameter
   */
  static prepareSearchRequest(params: any): any {
    const prepared = { ...params };

    // Remove 'type' parameter if present (not supported in ES 7+)
    if (prepared.type) {
      delete prepared.type;
    }

    return prepared;
  }

  /**
   * Normalize search response for ES 7.x
   * ES 7.x may still include _type in older indices
   */
  static normalizeSearchResponse(response: any): any {
    return {
      ...response,
      hits: {
        ...response.hits,
        hits: (response.hits?.hits || []).map((hit: any) => {
          const normalized = { ...hit };
          // _type may exist for backward compatibility but is always '_doc'
          if (!normalized._type) {
            normalized._type = '_doc';
          }
          return normalized;
        }),
      },
    };
  }

  /**
   * Get compatibility warnings for ES 7.x based on minor version
   */
  static getCompatibilityWarnings(version: { major: number; minor: number }): string[] {
    const warnings: string[] = [];

    if (version.minor < 9) {
      warnings.push('Data Streams not available (requires ES 7.9+)');
    }

    if (version.minor < 10) {
      warnings.push('Searchable Snapshots not available (requires ES 7.10+)');
      warnings.push('Point in Time API not available (requires ES 7.10+)');
    }

    if (version.minor < 11) {
      warnings.push('Runtime Fields not available (requires ES 7.11+)');
    }

    if (version.minor < 17) {
      warnings.push('Consider upgrading to ES 7.17 LTS (long-term support version)');
    }

    // ES 7.x is approaching EOL
    if (version.minor < 17) {
      warnings.push('ES 7.x versions below 7.17 are EOL or approaching EOL');
    }

    return warnings;
  }

  /**
   * Get ES 7 specific recommendations
   */
  static getRecommendations(version: { major: number; minor: number }): string[] {
    const recommendations: string[] = [];

    // Recommend upgrading within ES 7.x
    if (version.minor < 17) {
      recommendations.push('Upgrade to ES 7.17 LTS for extended support and latest features');
    }

    // Data Streams recommendations
    if (version.minor >= 9) {
      recommendations.push('Data Streams available - consider using for time-series data');
      recommendations.push('ILM policies work seamlessly with Data Streams');
    }

    // Feature availability recommendations
    if (version.minor >= 10) {
      recommendations.push('Searchable Snapshots available for cost-effective cold data storage');
      recommendations.push('Point in Time API available for consistent pagination');
    }

    if (version.minor >= 11) {
      recommendations.push('Runtime Fields available for schema-on-read queries');
    }

    // Migration path
    if (version.minor === 17) {
      recommendations.push('ES 7.17 LTS is the ideal version for migration to ES 8.x');
      recommendations.push('Plan migration to ES 8.x for latest features and continued support');
      recommendations.push('Use ES 7.17 as stable base while testing ES 8.x compatibility');
    } else {
      recommendations.push('Recommended path: upgrade to ES 7.17 LTS first, then ES 8.x');
    }

    return recommendations;
  }

  /**
   * Check if a specific feature is available
   */
  static isFeatureAvailable(feature: string, version: { major: number; minor: number }): boolean {
    switch (feature) {
      case 'data_streams':
        return version.minor >= 9;
      
      case 'searchable_snapshots':
      case 'point_in_time':
        return version.minor >= 10;
      
      case 'runtime_fields':
        return version.minor >= 11;
      
      case 'ilm':
        return true; // Available in all ES 7.x
      
      case 'sql':
        return true; // Available in all ES 7.x
      
      case 'ccr':
        return true; // Cross-cluster replication available in all ES 7.x
      
      case 'transforms':
        return version.minor >= 2;
      
      case 'snapshot_lifecycle':
        return version.minor >= 4;
      
      default:
        return true; // Most features available
    }
  }

  /**
   * Get feature availability summary
   */
  static getFeatureSummary(version: { major: number; minor: number }): string {
    const features = [
      { name: 'Data Streams', available: version.minor >= 9, since: '7.9' },
      { name: 'ILM', available: true, since: '6.6' },
      { name: 'Searchable Snapshots', available: version.minor >= 10, since: '7.10' },
      { name: 'Runtime Fields', available: version.minor >= 11, since: '7.11' },
      { name: 'Point in Time', available: version.minor >= 10, since: '7.10' },
      { name: 'SQL API', available: true, since: '6.3' },
      { name: 'Transforms', available: version.minor >= 2, since: '7.2' },
      { name: 'CCR', available: true, since: '6.5' },
    ];

    let summary = `ES 7.${version.minor} Feature Availability:\n`;
    
    for (const feature of features) {
      const status = feature.available ? '✅' : '❌';
      const info = feature.available 
        ? `(available since ${feature.since})`
        : `(requires ${feature.since}+)`;
      summary += `  ${status} ${feature.name} ${info}\n`;
    }

    return summary;
  }

  /**
   * Get upgrade benefits (ES 7.x → ES 8.x)
   */
  static getUpgradeBenefits(): string[] {
    return [
      'ES 8.x: Better performance and resource efficiency',
      'ES 8.x: Enhanced security features (security on by default)',
      'ES 8.x: Improved vector search capabilities',
      'ES 8.x: Better monitoring and observability',
      'ES 8.x: Continued long-term support and updates',
      'ES 8.x: New aggregations and query types',
      'ES 8.x: Faster indexing and search performance',
    ];
  }

  /**
   * Prepare index creation parameters for ES 7.x
   * ES 7.x doesn't use types, direct properties mapping
   */
  static prepareIndexSettings(settings: any): any {
    const prepared = { ...settings };

    // Ensure no mapping types (already standard in ES 7)
    if (prepared.mappings) {
      // If someone accidentally wrapped in a type, unwrap it
      const keys = Object.keys(prepared.mappings);
      if (keys.length === 1 && !keys.includes('properties') && typeof prepared.mappings[keys[0]] === 'object') {
        // Might be wrapped in a type, unwrap it
        const possibleType = keys[0];
        if (prepared.mappings[possibleType].properties) {
          prepared.mappings = prepared.mappings[possibleType];
        }
      }
    }

    return prepared;
  }
}
