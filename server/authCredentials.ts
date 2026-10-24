import { z } from "zod";

// 与改名 RPC 一致：按 Unicode 字符计数，只接受字母、十进制数字和 _-。
export const usernameSchema = z.string().trim().regex(/^[\p{L}\p{Nd}_-]{2,32}$/u);

export const accountPasswordSchema = z.string().min(10).max(256);

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256)
});

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
