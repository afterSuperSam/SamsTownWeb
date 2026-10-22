import { useEffect, useMemo, useState } from "react";
import type { QqChallenge } from "../../services/authService";

interface ActiveChallenge extends QqChallenge {
  expiresAt: number;
}

export function useQqChallenge(sendCode: (qqNumber: string) => Promise<QqChallenge>) {
  const [qqNumber, setQqNumber] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  const remaining = useMemo(
    () => challenge ? Math.max(0, Math.ceil((challenge.expiresAt - clock) / 1_000)) : 0,
    [challenge, clock]
  );

  useEffect(() => {
    if (challenge && remaining === 0) {
      setChallenge(null);
      setCode("");
    }
  }, [challenge, remaining]);

  async function requestCode(): Promise<void> {
    const next = await sendCode(qqNumber);
    setChallenge({ ...next, expiresAt: Date.now() + next.expiresIn * 1_000 });
    setClock(Date.now());
  }

  function reset(): void {
    setChallenge(null);
    setCode("");
  }

  return { qqNumber, setQqNumber, code, setCode, challenge, remaining, requestCode, reset };
}
