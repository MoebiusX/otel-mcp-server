/**
 * MCP tool compatibility facade.
 *
 * This module is intentionally small and transport-agnostic. It gives future
 * tool migrations one place to declare aliases and legacy argument mappings
 * without changing existing handlers or response bodies.
 */

export type ToolHandler<Args = any> = (args: Args) => unknown | Promise<unknown>;

export interface ToolAlias<Args = any> {
  /** Legacy tool name accepted for compatibility. */
  name: string;
  /** Canonical tool name this alias forwards to. */
  mapsTo: string;
  /** Optional alias-specific description. */
  description?: string;
  /** Optional alias-specific input schema; defaults to the canonical schema. */
  inputSchema?: Record<string, unknown>;
  /** Legacy argument name -> canonical argument name. */
  argMap?: Record<string, string>;
  /** Custom transform for migrations that need more than key renames. */
  transformArgs?: (args: Args) => Args;
  /** Version where this alias first became deprecated. */
  deprecatedSince?: string;
  /** Earliest version where this alias may be removed. */
  removeAfter?: string;
}

export interface ToolContract<Args = any> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler<Args>;
  aliases?: ToolAlias<Args>[];
}

export interface ToolRegistrar {
  tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: ToolHandler,
  ): void;
}

/** Apply a legacy alias's argument mapping without mutating the caller's args. */
export function applyAliasArgs<Args = any>(args: Args, alias: ToolAlias<Args>): Args {
  const mapped =
    args && typeof args === 'object' && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : args;

  if (mapped && typeof mapped === 'object' && !Array.isArray(mapped) && alias.argMap) {
    for (const [legacyName, canonicalName] of Object.entries(alias.argMap)) {
      if (
        Object.prototype.hasOwnProperty.call(mapped, legacyName) &&
        !Object.prototype.hasOwnProperty.call(mapped, canonicalName)
      ) {
        (mapped as Record<string, unknown>)[canonicalName] =
          (mapped as Record<string, unknown>)[legacyName];
      }
      delete (mapped as Record<string, unknown>)[legacyName];
    }
  }

  return alias.transformArgs ? alias.transformArgs(mapped as Args) : mapped as Args;
}

/** Human-readable alias description used when an alias does not override it. */
export function aliasDescription(alias: ToolAlias, canonicalName: string): string {
  const parts = [`Deprecated alias for ${canonicalName}.`];
  if (alias.deprecatedSince) parts.push(`Deprecated since ${alias.deprecatedSince}.`);
  if (alias.removeAfter) parts.push(`Earliest removal: ${alias.removeAfter}.`);
  return parts.join(' ');
}

/**
 * Register one canonical tool and any compatibility aliases.
 *
 * Current production code can continue to call `server.tool` directly. New or
 * migrated tools should use this facade so alias behavior stays centralized.
 */
export function registerTool<Args = any>(
  server: ToolRegistrar,
  contract: ToolContract<Args>,
): void {
  server.tool(
    contract.name,
    contract.description,
    contract.inputSchema,
    contract.handler as ToolHandler,
  );

  for (const alias of contract.aliases ?? []) {
    if (alias.mapsTo !== contract.name) {
      throw new Error(
        `Alias "${alias.name}" maps to "${alias.mapsTo}", expected "${contract.name}".`,
      );
    }
    server.tool(
      alias.name,
      alias.description ?? aliasDescription(alias, contract.name),
      alias.inputSchema ?? contract.inputSchema,
      async (args: Args) => contract.handler(applyAliasArgs(args, alias)),
    );
  }
}
