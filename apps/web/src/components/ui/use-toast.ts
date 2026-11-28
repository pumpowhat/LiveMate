"use client";

import * as React from "react";
import type { ToastProps } from "./toast";

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

const listeners = new Set<(toasts: ToasterToast[]) => void>();
let memoryToasts: ToasterToast[] = [];
let count = 0;

function emit() {
  for (const listener of listeners) {
    listener([...memoryToasts]);
  }
}

export function toast(props: Omit<ToasterToast, "id">) {
  const id = String(++count);
  const next: ToasterToast = { ...props, id, open: true };
  memoryToasts = [next, ...memoryToasts].slice(0, 4);
  emit();

  setTimeout(() => {
    dismissToast(id);
  }, 4500);

  return { id, dismiss: () => dismissToast(id) };
}

export function dismissToast(id: string) {
  memoryToasts = memoryToasts.filter((t) => t.id !== id);
  emit();
}

export function useToast() {
  const [toasts, setToasts] = React.useState<ToasterToast[]>(memoryToasts);

  React.useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  return { toasts, toast, dismiss: dismissToast };
}
