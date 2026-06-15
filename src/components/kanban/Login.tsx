import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOGO_URL } from "@/lib/logo";

interface Props {
  onLogin: (name: string) => void;
}

export function Login({ onLogin }: Props) {
  const [name, setName] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n) onLogin(n);
  };
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <img
        src={LOGO_URL}
        alt="JoyAge"
        className="pointer-events-none absolute left-4 top-4 h-14 w-auto object-contain sm:h-16"
      />
      <form
        onSubmit={submit}
        className="glass-panel w-full max-w-sm rounded-3xl p-8 text-center"
      >
        <img src={LOGO_URL} alt="JoyAge" className="mx-auto h-20 w-auto object-contain" />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-foreground">任务看板</h1>
        <p className="mt-1 text-sm text-muted-foreground">输入你的姓名开始协作</p>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="你的姓名"
          className="mt-6 h-11 bg-white/80 text-center text-base"
        />
        <Button type="submit" disabled={!name.trim()} className="mt-4 h-11 w-full text-base font-semibold">
          进入看板
        </Button>
      </form>
    </div>
  );
}
