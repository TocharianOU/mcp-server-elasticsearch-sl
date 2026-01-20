/**
 * Version Detector - Detect Elasticsearch version using native HTTP
 */

import https from 'https';
import http from 'http';

export interface ESVersionInfo {
  major: number;
  minor: number;
  patch: number;
  full: string;
  distribution: string; // "elasticsearch" or "opensearch"
}

export interface ESClusterInfo {
  name: string;
  cluster_name: string;
  cluster_uuid: string;
  version: {
    number: string;
    distribution?: string;
    build_flavor?: string;
    build_type?: string;
    build_hash?: string;
    build_date?: string;
    build_snapshot?: boolean;
    lucene_version?: string;
    minimum_wire_compatibility_version?: string;
    minimum_index_compatibility_version?: string;
  };
  tagline: string;
}

/**
 * Detect Elasticsearch version by calling GET / with native HTTP
 * This avoids the chicken-egg problem of needing a client to detect version
 */
export async function detectESVersion(
  url: string,
  options?: {
    username?: string;
    password?: string;
    apiKey?: string;
    timeout?: number;
    rejectUnauthorized?: boolean;
  }
): Promise<ESVersionInfo> {
  const timeoutMs = options?.timeout || 10000;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions: any = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 9200),
      path: '/',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    };

    // Add authentication
    if (options?.apiKey) {
      requestOptions.headers['Authorization'] = `ApiKey ${options.apiKey}`;
    } else if (options?.username && options?.password) {
      const auth = Buffer.from(
        `${options.username}:${options.password}`
      ).toString('base64');
      requestOptions.headers['Authorization'] = `Basic ${auth}`;
    }

    // Handle self-signed certificates
    if (isHttps && options?.rejectUnauthorized === false) {
      requestOptions.rejectUnauthorized = false;
    }

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${res.statusMessage || 'Unknown error'}`
              )
            );
            return;
          }

          const info: ESClusterInfo = JSON.parse(data);

          if (!info.version || !info.version.number) {
            reject(new Error('Invalid response: missing version information'));
            return;
          }

          const versionParts = info.version.number.split('.');
          const major = parseInt(versionParts[0], 10);
          const minor = parseInt(versionParts[1], 10);
          const patch = parseInt(versionParts[2], 10);

          if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
            reject(
              new Error(
                `Invalid version format: ${info.version.number}`
              )
            );
            return;
          }

          // Detect distribution (Elasticsearch vs OpenSearch)
          const distribution =
            info.version.distribution ||
            (info.tagline.toLowerCase().includes('opensearch')
              ? 'opensearch'
              : 'elasticsearch');

          resolve({
            major,
            minor,
            patch,
            full: info.version.number,
            distribution,
          });
        } catch (error) {
          reject(
            new Error(
              `Failed to parse response: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(
        new Error(`Connection failed: ${error.message}`)
      );
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    });

    req.end();
  });
}

/**
 * Format version info for display
 */
export function formatVersionInfo(version: ESVersionInfo): string {
  return `${version.distribution} ${version.full} (${version.major}.${version.minor}.${version.patch})`;
}
