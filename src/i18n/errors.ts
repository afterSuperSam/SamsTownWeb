import type { TranslationKey } from "./translations";

const knownErrorKeys = new Set<TranslationKey>([
  "error.generic",
  "error.invalidImage",
  "error.fileTooLarge",
  "error.contentChanged",
  "error.blogFeed",
  "error.notFound",
  "error.rateLimit",
  "error.mapDetailIncomplete",
  "error.mapDataChanged",
  "error.session",
  "error.permission",
  "error.passwordChangeRequired",
  "error.apiUnavailable",
  "error.apiTimeout",
  "error.serverBusy",
  "error.migrationRequired",
  "error.requiredMember",
  "error.duplicateMember",
  "error.tooManyHomeMembers",
  "error.invalidMembers",
  "error.invalidBilibiliUrl",
  "error.bilibiliMetadata",
  "error.duplicateVideo",
  "error.invalidRequest",
  "error.accountCreate",
  "error.accountExists",
  "error.loginInvalid",
  "error.accountUpdate",
  "error.accountPartiallyUpdated",
  "error.accountDelete",
  "error.accountMissing",
  "error.accountSelfDelete",
  "error.lastOwner",
  "error.ownerRoleLocked",
  "error.invalidMapImage",
  "error.mapFileTooLarge",
  "error.mapDimensionsChanged",
  "error.mapNameConfirmation",
  "error.mapNotFound",
  "error.mapNameExists"
]);

function readError(error: unknown): { message: string; code: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: typeof (error as Error & { code?: unknown }).code === "string"
        ? String((error as Error & { code?: unknown }).code)
        : ""
    };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    return {
      message: typeof record.message === "string" ? record.message : "",
      code: typeof record.code === "string" ? record.code : ""
    };
  }
  return { message: "", code: "" };
}

// Infrastructure errors stay out of the UI. Repository-raised translation
// keys pass through; Supabase and network failures map to stable product copy.
export function getErrorTranslationKey(error: unknown): TranslationKey {
  const details = readError(error);
  if (knownErrorKeys.has(details.message as TranslationKey)) return details.message as TranslationKey;
  const message = details.message.toLowerCase();
  if (["21000", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(details.code)) {
    return "error.migrationRequired";
  }
  if (/jwt|session|refresh token|not authenticated/.test(message)) return "error.session";
  if (details.code === "42501" || /permission|policy|row-level|forbidden|unauthorized/.test(message)) {
    return "error.permission";
  }
  if (/failed to fetch|network|load failed/.test(message)) return "error.apiUnavailable";
  return "error.generic";
}
