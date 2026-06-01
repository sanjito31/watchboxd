import type { PartyMember } from "@/lib/types";

interface AvatarStackProps {
  members: PartyMember[];
  size?: "sm" | "md";
}

export function AvatarStack({ members, size = "sm" }: AvatarStackProps) {
  const dim = size === "sm" ? "h-7 w-7" : "h-9 w-9";

  return (
    <div className="flex -space-x-2">
      {members.map((member) => (
        <span
          key={member.username}
          title={`@${member.username}`}
          className={`${dim} relative inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-lb-midnight`}
        >
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.avatarUrl}
              alt={member.displayName ?? member.username}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-lb-ocean text-xs font-medium text-lb-dust">
              {member.username.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
