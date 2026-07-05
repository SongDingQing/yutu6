'use strict';
/*
 * validate:跑前静态校验(dry-run,蓝图 §18.7 第2道护栏)。
 * 检查:① 引用完整(edge 的 from/to 都是已定义节点);② 路由可达(从起点能到每个节点);
 *       ③ 有 end 节点;④ when 表达式可解析。不过不准跑。
 */
const { compileWhen } = require('./condition');

function validateFlow(flow) {
  const errors = [];
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  const ids = new Set(nodes.map(n => n.id));
  if (!nodes.length) errors.push('没有 nodes');
  if (!ids.size) errors.push('节点缺 id');

  // ③ 有 end
  if (!nodes.some(n => n.type === 'end')) errors.push('没有 end 节点(流程不会终止)');

  // ① 引用完整
  for (const e of edges) {
    if (!ids.has(e.from)) errors.push(`edge.from 引用未定义节点: ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge.to 引用未定义节点: ${e.to}`);
    // ④ 表达式可解析
    if (e.when != null) {
      try { compileWhen(e.when); } catch (err) { errors.push(`边 ${e.from}->${e.to} 的 when 无法解析: ${err.message}`); }
    }
  }

  // ② 可达性:从起点 BFS
  const start = nodes[0] && nodes[0].id;
  const adj = {}; for (const e of edges) (adj[e.from] = adj[e.from] || []).push(e.to);
  const seen = new Set([start]); const q = [start];
  while (q.length) { for (const nx of adj[q.shift()] || []) if (!seen.has(nx)) { seen.add(nx); q.push(nx); } }
  for (const id of ids) if (!seen.has(id)) errors.push(`节点不可达(死节点): ${id}`);

  return { ok: errors.length === 0, errors, start };
}
module.exports = { validateFlow };
