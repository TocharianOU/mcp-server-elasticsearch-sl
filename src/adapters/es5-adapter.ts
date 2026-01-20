/**
 * ES 5.x Adapter - Handle ES 5 specific API differences
 */

export class ES5Adapter {
  /**
   * Normalize cat.indices response for ES 5.x
   * ES 5.x uses completely different field names (no dot notation)
   */
  static normalizeCatIndices(response: any[] | any): any[] {
    // Handle both array and object responses
    const indices = Array.isArray(response) ? response : (response.body || []);
    
    return indices.map((index: any) => {
      // ES 5.x fields: docs, size, pri, rep, etc.
      // ES 6+ fields: docs.count, store.size, etc.
      
      return {
        ...index,
        // Map ES 5.x field names to ES 6+ format
        'docs.count': index.docs || index['docs.count'] || '0',
        'store.size': index.size || index['store.size'] || '0b',
        'pri.store.size': index['pri.store.size'] || index.size || '0b',
        // Keep original fields for compatibility
        index: index.index || index.idx,
        health: index.health,
        status: index.status,
      };
    });
  }

  /**
   * Normalize mappings response for ES 5.x
   * ES 5.x always uses mapping types
   */
  static normalizeMappings(response: any): any {
    const normalized: any = {};

    for (const [indexName, indexData] of Object.entries(response)) {
      if (typeof indexData === 'object' && indexData !== null) {
        const data = indexData as any;
        
        // ES 5.x structure: { index: { mappings: { type: { properties: {...} } } } }
        
        if (data.mappings) {
          const mappingKeys = Object.keys(data.mappings);
          
          if (mappingKeys.length > 0) {
            // ES 5.x always has types
            const firstType = mappingKeys[0];
            normalized[indexName] = {
              mappings: data.mappings[firstType] || {},
              _es5_type: firstType,
              _es5_all_types: mappingKeys,
              _note: 'ES 5.x always uses mapping types',
            };
          } else {
            normalized[indexName] = data;
          }
        } else {
          normalized[indexName] = data;
        }
      }
    }

    return normalized;
  }

  /**
   * Prepare search request for ES 5.x
   * ES 5.x requires or strongly recommends type parameter
   */
  static prepareSearchRequest(params: any): any {
    const prepared = { ...params };

    // ES 5.x works better with explicit types
    // If no type specified, we can search across all types (but slower)
    
    return prepared;
  }

  /**
   * Normalize search response for ES 5.x
   */
  static normalizeSearchResponse(response: any): any {
    return {
      ...response,
      hits: {
        ...response.hits,
        hits: (response.hits?.hits || []).map((hit: any) => ({
          ...hit,
          // ES 5.x always includes _type
          _type: hit._type || '_doc',
        })),
      },
    };
  }

  /**
   * Get cat API headers for ES 5.x
   * ES 5.x uses different field names
   */
  static getCatHeaders(api: string): string {
    switch (api) {
      case 'indices':
        // ES 5.x field names (no dots)
        return 'index,health,status,docs,size,pri,rep';
      case 'shards':
        return 'index,shard,prirep,state,docs,store,ip,node';
      case 'nodes':
        return 'name,heap.percent,ram.percent,cpu,load_1m,role,master';
      default:
        return '';
    }
  }

  /**
   * Check if API is available in ES 5.x
   */
  static isApiAvailable(apiName: string, version: { major: number; minor: number }): boolean {
    // APIs not available in ES 5.x
    const unavailableApis = [
      'data_streams',
      'ilm', // ILM was introduced in ES 6.6
      'ccr', // Cross-cluster replication ES 6.5+
      'searchable_snapshots', // ES 7.10+
      'runtime_fields', // ES 7.11+
    ];

    if (unavailableApis.includes(apiName)) {
      return false;
    }

    // SQL API introduced in ES 6.3
    if (apiName === 'sql' && version.major < 6) {
      return false;
    }

    // Most basic APIs are available
    return true;
  }

  /**
   * Get compatibility warnings for ES 5.x
   */
  static getCompatibilityWarnings(): string[] {
    return [
      'ES 5.x is End of Life (EOL) - no security updates or support',
      'ES 5.x uses mapping types (deprecated in ES 6, removed in ES 7)',
      'Many modern Elasticsearch features are not available',
      'Data Streams, ILM, SQL, and other features require ES 6+/7+',
      'STRONGLY recommend upgrading to ES 7.17 LTS or ES 8.x',
      'Continuing to use ES 5.x poses security and compatibility risks',
    ];
  }

  /**
   * Get ES 5 specific recommendations
   */
  static getRecommendations(version: { major: number; minor: number }): string[] {
    const recommendations: string[] = [
      '🚨 URGENT: ES 5.x is EOL - upgrade immediately for security',
      'Recommended upgrade path: ES 5.x → ES 6.8 → ES 7.17 → ES 8.x',
      'Or use migration assistant for direct ES 5.x → ES 7.17 upgrade',
    ];

    if (version.minor < 6) {
      recommendations.push('At minimum, upgrade to ES 5.6.16 (last 5.x version)');
    }

    recommendations.push('Plan and budget for cluster upgrade - ES 5.x is not sustainable');
    recommendations.push('Test applications with ES 7.17 in staging environment');
    recommendations.push('Review breaking changes in ES upgrade guide');

    return recommendations;
  }

  /**
   * Prepare index creation parameters for ES 5.x
   * ES 5.x requires type specification and has different settings
   */
  static prepareIndexSettings(settings: any, useType: string = '_doc'): any {
    const prepared = { ...settings };

    // ES 5.x requires mapping types
    if (prepared.mappings) {
      if (prepared.mappings.properties) {
        // Wrap properties in type
        prepared.mappings = {
          [useType]: {
            properties: prepared.mappings.properties,
          },
        };
      }
    }

    // ES 5.x has different default settings
    if (!prepared.settings) {
      prepared.settings = {};
    }

    // Ensure compatibility with ES 5.x defaults
    if (!prepared.settings.number_of_shards) {
      prepared.settings.number_of_shards = 5; // ES 5.x default
    }

    return prepared;
  }
}
