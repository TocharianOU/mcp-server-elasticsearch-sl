/**
 * Mapping Analyzer - Elasticsearch mapping analysis and intelligent summarization
 * Provides structured field information for AI decision-making
 */

// Field capability flags
export type FieldCapability = 'S' | 'T' | 'A' | 'O' | 'R' | 'G' | 'N';

export interface FlatField {
  path: string;              // Full field path (e.g., "user.name")
  type: string;              // Field type (text, keyword, date, etc.)
  capabilities: FieldCapability[]; // [S]earch [T]erm [A]gg [O]rder [R]ange [G]eo [N]ested
  analyzer?: string;         // Analyzer for text fields
  format?: string;           // Format for date fields
  properties?: any;          // Sub-properties for object/nested types
  fields?: Record<string, any>; // Multi-fields
}

export interface MappingStats {
  total_fields: number;
  depth: number;
  nested_fields: number;
  multi_fields: number;
  type_distribution: Record<string, number>;
}

export interface MappingSummary {
  index: string;
  stats: MappingStats;
  fields: FlatField[];
}

export interface MappingComparison {
  indices: string[];
  common_fields: FlatField[];
  unique_fields: Record<string, FlatField[]>;
  type_conflicts: Array<{
    field: string;
    types: Record<string, string>;
  }>;
}

/**
 * Flatten nested mapping structure into a list of fields with full paths
 */
export function flattenMapping(
  properties: any,
  prefix: string = '',
  depth: number = 0,
  maxDepth: number = 0
): { fields: FlatField[], maxDepth: number } {
  const fields: FlatField[] = [];
  let currentMaxDepth = Math.max(maxDepth, depth);

  if (!properties || typeof properties !== 'object') {
    return { fields, maxDepth: currentMaxDepth };
  }

  for (const [fieldName, fieldDef] of Object.entries(properties)) {
    if (!fieldDef || typeof fieldDef !== 'object') continue;

    const def = fieldDef as any;
    const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
    const fieldType = def.type || 'object';

    // Detect capabilities based on field type and settings
    const capabilities = detectCapabilities(fieldType, def);

    const flatField: FlatField = {
      path: fullPath,
      type: fieldType,
      capabilities,
    };

    // Add analyzer info for text fields
    if (fieldType === 'text' && def.analyzer) {
      flatField.analyzer = def.analyzer;
    }

    // Add format info for date fields
    if (fieldType === 'date' && def.format) {
      flatField.format = def.format;
    }

    // Track multi-fields
    if (def.fields) {
      flatField.fields = def.fields;
    }

    fields.push(flatField);

    // Recurse into nested properties
    if (def.properties) {
      flatField.properties = def.properties;
      const nested = flattenMapping(def.properties, fullPath, depth + 1, currentMaxDepth);
      fields.push(...nested.fields);
      currentMaxDepth = Math.max(currentMaxDepth, nested.maxDepth);
    }
  }

  return { fields, maxDepth: currentMaxDepth };
}

/**
 * Detect field capabilities based on type and settings
 */
function detectCapabilities(type: string, fieldDef: any): FieldCapability[] {
  const caps: FieldCapability[] = [];

  switch (type) {
    case 'text':
      caps.push('S'); // Searchable (full-text)
      break;

    case 'keyword':
    case 'constant_keyword':
    case 'wildcard':
      caps.push('T'); // Term query
      caps.push('A'); // Aggregatable
      caps.push('O'); // Sortable
      break;

    case 'long':
    case 'integer':
    case 'short':
    case 'byte':
    case 'double':
    case 'float':
    case 'half_float':
    case 'scaled_float':
    case 'unsigned_long':
      caps.push('T'); // Exact match
      caps.push('A'); // Aggregatable
      caps.push('O'); // Sortable
      caps.push('R'); // Range queries
      break;

    case 'date':
    case 'date_nanos':
      caps.push('T'); // Exact match
      caps.push('A'); // Aggregatable
      caps.push('O'); // Sortable
      caps.push('R'); // Range queries
      break;

    case 'boolean':
      caps.push('T'); // Term query
      caps.push('A'); // Aggregatable
      break;

    case 'ip':
      caps.push('T'); // Term query
      caps.push('A'); // Aggregatable
      caps.push('R'); // Range queries
      break;

    case 'geo_point':
    case 'geo_shape':
      caps.push('G'); // Geo queries
      break;

    case 'nested':
      caps.push('N'); // Nested queries required
      break;

    case 'object':
      // Objects don't have direct query capabilities
      break;
  }

  // Check if doc_values is explicitly disabled
  if (fieldDef.doc_values === false && caps.includes('A')) {
    const aggIndex = caps.indexOf('A');
    caps.splice(aggIndex, 1);
  }

  // Check if index is disabled
  if (fieldDef.index === false) {
    return []; // Not searchable at all
  }

  return caps;
}

/**
 * Calculate mapping statistics
 */
export function calculateMappingStats(fields: FlatField[], maxDepth: number): MappingStats {
  const typeDistribution: Record<string, number> = {};
  let nestedCount = 0;
  let multiFieldCount = 0;

  for (const field of fields) {
    // Count by type
    typeDistribution[field.type] = (typeDistribution[field.type] || 0) + 1;

    // Count nested fields
    if (field.type === 'nested') {
      nestedCount++;
    }

    // Count multi-fields
    if (field.fields && Object.keys(field.fields).length > 0) {
      multiFieldCount++;
    }
  }

  return {
    total_fields: fields.length,
    depth: maxDepth,
    nested_fields: nestedCount,
    multi_fields: multiFieldCount,
    type_distribution: typeDistribution,
  };
}

/**
 * Format capabilities as readable string
 */
function formatCapabilities(caps: FieldCapability[]): string {
  const labels: Record<FieldCapability, string> = {
    S: '搜索',
    T: '精确',
    A: '聚合',
    O: '排序',
    R: '范围',
    G: '地理',
    N: '嵌套',
  };
  
  return '[' + caps.map(c => labels[c]).join('|') + ']';
}

/**
 * Format mapping in minimal mode (flat list)
 */
export function formatMinimal(summary: MappingSummary): string {
  const { index, stats, fields } = summary;
  
  let text = `📋 Mapping: ${index}\n`;
  text += `${'='.repeat(70)}\n\n`;
  
  // Stats overview
  text += `总字段: ${stats.total_fields} | 层级: ${stats.depth} | `;
  text += `嵌套: ${stats.nested_fields} | Multi-fields: ${stats.multi_fields}\n\n`;
  
  // Type distribution
  const topTypes = Object.entries(stats.type_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  text += `类型分布: ${topTypes.map(([t, c]) => `${t}(${c})`).join(' ')}\n\n`;
  
  // Field list header
  text += `字段列表:\n`;
  text += `${'─'.repeat(70)}\n`;
  
  // Field rows (name | type | capabilities)
  const maxPathLen = 35;
  const maxTypeLen = 12;
  
  for (const field of fields) {
    const pathDisplay = field.path.length > maxPathLen 
      ? '...' + field.path.slice(-(maxPathLen - 3))
      : field.path.padEnd(maxPathLen);
    
    const typeDisplay = field.type.padEnd(maxTypeLen);
    const capsDisplay = formatCapabilities(field.capabilities);
    
    text += `${pathDisplay} ${typeDisplay} ${capsDisplay}`;
    
    // Add analyzer info
    if (field.analyzer) {
      text += ` (${field.analyzer})`;
    }
    
    // Show multi-fields
    if (field.fields) {
      const multiFieldNames = Object.keys(field.fields).join(', ');
      text += ` +[${multiFieldNames}]`;
    }
    
    text += '\n';
  }
  
  return text;
}

/**
 * Format mapping in compact mode (tree structure)
 */
export function formatCompact(summary: MappingSummary): string {
  const { index, stats, fields } = summary;
  
  let text = `📋 Mapping: ${index} (Compact View)\n`;
  text += `${'='.repeat(70)}\n\n`;
  
  // Stats
  text += `📊 Stats: ${stats.total_fields} fields, depth ${stats.depth}, `;
  text += `${stats.nested_fields} nested, ${stats.multi_fields} multi-fields\n\n`;
  
  // Build tree structure
  text += `字段树:\n`;
  text += `${'─'.repeat(70)}\n`;
  
  const tree = buildFieldTree(fields);
  text += formatTree(tree, '', true);
  
  return text;
}

/**
 * Build hierarchical tree structure from flat fields
 */
function buildFieldTree(fields: FlatField[]): any {
  const root: any = { children: {} };
  
  for (const field of fields) {
    const parts = field.path.split('.');
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      if (!current.children[part]) {
        current.children[part] = {
          field: i === parts.length - 1 ? field : null,
          children: {},
        };
      }
      
      current = current.children[part];
    }
  }
  
  return root;
}

/**
 * Format tree structure recursively
 */
function formatTree(node: any, prefix: string, isRoot: boolean): string {
  let text = '';
  const children = Object.entries(node.children || {});
  
  children.forEach(([name, child]: [string, any], index) => {
    const isLast = index === children.length - 1;
    const connector = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
    const childPrefix = isRoot ? '' : (isLast ? '   ' : '│  ');
    
    if (child.field) {
      const field = child.field as FlatField;
      const capsDisplay = formatCapabilities(field.capabilities);
      
      text += `${prefix}${connector}${name}: ${field.type} ${capsDisplay}`;
      
      if (field.analyzer) {
        text += ` (${field.analyzer})`;
      }
      
      if (field.fields) {
        const multiFields = Object.keys(field.fields);
        text += ` +[${multiFields.join(', ')}]`;
      }
      
      text += '\n';
    } else {
      text += `${prefix}${connector}${name}:\n`;
    }
    
    // Recurse into children
    if (Object.keys(child.children).length > 0) {
      text += formatTree(child, prefix + childPrefix, false);
    }
  });
  
  return text;
}

/**
 * Filter fields by pattern, type, or capability
 */
export function filterFields(
  fields: FlatField[],
  options: {
    pattern?: string | string[];
    type?: string | string[];
    capability?: 'searchable' | 'aggregatable' | 'sortable';
  }
): FlatField[] {
  let filtered = fields;
  
  // Filter by pattern
  if (options.pattern) {
    const patterns = Array.isArray(options.pattern) ? options.pattern : [options.pattern];
    filtered = filtered.filter(field => {
      return patterns.some(pattern => {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(field.path);
      });
    });
  }
  
  // Filter by type
  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    filtered = filtered.filter(field => types.includes(field.type));
  }
  
  // Filter by capability
  if (options.capability) {
    const capMap: Record<string, FieldCapability[]> = {
      searchable: ['S', 'T'],
      aggregatable: ['A'],
      sortable: ['O'],
    };
    
    const requiredCaps = capMap[options.capability];
    filtered = filtered.filter(field => 
      requiredCaps.some(cap => field.capabilities.includes(cap))
    );
  }
  
  return filtered;
}

/**
 * Compare mappings from multiple indices
 */
export function compareMappings(summaries: MappingSummary[]): MappingComparison {
  if (summaries.length === 0) {
    return {
      indices: [],
      common_fields: [],
      unique_fields: {},
      type_conflicts: [],
    };
  }
  
  const indices = summaries.map(s => s.index);
  
  // Build field map: path -> {index -> field}
  const fieldMap = new Map<string, Map<string, FlatField>>();
  
  for (const summary of summaries) {
    for (const field of summary.fields) {
      if (!fieldMap.has(field.path)) {
        fieldMap.set(field.path, new Map());
      }
      fieldMap.get(field.path)!.set(summary.index, field);
    }
  }
  
  // Find common fields (present in all indices)
  const commonFields: FlatField[] = [];
  const uniqueFields: Record<string, FlatField[]> = {};
  const typeConflicts: Array<{ field: string; types: Record<string, string> }> = [];
  
  for (const [path, indexFieldMap] of fieldMap.entries()) {
    if (indexFieldMap.size === summaries.length) {
      // Common field - but check for type conflicts
      const types = new Set<string>();
      const typesByIndex: Record<string, string> = {};
      
      for (const [idx, field] of indexFieldMap.entries()) {
        types.add(field.type);
        typesByIndex[idx] = field.type;
      }
      
      if (types.size > 1) {
        // Type conflict
        typeConflicts.push({ field: path, types: typesByIndex });
      }
      
      // Use first field as representative
      const firstField = indexFieldMap.values().next().value;
      if (firstField) {
        commonFields.push(firstField);
      }
    } else {
      // Unique to some indices
      for (const [idx, field] of indexFieldMap.entries()) {
        if (!uniqueFields[idx]) {
          uniqueFields[idx] = [];
        }
        uniqueFields[idx].push(field);
      }
    }
  }
  
  return {
    indices,
    common_fields: commonFields,
    unique_fields: uniqueFields,
    type_conflicts: typeConflicts,
  };
}

/**
 * Format comparison result
 */
export function formatComparison(comparison: MappingComparison): string {
  const { indices, common_fields, unique_fields, type_conflicts } = comparison;
  
  let text = `🔄 索引对比: ${indices.join(', ')}\n`;
  text += `${'='.repeat(70)}\n\n`;
  
  // Common fields
  text += `✅ 共同字段: ${common_fields.length} 个\n`;
  if (common_fields.length > 0 && common_fields.length <= 20) {
    text += `   ${common_fields.slice(0, 10).map(f => f.path).join(', ')}`;
    if (common_fields.length > 10) {
      text += `, ... (+${common_fields.length - 10} more)`;
    }
    text += '\n';
  }
  text += '\n';
  
  // Unique fields
  const hasUnique = Object.keys(unique_fields).length > 0;
  if (hasUnique) {
    text += `📌 差异字段:\n`;
    for (const [idx, fields] of Object.entries(unique_fields)) {
      text += `\n  ${idx}:\n`;
      const displayFields = fields.slice(0, 10);
      for (const field of displayFields) {
        text += `    + ${field.path}: ${field.type}\n`;
      }
      if (fields.length > 10) {
        text += `    ... (+${fields.length - 10} more)\n`;
      }
    }
    text += '\n';
  }
  
  // Type conflicts
  if (type_conflicts.length > 0) {
    text += `⚠️  类型冲突: ${type_conflicts.length} 个字段\n`;
    for (const conflict of type_conflicts.slice(0, 10)) {
      text += `\n  ${conflict.field}:\n`;
      for (const [idx, type] of Object.entries(conflict.types)) {
        text += `    ${idx}: ${type}\n`;
      }
    }
    if (type_conflicts.length > 10) {
      text += `\n  ... (+${type_conflicts.length - 10} more conflicts)\n`;
    }
  }
  
  return text;
}
