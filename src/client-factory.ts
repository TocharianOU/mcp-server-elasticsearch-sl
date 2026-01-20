/**
 * Client Factory - Dynamically load appropriate ES client based on version
 */

import type { ClientOptions } from '@elastic/elasticsearch';
import type { ESVersionInfo } from './version-detector.js';

export type ESClient = any; // Use any to avoid type conflicts between versions

/**
 * Create Elasticsearch client based on detected version
 */
export async function createVersionedClient(
  version: ESVersionInfo,
  options: ClientOptions
): Promise<ESClient> {
  const { major } = version;

  let ClientClass: any;
  let clientPackage: string = '@elastic/elasticsearch-v8'; // Default

  try {
    switch (major) {
      case 9:
        // ES 9.x - try to load v9 client, fallback to v8 if not available
        clientPackage = '@elastic/elasticsearch-v9';
        try {
          // @ts-expect-error - ES 9 client may not be available yet
          const v9Module = await import('@elastic/elasticsearch-v9');
          ClientClass = v9Module.Client;
          console.log('Using ES 9.x client');
        } catch (es9Error) {
          console.warn(`ES 9.x client not available, using ES 8.x client as fallback`);
          clientPackage = '@elastic/elasticsearch-v8';
          const v8FallbackModule = await import('@elastic/elasticsearch-v8');
          ClientClass = v8FallbackModule.Client;
        }
        break;

      case 8:
        clientPackage = '@elastic/elasticsearch-v8';
        const v8Module = await import('@elastic/elasticsearch-v8');
        ClientClass = v8Module.Client;
        break;

      case 7:
        clientPackage = '@elastic/elasticsearch-v7';
        const v7Module = await import('@elastic/elasticsearch-v7');
        ClientClass = v7Module.Client;
        break;

      case 6:
        clientPackage = '@elastic/elasticsearch-v6';
        const v6Module = await import('@elastic/elasticsearch-v6');
        ClientClass = v6Module.Client;
        break;

      case 5:
        clientPackage = '@elastic/elasticsearch-v5';
        const v5Module = await import('@elastic/elasticsearch-v5');
        ClientClass = v5Module.Client;
        break;

      default:
        // Unknown version (ES 10+) - fallback to latest available client (ES 9)
        console.warn(
          `⚠️  Elasticsearch ${major}.x is not explicitly supported yet.`
        );
        console.warn(
          `   Attempting to use ES 9.x client (latest available) as fallback...`
        );
        
        clientPackage = '@elastic/elasticsearch-v9';
        try {
          // @ts-expect-error - ES 9 client may not be available yet
          const v9Module = await import('@elastic/elasticsearch-v9');
          ClientClass = v9Module.Client;
          console.log(`✓ Using ES 9.x client for ES ${version.full}`);
        } catch (v9Error) {
          // ES 9 not available, fallback to ES 8
          console.warn(
            `   ES 9.x client not installed, falling back to ES 8.x client...`
          );
          clientPackage = '@elastic/elasticsearch-v8';
          const v8Module = await import('@elastic/elasticsearch-v8');
          ClientClass = v8Module.Client;
          console.log(`✓ Using ES 8.x client for ES ${version.full} (fallback)`);
        }
        break;
    }

    console.log(`Using ${clientPackage} for ES ${version.full}`);

    // Create client instance
    const client = new ClientClass(options);

    return client;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      throw new Error(
        `ES ${major}.x client not installed. ` +
        `Please install: npm install ${clientPackage}`
      );
    }
    throw error;
  }
}

/**
 * Verify client connection
 */
export async function verifyConnection(client: ESClient): Promise<boolean> {
  try {
    // Try ping first (supported in all versions)
    if (typeof client.ping === 'function') {
      await client.ping();
      return true;
    }

    // Fallback to info API
    await client.info();
    return true;
  } catch (error) {
    console.error('Client verification failed:', error);
    return false;
  }
}
