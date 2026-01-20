/**
 * ES 8.x Adapter - Handle ES 8 specific features and optimizations
 */

export class ES8Adapter {
  /**
   * Normalize cat.indices response for ES 8.x
   * ES 8.x uses standard format, already optimal
   */
  static normalizeCatIndices(response: any[] | any): any[] {
    // Handle both array and object responses
    const indices = Array.isArray(response) ? response : (response.body || []);
    
    // ES 8.x uses standard format
    return indices.map((index: any) => ({
      ...index,
      'docs.count': index['docs.count'] || '0',
      'store.size': index['store.size'] || '0b',
      'pri.store.size': index['pri.store.size'] || '0b',
    }));
  }

  /**
   * Normalize mappings response for ES 8.x
   * ES 8.x uses standard format (no types)
   */
  static normalizeMappings(response: any): any {
    // ES 8.x format is already standard
    return response;
  }

  /**
   * Prepare search request for ES 8.x
   */
  static prepareSearchRequest(params: any): any {
    // ES 8.x doesn't support 'type' parameter
    const prepared = { ...params };
    
    if (prepared.type) {
      delete prepared.type;
    }

    return prepared;
  }

  /**
   * Normalize search response for ES 8.x
   */
  static normalizeSearchResponse(response: any): any {
    // ES 8.x response is standard
    return response;
  }

  /**
   * Get ES 8 specific features
   */
  static getNewFeatures(version: { major: number; minor: number }): string[] {
    const features: string[] = [];

    // ES 8.0+
    features.push('Security enabled by default (authentication required)');
    features.push('Improved vector search capabilities');
    features.push('Better performance and resource efficiency');

    // ES 8.2+
    if (version.minor >= 2) {
      features.push('Approximate k-NN search improvements');
      features.push('Synthetic _source field');
    }

    // ES 8.3+
    if (version.minor >= 3) {
      features.push('TSDB (Time Series Data Stream) optimizations');
      features.push('Downsampling for time-series data');
    }

    // ES 8.5+
    if (version.minor >= 5) {
      features.push('Semantic search with ELSER model');
      features.push('Improved aggregations performance');
    }

    // ES 8.8+
    if (version.minor >= 8) {
      features.push('Vector search GA (Generally Available)');
      features.push('Inference API for ML models');
    }

    // ES 8.11+
    if (version.minor >= 11) {
      features.push('Semantic text field type');
      features.push('Improved semantic search capabilities');
    }

    // ES 8.12+
    if (version.minor >= 12) {
      features.push('Query rules for semantic search ranking');
      features.push('Retrieval-augmented generation (RAG) support');
    }

    return features;
  }

  /**
   * Get compatibility warnings for ES 8.x
   */
  static getCompatibilityWarnings(version: { major: number; minor: number }): string[] {
    const warnings: string[] = [];

    // Security warning
    warnings.push('ES 8.x requires authentication by default (security enabled)');

    // Deprecation warnings
    if (version.minor < 15) {
      warnings.push('Some older 8.x features may be deprecated - check release notes');
    }

    // Type removal reminder
    warnings.push('Mapping types completely removed (already gone in ES 7)');

    return warnings;
  }

  /**
   * Get ES 8 specific recommendations
   */
  static getRecommendations(version: { major: number; minor: number }): string[] {
    const recommendations: string[] = [];

    // General recommendations
    recommendations.push('ES 8.x is the current LTS version - recommended for production');
    recommendations.push('Security is enabled by default - ensure proper authentication setup');
    
    // Version-specific recommendations
    if (version.minor < 10) {
      recommendations.push('Consider upgrading to ES 8.10+ for latest performance improvements');
    }

    if (version.minor >= 8) {
      recommendations.push('Explore vector search for semantic search and RAG use cases');
      recommendations.push('Use ELSER for zero-shot semantic search');
    }

    if (version.minor >= 3) {
      recommendations.push('Consider TSDB mode for time-series data workloads');
      recommendations.push('Use downsampling for long-term time-series data retention');
    }

    // ML and AI recommendations
    if (version.minor >= 5) {
      recommendations.push('Leverage semantic search capabilities for better relevance');
      recommendations.push('Explore machine learning features for advanced use cases');
    }

    // Performance recommendations
    recommendations.push('Use Data Streams for time-series data management');
    recommendations.push('Implement ILM policies for automated data lifecycle');
    recommendations.push('Monitor cluster health and performance regularly');

    return recommendations;
  }

  /**
   * Check if ES 9 migration should be considered
   */
  static shouldConsiderES9Migration(version: { major: number; minor: number }): boolean {
    // If ES 9 is available and user is on older ES 8.x
    return version.minor < 15;
  }

  /**
   * Get ES 8 → ES 9 migration benefits
   */
  static getES9MigrationBenefits(): string[] {
    return [
      'ES 9.x: Latest features and improvements',
      'ES 9.x: Enhanced performance and efficiency',
      'ES 9.x: Improved security capabilities',
      'ES 9.x: Better AI/ML integration',
      'ES 9.x: Advanced vector search optimizations',
      'ES 9.x: Long-term support and updates',
    ];
  }

  /**
   * Get breaking changes from ES 7 → ES 8
   */
  static getBreakingChangesFromES7(): string[] {
    return [
      'Security enabled by default (requires configuration)',
      'Some REST API endpoints changed or removed',
      'Type parameter completely removed',
      'Default shard count changed to 1 (was 5 in older versions)',
      'Some deprecated features removed',
      'Node roles configuration changes',
    ];
  }
}
