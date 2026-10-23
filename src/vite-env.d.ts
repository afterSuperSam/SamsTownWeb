/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
  __yingwuContent?: Promise<unknown>;
  __yingwuImages?: Promise<Record<string, unknown>[]>;
}
