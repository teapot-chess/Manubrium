// The vendored OpenPairings contract (contracts/vendor/openpairings/
// manubrium-v1, see README "Contracts"), loaded for the tests: every schema
// into one Ajv, offline - the $refs are relative file names and resolve
// against each other, nothing is fetched. Test-only; nothing in the app
// imports this.

import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

const DIR = "../contracts/vendor/openpairings/manubrium-v1/";

const raw = import.meta.glob("../contracts/vendor/openpairings/manubrium-v1/**/*.json", { eager: true, import: "default" }) as Record<
  string,
  unknown
>;

/** Every file of the contract, by its path inside the contract ("examples/round-response.json"). */
export const files: Record<string, unknown> = Object.fromEntries(Object.entries(raw).map(([path, json]) => [path.slice(DIR.length), json]));

export const index = files["index.json"] as { contract: string; version: number; files: string[] };

export type Schema = Record<string, unknown> & {
  $id: string;
  title: string;
  description: string;
  definitions?: Record<string, Schema>;
  properties?: Record<string, Schema>;
  required?: string[];
};

export const schemas: Record<string, Schema> = Object.fromEntries(
  Object.entries(files).filter(([name]) => name.endsWith(".schema.json")) as [string, Schema][],
);

/** The examples, by file name; `schemaFor` names the schema each one is for. */
export const examples: Record<string, unknown> = Object.fromEntries(
  Object.entries(files)
    .filter(([name]) => name.startsWith("examples/"))
    .map(([name, json]) => [name.slice("examples/".length), json]),
);

/** `round-response.board-finished.json` is an example of `round-response.schema.json`. */
export function schemaFor(example: string): string {
  return `${example.replace(/\.json$/, "").split(".")[0]}.schema.json`;
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
addFormats(ajv);
for (const s of Object.values(schemas)) ajv.addSchema(s);

/** Ajv's complaints about `data` under `schema` (a file name), as readable lines; [] when it is valid. */
export function problems(schema: string, data: unknown): string[] {
  const s = schemas[schema];
  if (!s) return [`no such schema in the contract: ${schema}`];
  const validate = ajv.getSchema(s.$id)!;
  if (validate(data)) return [];
  return (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath || "/"} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
}

/** A definition from common.schema.json, or a path into any schema ("sync-response.schema.json#/properties/results/items"). */
export function definition(ref: string): Schema {
  const [file, pointer = ""] = ref.includes(".schema.json") ? ref.split("#") : ["common.schema.json", `/definitions/${ref}`];
  let node: unknown = schemas[file];
  for (const part of pointer.split("/").filter(Boolean)) node = (node as Record<string, unknown>)[part];
  if (!node) throw new Error(`nothing at ${ref}`);
  return resolve(node as Schema, file);
}

// Follows a $ref, and the non-null branch of a `oneOf: [null, X]`.
function resolve(node: Schema, file: string): Schema {
  if (typeof node.$ref === "string") {
    const [target, pointer] = (node.$ref as string).startsWith("#") ? [file, (node.$ref as string).slice(1)] : (node.$ref as string).split("#");
    return definition(`${target}#${pointer}`);
  }
  const branches = node.oneOf as Schema[] | undefined;
  if (branches) {
    const real = branches.filter((b) => b.type !== "null");
    if (real.length === 1) return resolve(real[0], file);
  }
  return node;
}

/** Whether a property's schema lets null through. */
export function allowsNull(node: Schema, file = "common.schema.json"): boolean {
  if (typeof node.$ref === "string") {
    const [target, pointer] = (node.$ref as string).startsWith("#") ? [file, (node.$ref as string).slice(1)] : (node.$ref as string).split("#");
    let n: unknown = schemas[target];
    for (const part of pointer.split("/").filter(Boolean)) n = (n as Record<string, unknown>)[part];
    return allowsNull(n as Schema, target);
  }
  const type = node.type;
  if (type === "null" || (Array.isArray(type) && type.includes("null"))) return true;
  if (Array.isArray(node.enum) && node.enum.includes(null)) return true;
  if (Array.isArray(node.oneOf)) return (node.oneOf as Schema[]).some((b) => allowsNull(b, file));
  return false;
}

/** Every `title` and `description` in the contract, for "does the contract mention this route". */
export const prose: string = (() => {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object")
      for (const [k, v] of Object.entries(n)) {
        if ((k === "title" || k === "description") && typeof v === "string") out.push(v);
        else walk(v);
      }
  };
  Object.values(schemas).forEach(walk);
  return out.join("\n");
})();

/**
 * How the app's type declares each field: required or optional, nullable or
 * not. Built by the compiler from the type, so `shape<T>()({...})` only
 * compiles when the spec says exactly what T says - add a field to T and
 * the test stops compiling until the spec (and the check against the
 * schema) has it too.
 */
type FieldSpec<T, K extends keyof T> = `${{} extends Pick<T, K> ? "optional" : "required"}${null extends T[K] ? " nullable" : ""}`;
export type Shape<T> = { [K in keyof T]-?: FieldSpec<T, K> };
export const shape =
  <T>() =>
  (spec: Shape<T>): Record<string, string> =>
    spec as Record<string, string>;

/**
 * What the app's type believes that the schema does not promise: a field
 * the app counts on that the server may leave out, a field the app thinks
 * never null that the server may send as null, a field the app declares
 * that the server does not have at all. Being more tolerant than the schema
 * is fine and not reported.
 */
export function shapeMismatches(spec: Record<string, string>, schema: Schema): string[] {
  const props = (schema.properties ?? {}) as Record<string, Schema>;
  const required = (schema.required ?? []) as string[];
  const out: string[] = [];
  for (const [field, how] of Object.entries(spec)) {
    const prop = props[field];
    if (!prop) {
      out.push(`${field}: the app declares it, the contract has no such field`);
      continue;
    }
    if (how.startsWith("required") && !required.includes(field)) out.push(`${field}: the app counts on it, the contract may leave it out`);
    if (!how.endsWith("nullable") && allowsNull(prop)) out.push(`${field}: the app thinks it is never null, the contract allows null`);
  }
  return out;
}

/** The values a closed set in the schema allows (`enum`, or `const`s), null left out. */
export function enumOf(node: Schema): unknown[] {
  const n = resolve(node, "common.schema.json");
  if (Array.isArray(n.enum)) return (n.enum as unknown[]).filter((v) => v !== null);
  if ("const" in n) return [n.const];
  throw new Error(`not a closed set: ${JSON.stringify(node)}`);
}
