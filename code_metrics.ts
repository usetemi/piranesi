#!/usr/bin/env -S deno run -A
// Code metrics for piranesi.ts.
//
// piranesi emits its whole browser app as template-literal strings (CSS + Preact
// html``). To measure *logic* and not markup, we parse with the TS compiler API:
// template-string contents are string literals, so they contribute nothing to
// cyclomatic complexity, and a 500-line CSS block counts as a single statement.
//
// Metrics:
//   - Cyclomatic complexity per function (start 1; +1 per branch/loop/case/catch/
//     &&/||/??/ternary).
//   - Logical SLOC: count of statement AST nodes (excludes comments, blanks, and
//     the contents of template strings by construction).
//
// Output is written plainly to code_analysis_<unixtimestamp>.log.
//
// Usage: deno run -A code_metrics.ts [file.ts]

import ts from "npm:typescript@5";

const target = Deno.args[0] || "piranesi.ts";
const source = await Deno.readTextFile(target);
const sf = ts.createSourceFile(target, source, ts.ScriptTarget.Latest, true);

type FnMetric = {
  name: string;
  line: number;
  cyclo: number;
  cognitive: number;
  sloc: number;
  maxDepth: number;
};

const BRANCH_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression, // ternary
]);

const isFunctionNode = (n: ts.Node): boolean =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n);

// Best-effort name: declared name, or the variable/property it's assigned to.
function fnName(n: ts.Node): string {
  if ((n as ts.FunctionDeclaration).name) return (n as ts.FunctionDeclaration).name!.getText(sf);
  const p = n.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
    return p.name.getText(sf);
  }
  return "(anonymous)";
}

// Structures that increase nesting depth (penalized by cognitive complexity in
// proportion to depth). Same as the branch kinds minus `case` (a switch arm
// branches but doesn't nest in the cognitive sense).
const NESTING_KINDS = new Set([...BRANCH_KINDS].filter((k) => k !== ts.SyntaxKind.CaseClause));

const isLogicalBinary = (n: ts.Node): boolean =>
  ts.isBinaryExpression(n) &&
  (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);

// Walk a function body, counting cyclomatic complexity, cognitive complexity,
// logical SLOC, and max nesting depth — but NOT descending into nested functions
// (each function owns its own metrics).
//
// Cyclomatic: +1 per branch/loop/case/catch + per logical operator.
// Cognitive: structures add (1 + current nesting); logical operators add +1 flat;
//   an `else` block adds +1 with no nesting penalty. Mirrors the SonarSource rule
//   (per-operator-node simplification for logical sequences).
function measureBody(fn: ts.Node) {
  let cyclo = 1, cognitive = 0, sloc = 0, maxDepth = 0;
  const body = (fn as ts.FunctionLikeDeclaration).body;
  if (!body) return { cyclo, cognitive, sloc, maxDepth };

  const walk = (node: ts.Node, depth: number) => {
    if (BRANCH_KINDS.has(node.kind)) cyclo++;
    if (isLogicalBinary(node)) { cyclo++; cognitive++; }
    if (ts.isStatement(node)) sloc++;

    let childDepth = depth;
    if (NESTING_KINDS.has(node.kind)) {
      cognitive += 1 + depth;
      childDepth = depth + 1;
      if (childDepth > maxDepth) maxDepth = childDepth;
      // An `else`/`else-if` branch: +1 flat, no extra nesting (avoids double-counting).
      if (ts.isIfStatement(node) && node.elseStatement) cognitive++;
    }
    ts.forEachChild(node, (child) => {
      if (isFunctionNode(child)) return; // nested fn measured separately
      walk(child, childDepth);
    });
  };
  ts.forEachChild(body, (n) => walk(n, 0));
  return { cyclo, cognitive, sloc, maxDepth };
}

const fns: FnMetric[] = [];
const visit = (node: ts.Node) => {
  if (isFunctionNode(node)) {
    const m = measureBody(node);
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    fns.push({ name: fnName(node), line, ...m });
  }
  ts.forEachChild(node, visit);
};
visit(sf);

// Top-level (module) logical SLOC: statements directly in the file body.
const moduleSloc = sf.statements.length;
const totalSloc = moduleSloc + fns.reduce((a, f) => a + f.sloc, 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const max = (xs: number[]) => Math.max(...xs);
const cycloVals = fns.map((f) => f.cyclo);
const cogVals = fns.map((f) => f.cognitive);

// Sort by cognitive complexity (the readability signal), then cyclomatic.
fns.sort((a, b) => b.cognitive - a.cognitive || b.cyclo - a.cyclo);

// ── External tools: don't reimplement what Deno/jscpd already do. ──
// Run a command, return combined output + exit code. Errors bubble.
async function run(cmd: string[]) {
  const p = await new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "piped" }).output();
  return {
    ok: p.success,
    out: (new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr)).trim(),
  };
}

// deno lint / deno check problem counts (rules themselves live in Deno, not here).
const lintCount = ((await run(["deno", "lint", target])).out.match(/Found (\d+) problem/) || [])[1] ?? "0";
const checkRes = await run(["deno", "check", target]);
const checkCount = checkRes.ok ? "0" : (checkRes.out.match(/Found (\d+) error/) || [])[1] ?? "see deno check";

// Duplication via jscpd over all .ts in the repo (its positional arg is a dir +
// glob, not a single file). Whole-file scan, so the contents of template strings
// are tokenized as the host TS, not as the embedded CSS/HTML.
const dupDir = await Deno.makeTempDir({ prefix: "jscpd_" });
await run(["npx", "--yes", "jscpd", ".", "--pattern", "**/*.ts", "--reporters", "json", "--output", dupDir, "--min-tokens", "50"]);
const dupStat = JSON.parse(await Deno.readTextFile(`${dupDir}/jscpd-report.json`)).statistics.total;
await Deno.remove(dupDir, { recursive: true });
const dupPct = `${dupStat.percentage.toFixed(1)}%  (${dupStat.duplicatedLines}/${dupStat.lines} tokenized lines)`;

const lpad = (s: string | number, w: number) => String(s).padStart(w);
const row = (a: string | number, b: string | number, c: string | number, d: string | number, e: string | number, name: string) =>
  `${lpad(a, 5)}${lpad(b, 5)}${lpad(c, 6)}${lpad(d, 7)}${lpad(e, 7)}  ${name}`;

const lines: string[] = [];
lines.push(`file:         ${target}  (server-side logic; embedded client app + CSS/HTML in template strings excluded by design)`);
lines.push(`functions:    ${fns.length}`);
lines.push(`logical sloc: ${totalSloc}  (module ${moduleSloc} + functions ${totalSloc - moduleSloc})`);
lines.push(`cyclomatic:   mean ${mean(cycloVals).toFixed(1)}  max ${max(cycloVals)}`);
lines.push(`cognitive:    mean ${mean(cogVals).toFixed(1)}  max ${max(cogVals)}`);
lines.push(`lint:         ${lintCount} problems   types: ${checkCount} errors   (via deno lint / deno check)`);
lines.push(`duplication:  ${dupPct}  (jscpd, all .ts in repo)`);
lines.push("");
lines.push(row("cog", "cyc", "sloc", "depth", "line", "name"));
for (const f of fns) lines.push(row(f.cognitive, f.cyclo, f.sloc, f.maxDepth, f.line, f.name));
const report = lines.join("\n") + "\n";

const logName = `code_analysis_${Math.floor(Date.now() / 1000)}.log`;
await Deno.writeTextFile(logName, report);
console.log(report);
console.log(`written: ${logName}`);
