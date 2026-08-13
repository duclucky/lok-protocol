import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type AstNode = Record<string, unknown> & { nodeType?: string; name?: string };

export function walkAst(node: unknown, visit: (node: AstNode) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  const astNode = node as AstNode;
  if (typeof astNode.nodeType === "string") visit(astNode);
  for (const value of Object.values(astNode)) walkAst(value, visit);
}

export function loadSourceAst(sourceName: string): AstNode {
  const directory = path.resolve("hardhat-artifacts/build-info");
  for (const filename of readdirSync(directory)) {
    if (!filename.endsWith(".json")) continue;
    const buildInfo = JSON.parse(readFileSync(path.join(directory, filename), "utf8")) as {
      output?: { sources?: Record<string, { ast?: AstNode }> };
    };
    const ast = buildInfo.output?.sources?.[sourceName]?.ast;
    if (ast !== undefined) return ast;
  }
  throw new Error(`No current AST found for ${sourceName}`);
}

export function findFunction(ast: AstNode, functionName: string): AstNode {
  let found: AstNode | undefined;
  walkAst(ast, (node) => {
    if (node.nodeType === "FunctionDefinition" && node.name === functionName) found = node;
  });
  if (found === undefined) throw new Error(`Function ${functionName} not found in AST`);
  return found;
}

function expressionName(node: AstNode | undefined): string | undefined {
  if (node?.nodeType === "Identifier") return node.name;
  if (node?.nodeType === "IndexAccess") return expressionName(node.baseExpression as AstNode);
  return undefined;
}

function isFheAddOf(node: AstNode | undefined, operand: string): boolean {
  if (node?.nodeType !== "FunctionCall") return false;
  const expression = node.expression as AstNode | undefined;
  if (expression?.nodeType !== "MemberAccess" || expression.memberName !== "add") return false;
  const base = expression.expression as AstNode | undefined;
  if (base?.nodeType !== "Identifier" || base.name !== "FHE") return false;
  const args = node.arguments as AstNode[] | undefined;
  return args?.length === 2 && args[1]?.nodeType === "Identifier" && args[1].name === operand;
}

export function depositMovedTargets(functionAst: AstNode): string[] {
  const targets = new Set<string>();
  walkAst(functionAst, (node) => {
    if (node.nodeType !== "Assignment") return;
    const target = expressionName(node.leftHandSide as AstNode | undefined);
    if (target !== undefined && isFheAddOf(node.rightHandSide as AstNode | undefined, "moved")) targets.add(target);
  });
  return [...targets].sort();
}

function isFheMemberCall(node: AstNode | undefined, memberName: string): boolean {
  if (node?.nodeType !== "FunctionCall") return false;
  const expression = node.expression as AstNode | undefined;
  const base = expression?.expression as AstNode | undefined;
  return (
    expression?.nodeType === "MemberAccess" &&
    expression.memberName === memberName &&
    base?.nodeType === "Identifier" &&
    base.name === "FHE"
  );
}

export function fortuneResetShape(functionAst: AstNode): {
  validSelectAssignments: number;
  plaintextBranches: number;
} {
  let validSelectAssignments = 0;
  let plaintextBranches = 0;
  walkAst(functionAst, (node) => {
    if (node.nodeType === "IfStatement" || node.nodeType === "Conditional") plaintextBranches += 1;
    if (node.nodeType !== "Assignment") return;
    if (expressionName(node.leftHandSide as AstNode | undefined) !== "_fortune") return;
    const rhs = node.rightHandSide as AstNode | undefined;
    if (!isFheMemberCall(rhs, "select")) return;
    const args = rhs?.arguments as AstNode[] | undefined;
    if (args?.length !== 3 || args[0]?.nodeType !== "Identifier" || args[0].name !== "win") return;
    if (!isFheMemberCall(args[1], "asEuint16")) return;
    const zeroArgs = args[1].arguments as AstNode[] | undefined;
    if (zeroArgs?.length !== 1 || zeroArgs[0]?.nodeType !== "Literal" || zeroArgs[0].value !== "0") return;
    if (args[2]?.nodeType !== "Identifier" || args[2].name !== "incremented") return;
    validSelectAssignments += 1;
  });
  return { validSelectAssignments, plaintextBranches };
}

export function outcomeBindingShape(functionAst: AstNode): {
  signedCurrentAggregateHandles: string[];
  decodedAssignments: string[];
} {
  const signedCurrentAggregateHandles = new Set<string>();
  const decodedAssignments = new Set<string>();
  walkAst(functionAst, (node) => {
    if (node.nodeType === "Assignment") {
      const left = node.leftHandSide as AstNode | undefined;
      const right = node.rightHandSide as AstNode | undefined;
      if (left?.nodeType === "IndexAccess") {
        const base = left.baseExpression as AstNode | undefined;
        if (base?.nodeType !== "Identifier" || base.name !== "handles") return;
        if (!isFheMemberCall(right, "toBytes32")) return;
        const value = (right?.arguments as AstNode[] | undefined)?.[0];
        if (value?.nodeType === "MemberAccess" && (value.expression as AstNode | undefined)?.name === "draw") {
          signedCurrentAggregateHandles.add(String(value.memberName));
        }
      } else if (left?.nodeType === "MemberAccess" && (left.expression as AstNode | undefined)?.name === "draw") {
        const decodedFields = new Set(["totalTickets", "totalBaseRiskWeight", "totalYieldWeight"]);
        if (
          decodedFields.has(String(left.memberName)) &&
          right?.nodeType === "Identifier" &&
          right.name === left.memberName
        ) {
          decodedAssignments.add(String(left.memberName));
        }
      }
    }
  });
  return {
    signedCurrentAggregateHandles: [...signedCurrentAggregateHandles].sort(),
    decodedAssignments: [...decodedAssignments].sort(),
  };
}
