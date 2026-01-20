/**
 * ES 6.x Adapter - Handle ES 6 specific API differences
 */

export class ES6Adapter {
  /**
   * Normalize cat.indices response for ES 6.x
   * ES 6.x uses slightly different field names
   */
  static normalizeCatIndices(response: any[] | any): any[] {
    // Handle both array and object responses
    const indices = Array.isArray(response) ? response : (response.body || []);
    
    return indices.map((index: any) => ({
      ...index,
      // Ensure consistent field names
      'docs.count': index['docs.count'] || index.docs || '0',
      'store.size': index['store.size'] || index.size || '0b',
      'pri.store.size': index['pri.store.size'] || index['store.size'] || '0b',
    }));
  }

  /**
   * Normalize mappings response for ES 6.x
   * ES 6.x includes mapping types in the response structure
   */
  static normalizeMappings(response: any): any {
    const normalized: any = {};

    for (const [indexName, indexData] of Object.entries(response)) {
      if (typeof indexData === 'object' && indexData !== null) {
        const data = indexData as any;
        
        // ES 6.x structure: { index: { mappings: { type: { properties: {...} } } } }
        // ES 7+ structure: { index: { mappings: { properties: {...} } } }
        
        if (data.mappings) {
          // Check if this is ES 6.x format (has types)
          const mappingKeys = Object.keys(data.mappings);
          const hasTypes = mappingKeys.length > 0 && 
                          !mappingKeys.includes('properties') &&
                          typeof data.mappings[mappingKeys[0]] === 'object';

          if (hasTypes) {
            // ES 6.x: Extract first type's mappings (most common pattern)
            const firstType = mappingKeys[0];
            normalized[indexName] = {
              mappings: data.mappings[firstType] || {},
              _es6_type: firstType, // Preserve type info
              _es6_all_types: mappingKeys, // All types found
            };
          } else {
            // Already in ES 7+ format or empty
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
   * Prepare search request for ES 6.x
   * ES 6.x supports (but deprecates) the 'type' parameter
   */
  static prepareSearchRequest(params: any): any {
    const prepared = { ...params };

    // ES 6.x allows type parameter (though deprecated)
    // We'll use '_doc' as the default type if not specified
    // Note: This is optional in ES 6.x

    return prepared;
  }

  /**
   * Normalize search response for ES 6.x
   * Response format is mostly the same, but some metadata fields differ
   */
  static normalizeSearchResponse(response: any): any {
    // ES 6.x search responses are mostly compatible with ES 7+
    // Just ensure consistent structure
    return {
      ...response,
      hits: {
        ...response.hits,
        hits: (response.hits?.hits || []).map((hit: any) => ({
          ...hit,
          // Preserve _type for reference (exists in ES 6, not in ES 7+)
          _type: hit._type || '_doc',
        })),
      },
    };
  }

  /**
   * Check if index uses multiple types (ES 6.x specific)
   */
  static hasMultipleTypes(mappings: any): boolean {
    if (!mappings || !mappings.mappings) return false;
    
    const keys = Object.keys(mappings.mappings);
    // If it has 'properties' directly, it's ES 7+ format
    if (keys.includes('properties')) return false;
    
    // Count how many type objects exist
    return keys.length > 1;
  }

  /**
   * Get type names from ES 6.x mappings
   */
  static getTypes(mappings: any): string[] {
    if (!mappings || !mappings.mappings) return [];
    
    const keys = Object.keys(mappings.mappings);
    // Filter out ES 7+ properties
    return keys.filter(key => 
      key !== 'properties' && 
      key !== '_meta' && 
      key !== '_source' &&
      typeof mappings.mappings[key] === 'object'
    );
  }

  /**
   * Prepare index creation parameters for ES 6.x
   * ES 6.x requires type specification in mappings
   */
  static prepareIndexSettings(settings: any, useType: string = '_doc'): any {
    const prepared = { ...settings };

    // If mappings are provided without a type, wrap them
    if (prepared.mappings && prepared.mappings.properties) {
      prepared.mappings = {
        [useType]: {
          properties: prepared.mappings.properties,
          ...(prepared.mappings._meta && { _meta: prepared.mappings._meta }),
          ...(prepared.mappings._source && { _source: prepared.mappings._source }),
        },
      };
    }

    return prepared;
  }

  /**
   * Get compatibility warnings for ES 6.x
   */
  static getCompatibilityWarnings(): string[] {
    return [
      'ES 6.x uses mapping types (deprecated, removed in ES 7)',
      'Some newer ES features are not available',
      'Consider upgrading to ES 7.17 LTS or ES 8.x for better features and support',
      'ES 6.x reached End of Life - security updates no longer provided',
    ];
  }

  /**
   * Get ES 6 specific recommendations
   */
  static getRecommendations(version: { major: number; minor: number }): string[] {
    const recommendations: string[] = [];

    if (version.minor < 8) {
      recommendations.push('Consider upgrading to ES 6.8.x (last 6.x version) for latest bug fixes');
    }

    if (version.minor >= 6) {
      recommendations.push('ILM is available - consider using it for index lifecycle management');
    }

    if (version.minor >= 3) {
      recommendations.push('SQL API is available for familiar query syntax');
    }

    recommendations.push('Plan migration to ES 7.17 LTS for continued support and new features');

    return recommendations;
  }
}
