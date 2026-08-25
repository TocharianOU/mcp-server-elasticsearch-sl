/**
 * Index-naming conventions across ES versions (5 → 9).
 *
 * Deterministic knowledge about built-in / internal index families, so the
 * model gets actionable advice when it targets the wrong thing — without
 * needing any version knowledge of its own.
 */

export interface IndexAdvice {
  advice: string;
}

const DS_BACKING_RE = /^\.ds-(.+?)-\d{4}\.\d{2}\.\d{2}-\d{6}$/;

/** Advice for querying a given index name/pattern, or null when unremarkable. */
export function adviseOnIndexName(name: string, esMajor: number): string | null {
  if (!name || name.includes("*")) return null;

  const ds = DS_BACKING_RE.exec(name);
  if (ds) {
    return (
      `${name} 是 data stream 的 backing index。请直接查询 data stream 名 ` +
      `“${ds[1]}”（或模式匹配，如 logs-*），不要直查 backing index。`
    );
  }
  if (/^\.alerts-|^\.internal\.alerts-|^\.siem-signals-/.test(name)) {
    return (
      `${name} 是 Kibana 告警/检测的内部索引，schema 跨版本变动大。` +
      `优先通过 Kibana API（detection engine / alerting）读取告警与规则，而非直查该索引。`
    );
  }
  if (/^\.kibana/.test(name)) {
    return `${name} 是 Kibana 内部索引（saved objects），请改用 Kibana API 读取，不要直查。`;
  }
  if (/^\.(security|fleet|monitoring|ml-|transform|tasks|async-search|slm|watches)/.test(name)) {
    return `${name} 是 Elastic 系统内部索引，通常不应直接查询；如需相关信息请用对应的管理 API。`;
  }
  return null;
}

/**
 * Advice attached to index_not_found errors — suggests the naming families
 * that exist in each version era.
 */
export function adviseOnIndexNotFound(name: string, esMajor: number): string {
  const hints: string[] = [];
  // Beats-era vs data-stream-era naming
  if (/^(filebeat|metricbeat|winlogbeat|packetbeat|auditbeat|heartbeat)\b/.test(name)) {
    if (esMajor >= 8) {
      hints.push(
        `${esMajor}.x 上 Elastic Agent/Fleet 默认写入 data stream（logs-*-*、metrics-*-*），` +
        `传统 ${name.split("-")[0]}-* 索引只有在仍用独立 Beats 时才存在。试试 logs-* 或用 list_indices 确认。`
      );
    }
  } else if (/^(logs|metrics|traces)-/.test(name) && esMajor < 8 && esMajor >= 7) {
    hints.push(
      `7.x 集群中 data stream 需 7.9+ 且启用 Fleet；老式 Beats 写入 filebeat-*/metricbeat-* 命名。`
    );
  }
  hints.push(`可用 list_indices（支持 pattern）或 list_data_streams 确认实际存在的索引。`);
  return hints.join("\n");
}

/** Enrich an ES error message with index-convention advice when applicable. */
export function enrichIndexError(message: string, esMajor: number): string {
  const m = /index_not_found_exception[^[]*\[([^\]]+)\]/.exec(message)
    ?? /no such index \[([^\]]+)\]/i.exec(message);
  if (m?.[1]) {
    return `${message}\n提示：${adviseOnIndexNotFound(m[1], esMajor)}`;
  }
  return message;
}
