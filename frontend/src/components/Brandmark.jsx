// The little roof motif used in the headers for a "household" feel.
export default function Brandmark({ className = 'h-[54px] w-[54px]', iconClassName = 'h-[30px] w-[30px]' }) {
  return (
    <div
      aria-hidden="true"
      className={`grid place-items-center rounded-2xl bg-accent-soft text-accent-deep ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClassName}
      >
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10.5V20h14v-9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    </div>
  )
}
