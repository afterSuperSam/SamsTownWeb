import { z } from "zod";

export const usernameSchema = z.string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\p{N}_-]+$/u);

export const accountPasswordSchema = z.string().min(10).max(256);

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256)
});

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
