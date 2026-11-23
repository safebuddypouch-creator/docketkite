// @polsia:user-owned — shared DocketKite mark used across public and signed-in surfaces.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" fill="none" className={className}>
      <path d="M20 2.8 37.2 17 23 37.2l-6.4-12.4L2.8 18.4 20 2.8Z" fill="currentColor" />
      <path d="m20 2.8 3 22 14.2-7.8L20 2.8Z" fill="#DDF17A" />
      <path
        d="m16.6 24.8 6.4 12.4 3.2-15.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
