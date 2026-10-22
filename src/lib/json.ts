import type { Json } from "./database.types";

// Supabase JSON columns accept serialized data, while domain interfaces remain
// deliberately free of database index signatures.
export function toJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value cannot be serialized as JSON");
  return JSON.parse(serialized) as Json;
}
