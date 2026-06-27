type BrandLogoProps = {
  className?: string;
  /** Full wordmark vs lion mark only */
  variant?: "full" | "icon";
};

export function BrandLogo({ className = "h-10 w-auto", variant = "full" }: BrandLogoProps) {
  return (
    <img
      src={variant === "icon" ? "/favicon.png" : "/majubiz-logo.png"}
      alt="MajuBiz"
      className={className}
      decoding="async"
    />
  );
}
