import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

function Form({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("space-y-4", className)} {...props} />;
}

function FormField({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5", className)} {...props} />;
}

function FormLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Label>) {
  return <Label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

function FormMessage({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) return null;
  return (
    <p className={cn("text-xs font-medium text-destructive", className)} role="alert" {...props}>
      {children}
    </p>
  );
}

export { Form, FormField, FormLabel, FormMessage };
