import type { ImgHTMLAttributes } from "react";

const fallbackAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2321201d'/%3E%3Cpath d='M19 47c2-9 8-14 13-14s11 5 13 14' fill='%23a77b3e'/%3E%3Ccircle cx='32' cy='24' r='10' fill='%23d4a75d'/%3E%3C/svg%3E";

export function MinecraftAvatar({ username, size = 48, ...props }: {
  username: string;
  size?: number;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  return <img
    {...props}
    width={size}
    height={size}
    src={`https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`}
    onError={event => {
      event.currentTarget.onerror = null;
      event.currentTarget.src = fallbackAvatar;
      props.onError?.(event);
    }}
  />;
}
