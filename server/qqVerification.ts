import { createHmac, randomInt } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";

export const qqNumberSchema = z.string().trim().regex(/^[1-9][0-9]{4,10}$/);
export const qqCodeSchema = z.string().trim().regex(/^[0-9]{6}$/);
export const qqChallengeIdSchema = z.string().uuid();
export type QqVerificationPurpose = "register" | "bind";

export function isQqRegistrationConfigured(): boolean {
  return Boolean(config.BOT_API_URL && config.BOT_API_KEY && config.QQ_CODE_PEPPER);
}

function digest(value: string): string {
  if (!config.QQ_CODE_PEPPER) throw Object.assign(new Error("error.qqServiceUnavailable"), { statusCode: 503 });
  return createHmac("sha256", config.QQ_CODE_PEPPER).update(value).digest("hex");
}

export function createQqVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createCodeDigest(
  challengeId: string,
  purpose: QqVerificationPurpose,
  qqNumber: string,
  code: string
): string {
  return digest(`code:${challengeId}:${purpose}:${qqNumber}:${code}`);
}

export function createRequestIpDigest(ipAddress: string): string {
  return digest(`ip:${ipAddress}`);
}

export function createClaimDigest(challengeId: string, claimToken: string): string {
  return digest(`claim:${challengeId}:${claimToken}`);
}

interface OneBotResponse {
  status?: string;
  retcode?: number;
}

// The bot endpoint is a loopback-only OneBot/NapCat base URL. Delivery is not
// retried automatically because an ambiguous retry could send duplicate codes.
export async function sendQqVerificationCode(qqNumber: string, code: string): Promise<void> {
  if (!config.BOT_API_URL || !config.BOT_API_KEY) {
    throw Object.assign(new Error("error.qqServiceUnavailable"), { statusCode: 503 });
  }
  const endpoint = new URL("send_private_msg", `${config.BOT_API_URL.replace(/\/+$/, "")}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.BOT_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_id: qqNumber,
        message: `【楹雾镇】你的验证码是 ${code}，5 分钟内有效。请勿向他人泄露。`
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null) as OneBotResponse | null;
    if (!response.ok || payload?.status !== "ok" || payload.retcode !== 0) {
      throw Object.assign(new Error("error.qqDeliveryFailed"), { statusCode: 502 });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "error.qqDeliveryFailed") throw error;
    throw Object.assign(new Error("error.qqDeliveryFailed"), { statusCode: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
