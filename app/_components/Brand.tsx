import Link from "next/link";

/** Shield mark: a case-file tab with a check, vermilion notch for "deadline". */
export function Brand() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-md pr-2" aria-label="Dispute Defender, home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2.5 4.5 6.8v8.6c0 7.1 4.8 12.4 11.5 14.6 6.7-2.2 11.5-7.5 11.5-14.6V6.8L16 2.5Z" fill="var(--ink)" />
        <path d="M16 2.5 27.5 6.8v3.4L16 6Z" fill="var(--primary)" />
        <path d="m10.6 16.4 3.7 3.7 7.3-7.6" fill="none" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="whitespace-nowrap font-display text-[1.1rem] leading-none tracking-tight text-ink sm:text-[1.2rem]">
        Dispute <em className="text-primary">Defender</em>
      </span>
    </Link>
  );
}
