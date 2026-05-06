type BrandLogoProps = {
  className?: string;
};

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      src="/brand/fitflex-logo.svg"
      alt=""
      aria-hidden="true"
      className={className}
    />
  );
}
