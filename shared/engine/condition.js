'use strict';
/*
 * condition:把流程边的 Jinja2 风格条件 `{{ ... }}` 编译成可在上下文上求值的函数。
 * 零 token —— 编排器只算这些布尔表达式选下一节点(蓝图 §18.1)。
 * 支持:and / or / not、== != < > <= >=、'字符串'、true/false、点号取值(review.pass)、loop/max_loops。
 */
function compileWhen(expr) {
  if (expr == null || String(expr).trim() === '') return () => true; // 无条件 = 默认边
  let e = String(expr).trim().replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
  // 词边界翻译为 JS 运算符
  e = e.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!');
  // 编译期语法检查(借 with 让 review.pass / loop 这类裸标识符在 ctx 上解析)
  const fn = new Function('ctx', 'with (ctx) { return (' + e + '); }');
  return (ctx) => {
    try { return !!fn(ctx || {}); } catch (_) { return false; }
  };
}
module.exports = { compileWhen };
