// Shown when the available-to-hang count crosses the threshold (PROJECT.md:
// "Whenever 3 or more status's are available, a notification is sent").
export default function NotificationBanner({ count }) {
  return (
    <div className="mb-[26px] mt-[22px] flex items-center gap-[10px] rounded-md border border-[#d6e2c5] bg-gradient-to-br from-[#eef3e7] to-[#e7efdd] px-4 py-[13px] text-[14px] font-semibold text-[#50603f]">
      <span className="h-[9px] w-[9px] flex-none animate-pulse rounded-full bg-status-green" />
      {count} roomies are free to hang right now — perfect time to gather!
    </div>
  )
}
