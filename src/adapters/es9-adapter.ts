/**
 * ES 9.x Adapter - Handle ES 9 specific features and optimizations
 * Note: ES 9 features based on expected evolution from ES 8.x
 */

export class ES9Adapter {
  /**
   * Normalize cat.indices response for ES 9.x
   * ES 9.x uses standard format with potential new fields
   */
  static normalizeCatIndices(response: any[] | any): any[] {
    // Handle both array and object responses
    const indices = Array.isArray(response) ? response : (response.body || []);
    
    // ES 9.x should use standard format
    return indices.map((index: any) => ({
      ...index,
      'docs.count': index['docs.count'] || '0',
      'store.size': index['store.size'] || '0b',
      'pri.store.size': index['pri.store.size'] || '0b',
    }));
  }

  /**
   * Normalize mappings response for ES 9.x
   */
  static normalizeMappings(response: any): any {
    // ES 9.x format should be standard (evolved from ES 8)
    return response;
  }

  /**
   * Prepare search request for ES 9.x
   */
  static prepareSearchRequest(params: any): any {
    const prepared = { ...params };
    
    // Remove any legacy parameters
    if (prepared.type) {
      delete prepared.type;
    }

    return prepared;
  }

  /**
   * Normalize search response for ES 9.x
   */
  static normalizeSearchResponse(response: any): any {
    // ES 9.x response should be standard
    return response;
  }

  /**
   * Get ES 9 specific new features
   */
  static getNewFeatures(version: { major: number; minor: number }): string[] {
    const features: string[] = [
      'Latest Elasticsearch 9.x features and improvements',
      'Enhanced AI/ML capabilities',
      'Advanced vector search optimizations',
      'Improved performance and resource efficiency',
      'Better security and authentication features',
      'Enhanced observability and monitoring',
    ];

    // Version-specific features (as they become available)
    if (version.minor >= 1) {
      features.push('ES 9.1+ specific enhancements');
    }

    if (version.minor >= 2) {
      features.push('ES 9.2+ performance improvements');
    }

    return features;
  }

  /**
   * Get compatibility warnings for ES 9.x
   */
  static getCompatibilityWarnings(version: { major: number; minor: number }): string[] {
    const warnings: string[] = [
      'ES 9.x is a major version - review migration guide',
      'Some features from ES 8.x may have changed or been removed',
      'API endpoints may have updates - verify client compatibility',
      'Security configuration requirements may have changed',
    ];

    // Early version warnings
    if (version.minor < 3) {
      warnings.push('Early ES 9.x versions - monitor for updates and bug fixes');
      warnings.push('Consider waiting for ES 9.3+ for production if possible');
    }

    return warnings;
  }

  /**
   * Get ES 9 specific recommendations
   */
  static getRecommendations(version: { major: number; minor: number }): string[] {
    const recommendations: string[] = [
      'ES 9.x: Latest stable version - recommended for new deployments',
      'Review ES 9.x migration guide thoroughly before upgrading from ES 8.x',
      'Test extensively in staging before production deployment',
      'Update all client libraries to ES 9.x compatible versions',
      'Review security configuration changes',
    ];

    // Performance recommendations
    recommendations.push('Leverage latest indexing and search performance improvements');
    recommendations.push('Explore new AI/ML features for advanced use cases');
    recommendations.push('Use enhanced vector search for semantic applications');

    // Best practices
    recommendations.push('Implement proper monitoring and alerting');
    recommendations.push('Use Data Streams and ILM for data lifecycle management');
    recommendations.push('Configure backups and disaster recovery');

    return recommendations;
  }

  /**
   * Get breaking changes from ES 8 → ES 9
   */
  static getBreakingChangesFromES8(): string[] {
    return [
      'Review ES 9.x breaking changes documentation',
      'Some deprecated ES 8.x features may be removed',
      'API parameter changes may exist',
      'Default settings may have changed',
      'Index template structure may have updates',
      'Aggregation syntax or behavior may have changed',
    ];
  }

  /**
   * Check if using latest ES 9 version
   */
  static isLatestRecommended(version: { major: number; minor: number }): boolean {
    // Recommend upgrading if not on latest minor version
    // This would be updated as new ES 9.x versions release
    return version.minor >= 0; // Adjust based on actual latest version
  }

  /**
   * Get upgrade path from ES 8
   */
  static getUpgradePathFromES8(): string[] {
    return [
      'Step 1: Upgrade to latest ES 8.x (8.15+) first',
      'Step 2: Review ES 9.x breaking changes and migration guide',
      'Step 3: Test application compatibility in staging',
      'Step 4: Update all client libraries to ES 9.x versions',
      'Step 5: Perform rolling upgrade or reindex approach',
      'Step 6: Verify all features work correctly after upgrade',
      'Step 7: Monitor performance and adjust configurations',
    ];
  }

  /**
   * Get ES 9 benefits over ES 8
   */
  static getBenefitsOverES8(): string[] {
    return [
      'Latest features and capabilities',
      'Improved performance and efficiency',
      'Enhanced security features',
      'Better AI/ML integration',
      'Advanced vector search optimizations',
      'Long-term support and updates',
      'Latest bug fixes and improvements',
      'Better resource utilization',
    ];
  }

  /**
   * Check if ES 9 is recommended for production
   */
  static isProductionReady(version: { major: number; minor: number }): boolean {
    // Generally recommend ES 9.3+ for production (conservative approach)
    return version.minor >= 3;
  }

  /**
   * Get production readiness assessment
   */
  static getProductionReadinessAssessment(version: { major: number; minor: number }): string {
    if (version.minor >= 3) {
      return 'ES 9.x is production-ready - recommended for new and upgraded deployments';
    } else if (version.minor >= 1) {
      return 'ES 9.x is stable but consider waiting for 9.3+ for production workloads';
    } else {
      return 'ES 9.0 - test thoroughly, consider waiting for 9.1+ for critical production';
    }
  }
}
